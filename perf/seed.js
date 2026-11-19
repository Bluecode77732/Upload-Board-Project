// Purpose: seeds sharenpo_perf with synthetic users/files/posts at the ~10^4 scale ADR 0021 named
// as its deferred-index trigger, so the index candidates can be measured against real query plans.
// Usage: run after `DB_DATABASE=sharenpo_perf pnpm migration:run` — `node perf/seed.js`. Also writes
// a handful of real on-disk files under file/upload/ for the content-serving load test.
// Rationale: ADR 0021 deferred 3 file_entity indexes with "measure at 10^4+ rows" as the trigger;
// nothing in this repo generates that data, and the row count is exactly what the decision hinges on.

const bcrypt = require('bcrypt');
const { writeFile, mkdir } = require('fs/promises');
const { join } = require('path');
const { connectPerfDb } = require('./perf-db');

const NUM_USERS = 50;
const NUM_FILES = 10000;
const NUM_POSTS = 10000;
const HASH_ROUNDS = Number(process.env.HASH_ROUNDS || 10);

// The one user the load test actually logs in as (perf/load-test.js).
const MEASURE_USER_EMAIL = 'perf-seed-0@example.test';
const MEASURE_USER_PASSWORD = 'PerfSeed!123';

// k6 load accounts (perf/k6/load.js, ADR 0069). VU n signs in only as perf-vu-{n}, and as
// perf-partner-{n} for the transfer accept/reject side — one session per account (ADR 0012), so
// no two VUs may ever share either. perf-vu-0 is the setup()-only account.
const NUM_VU_ACCOUNTS = Number(process.env.PERF_VU_ACCOUNTS || 2000);
const VU_PASSWORD = 'PerfVu!12345';
const VU_FILE_BYTES = Buffer.alloc(1024, 7); // 1KB, arbitrary content

const MEDIA = [
  { ext: 'jpg', mediaType: 'image' },
  { ext: 'mp3', mediaType: 'audio' },
  { ext: 'mp4', mediaType: 'video' },
];
const VISIBILITIES = ['public', 'private', 'unlisted'];

function pad(n) {
  return String(n).padStart(6, '0');
}

// Spread createdAt over the last 180 days so ORDER BY createdAt DESC has a realistic,
// non-monotonic distribution instead of exactly mirroring insertion order.
function randomTimestamp() {
  const days = Math.random() * 180;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function visibilityFor(i) {
  const r = i % 10;
  if (r < 3) return 'public'; // 30%
  if (r < 9) return 'private'; // 60%
  return 'unlisted'; // 10%
}

// perf-vu-0 stays a plain user so setup() lists only what any user sees (public rows).
function vuRole(n) {
  if (n === 0) return 'user';
  if (n === 1) return 'superadmin';
  if (n % 50 === 0) return 'admin';
  return 'user';
}

// 목적: k6 부하용 VU 계정·파트너 계정과 VU마다 하나씩 가진 private 파일을 만든다.
// 이유: 계정 하나는 세션 하나만 가져서(ADR 0012) VU끼리 계정을 나눠 쓰면 서로의 refresh를 무효로 만든다.
//       파일 이전의 수락·거절은 대상 본인만 할 수 있어 VU마다 전용 파트너가 필요하다.
// 방법: bcrypt 해시는 한 번만 만들어 모든 계정에 쓰고, 500행씩 INSERT한다. 파일은 행과 함께 1KB 바이트를
//       cwd 기준 file/upload/에 실제로 써서 GET /file/:id/content와 이전 왕복이 실제 경로를 탄다.
async function seedVuAccounts(client) {
  const hash = await bcrypt.hash(VU_PASSWORD, HASH_ROUNDS);
  const accounts = [];
  for (let n = 0; n <= NUM_VU_ACCOUNTS; n++) {
    accounts.push([`perf-vu-${n}@example.test`, vuRole(n)]);
    if (n > 0) accounts.push([`perf-partner-${n}@example.test`, 'user']);
  }
  const idByEmail = {};
  const BATCH = 500;
  for (let start = 0; start < accounts.length; start += BATCH) {
    const slice = accounts.slice(start, start + BATCH);
    const values = [];
    const rows = slice.map(([email, role], i) => {
      values.push(email, hash, role);
      return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`;
    });
    const res = await client.query(
      `INSERT INTO "user_entity" ("email", "password", "role") VALUES ${rows.join(', ')} RETURNING id, email`,
      values,
    );
    for (const row of res.rows) idByEmail[row.email] = row.id;
  }

  for (let start = 1; start <= NUM_VU_ACCOUNTS; start += BATCH) {
    const end = Math.min(start + BATCH - 1, NUM_VU_ACCOUNTS);
    const values = [];
    const rows = [];
    for (let n = start; n <= end; n++) {
      const filePath = `file/upload/granted_perf_vu_${n}.jpg`;
      await writeFile(join(process.cwd(), filePath), VU_FILE_BYTES);
      const p = values.length;
      rows.push(`($${p + 1}, $${p + 2}, 'image', $${p + 3}, 'private', now())`);
      values.push(`perf-vu-file-${n}`, filePath, idByEmail[`perf-vu-${n}@example.test`]);
    }
    await client.query(
      `INSERT INTO "file_entity" ("title", "filePath", "mediaType", "creatorId", "visibility", "createdAt")
       VALUES ${rows.join(', ')}`,
      values,
    );
  }
  console.log(
    `Seeded ${accounts.length} k6 accounts (perf-vu-0..${NUM_VU_ACCOUNTS}, perf-partner-1..${NUM_VU_ACCOUNTS} / ${VU_PASSWORD}) and ${NUM_VU_ACCOUNTS} VU files`,
  );
}

// 목적: users → files → posts 순으로 대량 시드 데이터를 만들고, k6 부하용 계정과 파일을 덧붙인다.
// 이유: EXPLAIN ANALYZE와 autocannon 부하 측정 모두 실제 스캔 비용을 보려면 10^4 규모의 행이 필요하고,
//       k6 부하(ADR 0069)는 VU마다 겹치지 않는 계정이 필요하다.
// 방법: 사용자 50명을 먼저 넣어 id를 받아오고, 그 id 풀을 파일 1만 건·게시글 1만 건에 분배해
//       배치(500행) INSERT로 묶어 왕복 횟수를 줄인다. 검색 측정을 위해 제목의 5%에 'holiday'를 심는다.
//       콘텐츠 측정 파일을 쓴 뒤 seedVuAccounts()로 k6 계정을 넣는다.
async function seed() {
  const client = await connectPerfDb();
  try {
    await client.query('BEGIN');

    // ---- Users ----
    const passwordHash = await bcrypt.hash(MEASURE_USER_PASSWORD, HASH_ROUNDS);
    const userIds = [];
    for (let i = 0; i < NUM_USERS; i++) {
      const email =
        i === 0 ? MEASURE_USER_EMAIL : `perf-seed-${i}@example.test`;
      const res = await client.query(
        `INSERT INTO "user_entity" ("email", "password") VALUES ($1, $2) RETURNING id`,
        [email, passwordHash],
      );
      userIds.push(res.rows[0].id);
    }
    console.log(`Seeded ${userIds.length} users (measure user: ${MEASURE_USER_EMAIL} / ${MEASURE_USER_PASSWORD})`);

    // ---- Files ----
    const fileIds = [];
    const FILE_BATCH = 500;
    for (let start = 0; start < NUM_FILES; start += FILE_BATCH) {
      const rows = [];
      const values = [];
      let p = 1;
      const end = Math.min(start + FILE_BATCH, NUM_FILES);
      for (let i = start; i < end; i++) {
        const media = MEDIA[i % MEDIA.length];
        const titleWord = i % 20 === 0 ? 'holiday' : 'trip';
        const title = `perf-file-${pad(i)}-${titleWord}`;
        const filePath = `file/upload/granted_perf_${pad(i)}.${media.ext}`;
        const creatorId = userIds[i % userIds.length];
        const visibility = visibilityFor(i);
        rows.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
        );
        values.push(
          title,
          filePath,
          media.mediaType,
          creatorId,
          visibility,
          randomTimestamp(),
        );
      }
      const res = await client.query(
        `INSERT INTO "file_entity" ("title", "filePath", "mediaType", "creatorId", "visibility", "createdAt")
         VALUES ${rows.join(', ')} RETURNING id`,
        values,
      );
      for (const row of res.rows) fileIds.push(row.id);
      process.stdout.write(`\rSeeded files: ${end}/${NUM_FILES}`);
    }
    console.log();

    // ---- Posts ----
    const POST_BATCH = 500;
    for (let start = 0; start < NUM_POSTS; start += POST_BATCH) {
      const rows = [];
      const values = [];
      let p = 1;
      const end = Math.min(start + POST_BATCH, NUM_POSTS);
      for (let i = start; i < end; i++) {
        const titleWord = i % 20 === 0 ? 'holiday' : 'weekend';
        const title = `perf-post-${pad(i)}-${titleWord}`;
        const body = `Synthetic body text for load measurement, row ${i}.`;
        const creatorId = userIds[i % userIds.length];
        rows.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
        values.push(title, body, creatorId, randomTimestamp());
      }
      await client.query(
        `INSERT INTO "post_entity" ("title", "body", "creatorId", "createdAt")
         VALUES ${rows.join(', ')}`,
        values,
      );
      process.stdout.write(`\rSeeded posts: ${end}/${NUM_POSTS}`);
    }
    console.log();

    await client.query('COMMIT');

    // ---- A handful of real on-disk files for the content-serving benchmark ----
    // GET /file/:id/content calls storage.stat()/createReadStream() — these rows need actual
    // bytes at their filePath (LocalDiskStorage resolves it as join(process.cwd(), filePath)).
    const uploadDir = join(process.cwd(), 'file', 'upload');
    await mkdir(uploadDir, { recursive: true });
    const dummyBytes = Buffer.alloc(200 * 1024, 1); // 200KB placeholder, arbitrary content

    const contentRows = [
      { title: 'perf-content-public', visibility: 'public', ext: 'jpg', mediaType: 'image' },
      { title: 'perf-content-private', visibility: 'private', ext: 'jpg', mediaType: 'image' },
    ];
    const contentIds = {};
    for (const row of contentRows) {
      const filePath = `file/upload/granted_${row.title}.${row.ext}`;
      await writeFile(join(process.cwd(), filePath), dummyBytes);
      const res = await client.query(
        `INSERT INTO "file_entity" ("title", "filePath", "mediaType", "creatorId", "visibility", "createdAt")
         VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
        [row.title, filePath, row.mediaType, userIds[0], row.visibility],
      );
      contentIds[row.title] = res.rows[0].id;
    }
    console.log('Content-serving benchmark files:', contentIds);
    await seedVuAccounts(client);
    console.log(`Done. ${fileIds.length} files, ${NUM_POSTS} posts, ${userIds.length} users in ${require('./perf-db').PERF_DB_NAME}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
