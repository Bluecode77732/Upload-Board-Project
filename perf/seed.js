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

// 목적: users → files → posts 순으로 대량 시드 데이터를 만든다.
// 이유: EXPLAIN ANALYZE와 autocannon 부하 측정 모두 실제 스캔 비용을 보려면 10^4 규모의 행이 필요하다.
// 방법: 사용자 50명을 먼저 넣어 id를 받아오고, 그 id 풀을 파일 1만 건·게시글 1만 건에 분배해
//       배치(500행) INSERT로 묶어 왕복 횟수를 줄인다. 검색 측정을 위해 제목의 5%에 'holiday'를 심는다.
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
