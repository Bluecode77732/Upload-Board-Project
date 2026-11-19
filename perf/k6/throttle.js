// 목적: 전역 100/분과 인증 5/분 throttle이 경계에서 정확히 429로 바뀌는지 확인한다.
// 사용처: THROTTLE_ENABLED=true로 띄운 perf 앱에 대해 손으로 한 번 실행한다(perf/README.md).
// 근거: perf/k6/load.js는 모든 VU가 한 IP에서 나가 THROTTLE_ENABLED=false로 돌리므로, 끈 가드를 따로 확인해야 한다(ADR 0069).

import http from 'k6/http';
import encoding from 'k6/encoding';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://host.docker.internal:3000';
const PASSWORD = 'PerfVu!12345';
const mismatch = new Counter('throttle_mismatch');

export const options = {
  scenarios: { once: { executor: 'shared-iterations', vus: 1, iterations: 1 } },
  thresholds: { throttle_mismatch: ['count==0'] },
};

// 목적: 같은 라우트에 n번 보내 상태 코드 순서를 기대값과 맞춘다.
// 이유: 한도 직전까지 성공하고 바로 다음부터 429 RATE_LIMITED가 와야 한다 — 몇 번째에서 바뀌는지가 핵심이다.
// 방법: i < limit이면 okStatus, 그 뒤면 429와 code RATE_LIMITED를 기대하고, 어긋난 첫 3건을 찍는다.
function probe(label, limit, total, okStatus, send) {
  let bad = 0;
  for (let i = 0; i < total; i++) {
    const res = send();
    const expected = i < limit ? okStatus : 429;
    let code = null;
    try {
      code = res.json().code;
    } catch {
      code = null;
    }
    const good = res.status === expected && (expected !== 429 || code === 'RATE_LIMITED');
    if (!good) {
      mismatch.add(1, { probe: label });
      if (bad++ < 3) console.warn(`${label} #${i + 1}: expected ${expected}, got ${res.status} ${code}`);
    }
  }
  console.log(`${label}: ${total} requests, limit ${limit}, mismatches ${bad}`);
}

// 목적: 인증 라우트와 일반 라우트의 한도를 차례로 확인한다.
// 이유: ADR 0054는 signin을 5/분, 나머지를 100/분으로 둔다.
// 방법: signin 6번(6번째가 429), 그 토큰으로 GET /file 105번(101번째부터 429)을 보낸다.
//       signin 카운터는 라우트별이라 GET /file 카운터와 섞이지 않는다.
export default function () {
  const basic = encoding.b64encode(`perf-vu-2@example.test:${PASSWORD}`);
  let token = null;
  probe('POST /auth/signin', 5, 6, 201, () => {
    const res = http.post(`${BASE}/auth/signin`, null, {
      headers: { Authorization: `Basic ${basic}` },
      responseCallback: http.expectedStatuses(201, 429),
    });
    if (res.status === 201 && !token) token = res.json().accessToken;
    return res;
  });
  if (!token) throw new Error('no token from signin');
  probe('GET /file', 100, 105, 200, () =>
    http.get(`${BASE}/file?take=1`, {
      headers: { Authorization: `Bearer ${token}` },
      responseCallback: http.expectedStatuses(200, 429),
    }),
  );
}
