// 목적: 사용자·관리자 기능 전체를 섞은 k6 부하를 한 단계(TARGET_VUS) 걸고, 설계된 거절과 예상 밖 실패를 나눠 센다.
// 사용처: perf/README.md의 docker run grafana/k6:2.3.0 명령으로 손으로 실행한다 — CI에는 연결하지 않는다.
// 근거: perf/load-test.js(autocannon)는 고정 URL 하나씩만 두드려 세션·쿠키·여러 단계 흐름을 못 싣는다(ADR 0069).

import http from 'k6/http';
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import encoding from 'k6/encoding';

const BASE = __ENV.BASE_URL || 'http://host.docker.internal:3000';
const TARGET_VUS = Number(__ENV.TARGET_VUS || 10);
const RAMP = __ENV.RAMP || '10s';
const HOLD = __ENV.HOLD || '2m';
const LABEL = __ENV.LABEL || `vus-${TARGET_VUS}`;
const RESULTS_DIR = __ENV.RESULTS_DIR || '/results';
const MAX_VU_ACCOUNTS = Number(__ENV.MAX_VU_ACCOUNTS || 2000);
const PASSWORD = 'PerfVu!12345'; // perf/seed.js VU_PASSWORD
const REFRESH_AFTER_MS = 150 * 1000; // ACCESS_TOKEN_SECRET_EXPIRES_IN=180 in the perf env
const BASELINE = __ENV.BASELINE ? JSON.parse(open(__ENV.BASELINE)) : null;

// 1x1 JPEG. The upload gate only checks the field's extension/mimetype and the ClamAV verdict.
const JPG = encoding.b64decode(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
);

// Read from the repo so a renamed or added code shows up without editing this file.
const ERROR_CODES = [
  ...open('../../backend/common/error-code.ts').matchAll(/^\s+([A-Z_]+) = '\1',/gm),
].map((m) => m[1]);

const FAILURE_TYPES = ['timeout', 'connection', 'internal_error', 'no_code_5xx', 'server_error'];

const designedRejection = new Counter('designed_rejection');
const unexpectedFailure = new Counter('unexpected_failure');
const unplannedResponse = new Counter('unplanned_response');

// Every request goes through a plan: the statuses it may succeed with, and the ErrorCodes it may be
// refused with by design. Anything else is unplanned (4xx) or an unexpected failure (5xx, 0, timeout).
// Names carry no ':' or ',' — they become submetric tag values in thresholds.
const PLANS = {
  'POST /auth/signin': { tier: 'auth', ok: [201] },
  'POST /auth/token/refresh': { tier: 'auth', ok: [201] },
  'POST /auth/signout': { tier: 'auth', ok: [201] },
  'POST /auth/register': { tier: 'auth', ok: [201], designed: { 400: ['AUTH_EMAIL_TAKEN'] } },
  'GET /file': { tier: 'list', ok: [200] },
  'GET /file/ID': { tier: 'detail', ok: [200], designed: { 404: ['FILE_NOT_FOUND'] } },
  'GET /file/ID/content': {
    tier: 'content',
    ok: [200],
    designed: { 403: ['FILE_SHARE_INVALID'] },
    statusOnly: true, // body is discarded (responseType none)
  },
  'PATCH /file/ID': { tier: 'write', ok: [200] },
  'DELETE /file/ID': { tier: 'write', ok: [200] },
  'POST /file': { tier: 'write', ok: [200, 201] },
  'POST /upload/attach': {
    tier: 'upload',
    ok: [201],
    designed: { 503: ['UPLOAD_SCAN_UNAVAILABLE'] },
  },
  'POST /file/ID/transfer': {
    tier: 'write',
    ok: [200],
    designed: { 400: ['FILE_TRANSFER_INVALID_TARGET'], 409: ['FILE_TRANSFER_PENDING'] },
  },
  'POST /file/ID/transfer/accept': {
    tier: 'write',
    ok: [200],
    designed: { 400: ['FILE_NO_PENDING_TRANSFER'] },
  },
  'POST /file/ID/transfer/reject': {
    tier: 'write',
    ok: [200],
    designed: { 400: ['FILE_NO_PENDING_TRANSFER'] },
  },
  'DELETE /file/ID/transfer': {
    tier: 'write',
    ok: [200],
    designed: { 400: ['FILE_NO_PENDING_TRANSFER'] },
  },
  'GET /post': { tier: 'list', ok: [200] },
  'GET /post/ID': { tier: 'detail', ok: [200] },
  'POST /post': { tier: 'write', ok: [201] },
  'PATCH /post/ID': { tier: 'write', ok: [200] },
  'DELETE /post/ID': { tier: 'write', ok: [200] },
  'GET /post/ID/comment': { tier: 'list', ok: [200] },
  'POST /post/ID/comment': { tier: 'write', ok: [201] },
  'PATCH /comment/ID': { tier: 'write', ok: [200] },
  'DELETE /comment/ID': { tier: 'write', ok: [200] },
  'GET /user/ID': { tier: 'detail', ok: [200] },
  'GET /user/lookup': { tier: 'detail', ok: [200] },
  'PATCH /user/ID': { tier: 'write', ok: [200] },
  'DELETE /user/ID': { tier: 'write', ok: [200] },
  'GET /user': { tier: 'admin', ok: [200] },
  'GET /audit-log': { tier: 'admin', ok: [200] },
  'PATCH /user/ID/role': { tier: 'admin', ok: [200] },
};
for (const plan of Object.values(PLANS)) {
  plan.designed = plan.designed || {};
  const statuses = [...plan.ok, ...Object.keys(plan.designed).map(Number)];
  plan.cb = http.expectedStatuses(...statuses);
}

// ADR 0049 D1 targets (ms). auth/upload/admin have none.
const TIER_TARGETS = {
  list: [50, 200],
  detail: [30, 100],
  content: [100, 300],
  write: [100, 300],
  auth: null,
  upload: null,
  admin: null,
};

const thresholds = {
  unexpected_failure: ['count==0'],
  unplanned_response: ['count==0'],
};
for (const code of ERROR_CODES) thresholds[`designed_rejection{code:${code}}`] = ['count>=0'];
for (const type of FAILURE_TYPES) thresholds[`unexpected_failure{type:${type}}`] = ['count>=0'];
for (const name of Object.keys(PLANS)) {
  thresholds[`unplanned_response{endpoint:${name}}`] = ['count>=0'];
  thresholds[`http_req_duration{name:${name}}`] = ['med>=0'];
}
for (const tier of Object.keys(TIER_TARGETS)) {
  thresholds[`http_req_duration{tier:${tier}}`] = ['med>=0'];
}

export const options = {
  scenarios: {
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP, target: TARGET_VUS },
        { duration: HOLD, target: TARGET_VUS },
      ],
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
  },
  noCookiesReset: true,
  thresholds,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
};

// Per-VU state. Module scope is per VU in k6, so nothing here is shared between VUs.
const myJar = new http.CookieJar();
const partnerJar = new http.CookieJar();
const scratchJar = new http.CookieJar(); // register→delete accounts, never our own refresh cookie
let me = null; // { email, id, token, at }
let partner = null; // { email, id, token }
let fileId = null;
let fileState = 'unknown'; // 'own' once checked: owned by me, nothing pending
const myPosts = [];
const myComments = [];
let warnings = 0;

// 목적: 응답 본문에서 ErrorBody.code를 꺼낸다.
// 이유: 설계된 거절인지는 상태 코드만으로 가릴 수 없다 — 같은 400에도 여러 코드가 있다.
// 방법: JSON 파싱이 실패하거나 code가 없으면 null을 돌려준다.
function errorCode(res) {
  if (!res.body) return null;
  try {
    const body = res.json();
    return body && typeof body.code === 'string' ? body.code : null;
  } catch {
    return null;
  }
}

// 목적: 한 응답을 계획된 성공 / 설계된 거절 / 계획 밖 응답 / 예상 밖 실패 중 하나로 센다.
// 이유: 부하가 오를 때 "설계대로 거절된 것"과 "망가진 것"을 섞으면 실패율이 아무 뜻도 없어진다.
// 방법: status 0은 타임아웃·연결 오류, 5xx는 코드로 유형을 나누고, 4xx는 계획의 코드 목록과 맞춰 본다.
function classify(name, plan, res) {
  if (res.status === 0) {
    const timedOut = res.error_code === 1050 || /timeout/i.test(res.error || '');
    unexpectedFailure.add(1, { type: timedOut ? 'timeout' : 'connection' });
    note(name, res, null);
    return;
  }
  if (plan.ok.includes(res.status)) return;
  const code = plan.statusOnly ? null : errorCode(res);
  const allowed = plan.designed[res.status];
  if (allowed && (plan.statusOnly || allowed.includes(code))) {
    designedRejection.add(1, { code: plan.statusOnly ? allowed[0] : code });
    return;
  }
  if (res.status >= 500) {
    let type = 'server_error';
    if (!code) type = 'no_code_5xx';
    else if (code === 'INTERNAL_ERROR') type = 'internal_error';
    unexpectedFailure.add(1, { type });
  } else {
    unplannedResponse.add(1, { endpoint: name });
  }
  note(name, res, code);
}

// 목적: 계획 밖 응답의 앞부분 몇 건을 콘솔에 남긴다.
// 이유: 카운터는 몇 건인지만 알려 주고 무엇이 왔는지는 알려 주지 않는다.
// 방법: VU마다 5건까지만 찍어 로그가 부하에 비례해 불어나지 않게 한다.
function note(name, res, code) {
  if (warnings >= 5) return;
  warnings++;
  console.warn(`VU ${__VU} ${name}: status=${res.status} code=${code} error=${res.error || ''}`);
}

// 목적: 계획을 붙여 요청 하나를 보내고 결과를 분류한다.
// 이유: 타임아웃, 태그, responseCallback, 분류를 요청마다 반복하지 않으려고 한곳에 모은다.
// 방법: name으로 PLANS를 찾아 params를 만들고, URL에 id가 있어도 tags.name은 고정 이름을 쓴다.
function call(method, name, url, body, opts) {
  const plan = PLANS[name];
  const o = opts || {};
  const headers = Object.assign({}, o.headers);
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  let payload = body;
  if (body !== null && body !== undefined && o.json !== false) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const params = {
    timeout: '30s',
    headers,
    tags: { name, tier: plan.tier },
    responseCallback: plan.cb,
  };
  if (o.jar) params.jar = o.jar;
  if (o.discard) params.responseType = 'none';
  const res = http.request(method, `${BASE}${url}`, payload === undefined ? null : payload, params);
  classify(name, plan, res);
  return res;
}

// 목적: JSON 응답 본문을 예외 없이 읽는다.
// 이유: 실패 응답이나 빈 본문에서 res.json()이 던지면 VU iteration 전체가 끊긴다.
// 방법: 파싱 실패는 null.
function body(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

// 목적: Basic 토큰으로 로그인해 액세스 토큰과 유저 id를 얻는다.
// 이유: signin 응답은 accessToken만 준다 — id는 토큰의 sub에 있다.
// 방법: 지정한 jar로 보내 refresh 쿠키가 그 계정의 jar에만 쌓이게 하고, JWT payload를 디코드한다.
function signin(email, jar) {
  const basic = encoding.b64encode(`${email}:${PASSWORD}`);
  const res = call('POST', 'POST /auth/signin', '/auth/signin', null, {
    headers: { Authorization: `Basic ${basic}` },
    jar,
  });
  const b = res.status === 201 ? body(res) : null;
  if (!b || !b.accessToken) return null;
  const payload = JSON.parse(encoding.b64decode(b.accessToken.split('.')[1], 'rawurl', 's'));
  return { email, id: payload.sub, token: b.accessToken, at: Date.now() };
}

// 목적: 이 VU의 계정 세션이 살아 있게 한다.
// 이유: 액세스 토큰은 180초에 만료되고, 단계 유지 시간은 그보다 길다.
// 방법: 토큰이 없으면 로그인, 150초가 지났으면 쿠키로 refresh하고, refresh가 실패하면 다시 로그인한다.
function ensureMe() {
  if (__VU > MAX_VU_ACCOUNTS) throw new Error(`VU ${__VU} has no seeded account (max ${MAX_VU_ACCOUNTS})`);
  if (!me) {
    me = signin(`perf-vu-${__VU}@example.test`, myJar);
    return me !== null;
  }
  if (Date.now() - me.at > REFRESH_AFTER_MS) refreshMe();
  return true;
}

// 목적: refresh 쿠키로 액세스 토큰을 새로 받는다.
// 이유: refresh 경로(쿠키 Path=/auth/token, SameSite=Strict, 해시 앵커 회전)도 부하에 들어가야 한다.
// 방법: 이 VU의 jar로 POST /auth/token/refresh를 보내고, 실패하면 로그인으로 되돌아간다.
function refreshMe() {
  const res = call('POST', 'POST /auth/token/refresh', '/auth/token/refresh', null, { jar: myJar });
  const b = res.status === 201 ? body(res) : null;
  if (b && b.accessToken) {
    me.token = b.accessToken;
    me.at = Date.now();
  } else {
    me = signin(me.email, myJar);
  }
}

// 목적: 이 VU 전용 파트너 계정으로 로그인한다.
// 이유: 파일 이전의 수락·거절은 대상 본인만 할 수 있다(ADR 0050 D4).
// 방법: 파트너는 refresh하지 않고 필요할 때마다 로그인한다 — superadmin의 role 변경이 그 세션을 지우기 때문이다.
function partnerSession() {
  partner = signin(`perf-partner-${__VU}@example.test`, partnerJar);
  return partner;
}

// 목적: 이 VU의 시드 파일을 찾아 내 소유, 대기 중 이전 없음 상태로 맞춘다.
// 이유: 단계가 끝나며 이전 왕복이 중간에 끊기면 파일이 파트너에게 있거나 이전이 걸린 채 남는다.
// 방법: 내 목록에서 찾고 없으면 파트너 목록에서 찾는다. 걸린 이전은 취소하고, 파트너 소유면 되돌려 받는다.
function ensureFile() {
  if (fileState === 'own') return true;
  const title = `perf-vu-file-${__VU}`;
  if (fileId === null) {
    const res = call('GET', 'GET /file', `/file?creatorId=${me.id}&search=${title}&take=1`, null, { token: me.token });
    const rows = res.status === 200 ? body(res)[0] : [];
    if (rows.length) fileId = rows[0].id;
  }
  if (fileId !== null) {
    const res = call('GET', 'GET /file/ID', `/file/${fileId}`, null, { token: me.token });
    if (res.status === 200) {
      if (body(res).pendingTransferTo) {
        call('DELETE', 'DELETE /file/ID/transfer', `/file/${fileId}/transfer`, null, { token: me.token });
      }
      fileState = 'own';
      return true;
    }
  }
  if (!partnerSession()) return false;
  if (fileId === null) {
    const res = call('GET', 'GET /file', `/file?creatorId=${partner.id}&search=${title}&take=1`, null, {
      token: partner.token,
    });
    const rows = res.status === 200 ? body(res)[0] : [];
    if (!rows.length) return false;
    fileId = rows[0].id;
  }
  const res = call('GET', 'GET /file/ID', `/file/${fileId}`, null, { token: partner.token });
  if (res.status !== 200) return false;
  if (body(res).pendingTransferTo) {
    call('DELETE', 'DELETE /file/ID/transfer', `/file/${fileId}/transfer`, null, { token: partner.token });
  }
  call('POST', 'POST /file/ID/transfer', `/file/${fileId}/transfer`, { userId: me.id }, { token: partner.token });
  const back = call('POST', 'POST /file/ID/transfer/accept', `/file/${fileId}/transfer/accept`, null, {
    token: me.token,
  });
  if (back.status !== 200) return false;
  fileState = 'own';
  return true;
}

// 목적: 배열에서 아무 원소나 하나 고른다.
// 이유: 둘러보기와 쓰기 동작을 무작위로 섞는다.
// 방법: Math.random 인덱스.
function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// 목적: 둘러보기 동작 하나를 실행한다(비율 70).
// 이유: 실제 사용은 읽기가 대부분이다 — 목록, 검색, 정렬, 필터, 상세, 댓글, 익명 콘텐츠 조회.
// 방법: setup이 모은 public 파일·게시글 id로 무작위 요청 하나를 보낸다.
function browse(data) {
  const t = { token: me.token };
  const actions = [
    () => call('GET', 'GET /file', '/file', null, t),
    () => call('GET', 'GET /file', '/file?search=holiday', null, t),
    () => call('GET', 'GET /file', '/file?sortBy=title&order=ASC', null, t),
    () => call('GET', 'GET /file', `/file?creatorId=${pick(data.creatorIds)}`, null, t),
    () => call('GET', 'GET /file/ID', `/file/${pick(data.publicFileIds)}`, null, t),
    () => call('GET', 'GET /post', '/post', null, t),
    () => call('GET', 'GET /post', '/post?search=holiday', null, t),
    () => call('GET', 'GET /post/ID', `/post/${pick(data.postIds)}`, null, t),
    () => call('GET', 'GET /post/ID/comment', `/post/${pick(data.postIds)}/comment`, null, t),
    () => call('GET', 'GET /file/ID/content', `/file/${data.contentId}/content`, null, { discard: true }),
    () => call('GET', 'GET /user/ID', `/user/${me.id}`, null, t),
  ];
  pick(actions)();
}

// 목적: 쓰기 동작 하나를 실행한다(비율 20).
// 이유: 글·댓글 CRUD와 공개범위·공유 토큰 변경이 쓰기 부하의 대부분이다.
// 방법: 자기 글·댓글은 5개까지 유지하며 만들고 고치고 지운다. 공유는 unlisted로 바꿔 익명 조회한 뒤 private로 되돌린다.
function write(data) {
  const t = { token: me.token };
  const r = Math.random();
  if (r < 0.4) {
    if (myPosts.length < 5) {
      const res = call('POST', 'POST /post', '/post', { title: `k6 post ${__VU}-${__ITER}`, body: 'k6 load body' }, t);
      if (res.status === 201) myPosts.push(body(res).id);
    } else if (Math.random() < 0.5) {
      call('PATCH', 'PATCH /post/ID', `/post/${pick(myPosts)}`, { body: `edited ${__ITER}` }, t);
    } else {
      call('DELETE', 'DELETE /post/ID', `/post/${myPosts.shift()}`, null, t);
    }
  } else if (r < 0.8) {
    if (myComments.length < 5) {
      const res = call('POST', 'POST /post/ID/comment', `/post/${pick(data.postIds)}/comment`, { body: `k6 comment ${__ITER}` }, t);
      if (res.status === 201) myComments.push(body(res).id);
    } else if (Math.random() < 0.5) {
      call('PATCH', 'PATCH /comment/ID', `/comment/${pick(myComments)}`, { body: `edited ${__ITER}` }, t);
    } else {
      call('DELETE', 'DELETE /comment/ID', `/comment/${myComments.shift()}`, null, t);
    }
  } else {
    share();
  }
}

// 목적: 공개범위 변경과 unlisted 공유 토큰 익명 조회를 한 번 돈다.
// 이유: 공유 토큰 발급·회전과 OptionalJwt 콘텐츠 경로를 부하에 넣고, 회전된 옛 토큰의 403을 설계된 거절로 확인한다.
// 방법: unlisted로 바꿔 shareUrl의 토큰으로 익명 조회하고, 가끔 토큰을 회전해 옛 토큰을 보낸 뒤 private로 되돌린다.
function share() {
  if (!ensureFile()) return;
  const t = { token: me.token };
  const res = call('PATCH', 'PATCH /file/ID', `/file/${fileId}`, { visibility: 'unlisted' }, t);
  const b = res.status === 200 ? body(res) : null;
  if (!b || !b.shareUrl) return;
  const token = b.shareUrl.split('share=')[1];
  call('GET', 'GET /file/ID/content', `/file/${fileId}/content?share=${token}`, null, { discard: true });
  if (Math.random() < 0.3) {
    call('PATCH', 'PATCH /file/ID', `/file/${fileId}`, { rotateShareToken: true }, t);
    call('GET', 'GET /file/ID/content', `/file/${fileId}/content?share=${token}`, null, { discard: true });
  }
  call('PATCH', 'PATCH /file/ID', `/file/${fileId}`, { visibility: 'private' }, t);
}

// 목적: 업로드 2단계를 한 번 돈다(비율 5).
// 이유: attach는 ClamAV 스캔과 temp 쓰기를, POST /file은 QueryRunner 트랜잭션과 promote를 탄다.
// 방법: attach 뒤 POST /file, 가끔 같은 filename을 다시 보내 replay 200을 확인하고, 절반은 지운다.
function upload() {
  const t = { token: me.token };
  const res = call(
    'POST',
    'POST /upload/attach',
    '/upload/attach',
    { image: http.file(JPG, 'k6.jpg', 'image/jpeg') },
    { token: me.token, json: false },
  );
  const b = res.status === 201 ? body(res) : null;
  if (!b || !b.filename) return;
  const dto = { title: `k6-upload-${__VU}-${__ITER}-${Date.now()}`, filePath: b.filename };
  const created = call('POST', 'POST /file', '/file', dto, t);
  if (created.status !== 201) return;
  const id = body(created).id;
  if (Math.random() < 0.2) call('POST', 'POST /file', '/file', dto, t);
  if (Math.random() < 0.5) call('DELETE', 'DELETE /file/ID', `/file/${id}`, null, t);
}

// 목적: 파일 이전 왕복을 한 번 돈다.
// 이유: 제안·수락·거절·취소는 두 계정이 번갈아 움직이는 흐름이라 단일 요청 벤치마크로는 못 싣는다.
// 방법: 파트너에게 제안한 뒤 수락(되돌려 받기까지)·거절·취소 중 하나를 고른다. 가끔 자기 자신 대상 제안과
//       대기 없는 수락을 보내 설계된 400을 확인한다.
function transfer() {
  if (!ensureFile() || !partnerSession()) return;
  const t = { token: me.token };
  const p = { token: partner.token };
  if (Math.random() < 0.2) {
    call('POST', 'POST /file/ID/transfer', `/file/${fileId}/transfer`, { userId: me.id }, t);
    call('POST', 'POST /file/ID/transfer/accept', `/file/${fileId}/transfer/accept`, null, p);
    return;
  }
  fileState = 'unknown';
  const res = call('POST', 'POST /file/ID/transfer', `/file/${fileId}/transfer`, { userId: partner.id }, t);
  if (res.status !== 200) return;
  const r = Math.random();
  if (r < 1 / 3) {
    call('POST', 'POST /file/ID/transfer/accept', `/file/${fileId}/transfer/accept`, null, p);
    call('POST', 'POST /file/ID/transfer', `/file/${fileId}/transfer`, { userId: me.id }, p);
    call('POST', 'POST /file/ID/transfer/accept', `/file/${fileId}/transfer/accept`, null, t);
  } else if (r < 2 / 3) {
    call('POST', 'POST /file/ID/transfer/reject', `/file/${fileId}/transfer/reject`, null, p);
  } else {
    call('DELETE', 'DELETE /file/ID/transfer', `/file/${fileId}/transfer`, null, t);
  }
  fileState = 'unknown'; // re-checked by ensureFile() next time
}

// 목적: 가입 직후 자기 계정을 지우는 흐름을 한 번 돈다.
// 이유: register(bcrypt 해시)와 계정 삭제 트랜잭션도 부하에 들어가야 하고, 중복 가입의 설계된 400도 확인한다.
// 방법: 새 이메일로 가입하고 별도 jar로 로그인해 DELETE /user/:id를 보낸다. 가끔 내 이메일로 가입해 AUTH_EMAIL_TAKEN을 본다.
function registerAndDelete() {
  if (Math.random() < 0.2) {
    const basic = encoding.b64encode(`${me.email}:${PASSWORD}`);
    call('POST', 'POST /auth/register', '/auth/register', null, { headers: { Authorization: `Basic ${basic}` } });
    return;
  }
  const email = `k6-reg-${__VU}-${__ITER}-${Date.now()}@example.test`;
  const basic = encoding.b64encode(`${email}:${PASSWORD}`);
  const res = call('POST', 'POST /auth/register', '/auth/register', null, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (res.status !== 201) return;
  const s = signin(email, scratchJar);
  if (s) call('DELETE', 'DELETE /user/ID', `/user/${s.id}`, null, { token: s.token });
}

// 목적: 계정·이전·관리자 동작 하나를 실행한다(비율 5).
// 이유: 로그아웃·재로그인, 자기 정보 수정, 이메일 조회, 이전, 관리자 목록과 role 변경을 섞는다.
// 방법: n%50==0인 admin VU는 절반 확률로 관리자 동작을, VU 1(superadmin)은 파트너 role 토글도 한다.
function account() {
  const t = { token: me.token };
  const n = __VU;
  const isSuper = n === 1;
  const isAdmin = isSuper || n % 50 === 0;
  if (isAdmin && Math.random() < 0.5) {
    const r = Math.random();
    if (isSuper && r < 0.3) {
      if (!partnerSession()) return;
      const role = Math.random() < 0.5 ? 'admin' : 'user';
      call('PATCH', 'PATCH /user/ID/role', `/user/${partner.id}/role`, { role }, t);
    } else if (r < 0.65) {
      call('GET', 'GET /user', '/user?take=20', null, t);
    } else {
      call('GET', 'GET /audit-log', '/audit-log?take=20', null, t);
    }
    return;
  }
  const actions = [
    () => refreshMe(),
    () => {
      call('POST', 'POST /auth/signout', '/auth/signout', null, t);
      me = signin(me.email, myJar);
    },
    () => call('PATCH', 'PATCH /user/ID', `/user/${me.id}`, { email: me.email }, t),
    () => call('GET', 'GET /user/lookup', `/user/lookup?email=perf-partner-${n}@example.test`, null, t),
    () => transfer(),
    () => registerAndDelete(),
  ];
  pick(actions)();
}

// 목적: 모든 VU가 함께 쓸 조회 대상 id를 한 번 모은다.
// 이유: 시드 id는 실행마다 달라질 수 있어 하드코딩할 수 없다.
// 방법: 일반 user인 perf-vu-0으로 로그인해 보이는 public 파일·게시글·작성자 id와 콘텐츠 측정 파일 id를 모은다.
export function setup() {
  const s = signin('perf-vu-0@example.test', new http.CookieJar());
  if (!s) throw new Error('setup signin failed — is the app up and seeded (perf/seed.js)?');
  const t = { token: s.token };
  const files = body(call('GET', 'GET /file', '/file?take=100', null, t))[0];
  const posts = body(call('GET', 'GET /post', '/post?take=100', null, t))[0];
  const content = body(call('GET', 'GET /file', '/file?search=perf-content-public&take=1', null, t))[0];
  const publicFiles = files.filter((f) => f.visibility === 'public');
  if (!publicFiles.length || !posts.length || !content.length) {
    throw new Error('setup found no public files, posts or content file — reseed with perf/seed.js');
  }
  return {
    publicFileIds: publicFiles.map((f) => f.id),
    creatorIds: [...new Set(publicFiles.map((f) => f.creator.id))],
    postIds: posts.map((p) => p.id),
    contentId: content[0].id,
  };
}

// 목적: VU iteration 하나 — 세션을 챙긴 뒤 비율대로 동작 하나를 고르고 쉰다.
// 이유: 70/20/5/5 비율과 0.5~1.5초 think time으로 VU 수가 동시 사용자 수로 읽히게 한다(ADR 0069).
// 방법: 로그인에 실패하면 이번 iteration은 쉬고 넘어간다 — 그 실패는 이미 분류돼 세어졌다.
export default function (data) {
  if (ensureMe()) {
    const r = Math.random() * 100;
    if (r < 70) browse(data);
    else if (r < 90) write(data);
    else if (r < 95) upload();
    else account();
  }
  sleep(0.5 + Math.random());
}

// 목적: 지표 묶음에서 한 값을 읽는다.
// 이유: threshold로 만든 submetric만 data.metrics에 있고, 없을 수도 있다.
// 방법: 없으면 null.
function metric(data, key, stat) {
  const m = data.metrics[key];
  return m && m.values[stat] !== undefined ? m.values[stat] : null;
}

// 목적: 사람이 읽을 요약과 원자료 JSON을 남긴다.
// 이유: 기본 요약은 tier·코드별 submetric을 목표값과 나란히 보여 주지 않고, 단계별 결과를 파일로 남겨야 비교할 수 있다.
// 방법: tier p50/p95를 ADR 0049 목표와, 엔드포인트별 지연과 건수, 설계된 거절, 예상 밖 실패를 적는다.
//       BASELINE이 있으면 회복 기준(p95 ≤ 기준 p95×2)도 판정한다.
export function handleSummary(data) {
  const f = (v) => (v === null ? '-' : v.toFixed(1));
  const lines = [];
  const reqs = metric(data, 'http_reqs', 'count');
  const rate = metric(data, 'http_reqs', 'rate');
  lines.push(`== ${LABEL}: TARGET_VUS=${TARGET_VUS} RAMP=${RAMP} HOLD=${HOLD}`);
  lines.push(`requests=${reqs} rate=${f(rate)}/s iterations=${metric(data, 'iterations', 'count')}`);
  lines.push(
    `overall p50=${f(metric(data, 'http_req_duration', 'med'))}ms p95=${f(metric(data, 'http_req_duration', 'p(95)'))}ms ` +
      `p99=${f(metric(data, 'http_req_duration', 'p(99)'))}ms max=${f(metric(data, 'http_req_duration', 'max'))}ms`,
  );
  lines.push('', '-- tiers (ADR 0049 D1 target p50/p95)');
  for (const [tier, target] of Object.entries(TIER_TARGETS)) {
    const key = `http_req_duration{tier:${tier}}`;
    const count = metric(data, key, 'count');
    if (!count) continue;
    const p50 = metric(data, key, 'med');
    const p95 = metric(data, key, 'p(95)');
    let verdict = '';
    if (target) verdict = p50 < target[0] && p95 < target[1] ? ` PASS (<${target[0]}/<${target[1]})` : ` FAIL (<${target[0]}/<${target[1]})`;
    lines.push(`${tier.padEnd(8)} n=${count} p50=${f(p50)} p95=${f(p95)} max=${f(metric(data, key, 'max'))}${verdict}`);
  }
  lines.push('', '-- endpoints');
  for (const name of Object.keys(PLANS)) {
    const key = `http_req_duration{name:${name}}`;
    const count = metric(data, key, 'count');
    if (!count) continue;
    lines.push(`${name.padEnd(30)} n=${String(count).padStart(6)} p50=${f(metric(data, key, 'med'))} p95=${f(metric(data, key, 'p(95)'))} max=${f(metric(data, key, 'max'))}`);
  }
  lines.push('', '-- designed rejections');
  for (const code of ERROR_CODES) {
    const c = metric(data, `designed_rejection{code:${code}}`, 'count');
    if (c) lines.push(`${code} ${c}`);
  }
  lines.push('', `-- unexpected failures: ${metric(data, 'unexpected_failure', 'count') || 0}`);
  for (const type of FAILURE_TYPES) {
    const c = metric(data, `unexpected_failure{type:${type}}`, 'count');
    if (c) lines.push(`${type} ${c}`);
  }
  lines.push(`-- unplanned responses: ${metric(data, 'unplanned_response', 'count') || 0}`);
  for (const name of Object.keys(PLANS)) {
    const c = metric(data, `unplanned_response{endpoint:${name}}`, 'count');
    if (c) lines.push(`${name} ${c}`);
  }
  if (BASELINE) {
    const base = BASELINE.metrics.http_req_duration.values['p(95)'];
    const now = metric(data, 'http_req_duration', 'p(95)');
    const ok = now !== null && now <= base * 2;
    lines.push('', `-- recovery: p95=${f(now)}ms vs baseline p95=${f(base)}ms x2=${f(base * 2)}ms → ${ok ? 'PASS' : 'FAIL'}`);
  }
  const text = lines.join('\n') + '\n';
  return {
    stdout: text,
    [`${RESULTS_DIR}/${LABEL}.txt`]: text,
    [`${RESULTS_DIR}/${LABEL}.json`]: JSON.stringify(data, null, 1),
  };
}
