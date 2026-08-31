// Purpose: drives autocannon against the running app's list/detail/content-serving/write endpoints
// and reports p50/p95-equivalent latency against the response-time targets this task sets.
// Usage: `node perf/load-test.js` — needs the app already running (perf/README notes the exact
// command) against sharenpo_perf, seeded via perf/seed.js. BASE_URL env overrides the default.
// Rationale: ADR 0047's http_request_duration_seconds histogram observes production traffic
// shape, not a controlled load — this is the repeatable tool for the specific endpoints and
// concurrency this task's response-time targets are defined against.

const autocannon = require('autocannon');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const MEASURE_USER_EMAIL = 'perf-seed-0@example.test';
const MEASURE_USER_PASSWORD = 'PerfSeed!123';

// 목적: 측정용 시드 사용자로 로그인해 이후 요청에 쓸 액세스 토큰을 얻는다.
// 이유: 목록/단건/쓰기 엔드포인트는 JwtAuthGuard 뒤에 있어 부하 테스트도 실제 토큰이 있어야 한다.
// 방법: ADR 그대로 Basic 토큰으로 POST /auth/signin을 한 번 호출해 accessToken만 꺼낸다.
async function login() {
  const basic = Buffer.from(
    `${MEASURE_USER_EMAIL}:${MEASURE_USER_PASSWORD}`,
  ).toString('base64');
  const res = await fetch(`${BASE_URL}/auth/signin`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.accessToken;
}

// 목적: 자바스크립트 대상 파일 id를 하나 조회해 상세/콘텐츠 서빙 벤치마크에 쓴다.
// 이유: perf/seed.js가 만든 콘텐츠 벤치마크용 행의 id는 실행마다 달라질 수 있어 하드코딩할 수 없다.
// 방법: 제목으로 GET /file?search=를 호출해 그 응답에서 id를 읽는다.
async function findFileIdByTitle(token, title) {
  const res = await fetch(
    `${BASE_URL}/file?search=${encodeURIComponent(title)}&take=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const [rows] = await res.json();
  if (!rows[0]) throw new Error(`no file found for title ${title}`);
  return rows[0].id;
}

function run(opts) {
  return new Promise((resolve, reject) => {
    autocannon(opts, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

function report(label, result, targetP50, targetP95) {
  const p50 = result.latency.p50;
  const p95 = result.latency.p97_5; // closest built-in autocannon percentile to p95
  const ok = p50 <= targetP50 && p95 <= targetP95;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label}: p50=${p50}ms p97.5(~p95)=${p95}ms ` +
      `throughput=${result.requests.average.toFixed(1)}req/s ` +
      `(target p50<=${targetP50}ms, p95<=${targetP95}ms)`,
  );
}

async function main() {
  const token = await login();
  const authHeader = { Authorization: `Bearer ${token}` };
  const publicContentId = await findFileIdByTitle(token, 'perf-content-public');
  const privateContentId = await findFileIdByTitle(token, 'perf-content-private');
  const anyFileId = await findFileIdByTitle(token, 'perf-file-000001-trip');

  const common = { connections: 20, duration: 10 };

  report(
    'GET /file (list, default sort)',
    await run({ ...common, url: `${BASE_URL}/file`, headers: authHeader }),
    50,
    200,
  );

  report(
    'GET /file?search=holiday',
    await run({
      ...common,
      url: `${BASE_URL}/file?search=holiday`,
      headers: authHeader,
    }),
    50,
    200,
  );

  report(
    'GET /file?creatorId=2',
    await run({
      ...common,
      url: `${BASE_URL}/file?creatorId=2`,
      headers: authHeader,
    }),
    50,
    200,
  );

  report(
    'GET /post (list, default sort)',
    await run({ ...common, url: `${BASE_URL}/post`, headers: authHeader }),
    50,
    200,
  );

  report(
    'GET /file/:id (detail)',
    await run({
      ...common,
      url: `${BASE_URL}/file/${anyFileId}`,
      headers: authHeader,
    }),
    30,
    100,
  );

  report(
    'GET /file/:id/content (public, unauthenticated, local disk)',
    await run({ ...common, url: `${BASE_URL}/file/${publicContentId}/content` }),
    100,
    300,
  );

  report(
    'GET /file/:id/content (private, owner token, local disk)',
    await run({
      ...common,
      url: `${BASE_URL}/file/${privateContentId}/content`,
      headers: authHeader,
    }),
    100,
    300,
  );

  report(
    'PATCH /file/:id (write, idempotent same-title update)',
    await run({
      ...common,
      url: `${BASE_URL}/file/${anyFileId}`,
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'perf-file-000001-trip' }),
    }),
    100,
    300,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
