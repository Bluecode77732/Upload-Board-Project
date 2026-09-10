# ADR 0028: 액세스 토큰에 `role` 클레임 추가

- Status: Accepted
- Date: 2026-08-05
- Amends: [ADR 0002](0002-dual-secret-token-pair.ko.md) (`Payload` 형태만)
- Relates to: [ADR 0013](0013-rbac-and-audit-log.ko.md) (이번에 노출하는 역할 계층),
  [ADR 0022](0022-admin-console-import-from-chat-project.ko.md) (막혀 있던 소비자)
- English: [0028-access-token-role-claim.md](0028-access-token-role-claim.md)

## Context

[ADR 0013](0013-rbac-and-audit-log.ko.md)이 3단계 역할과 서버 측 강제(`RolesGuard` +
`@Roles`)를 배포했지만, 클라이언트가 자기 역할을 알 방법은 남기지 않았다. 액세스 토큰
payload는 `{ sub, type }`뿐으로 의도적으로 최소화돼 있어([ADR 0002](0002-dual-secret-token-pair.ko.md)),
이 토큰만 쥔 클라이언트는 자신이 `user`인지 `admin`인지 구분할 수 없다. admin UI라면 자기
라우트를 게이팅하는 데 이 정보가 필요하다(클라이언트가 잘못된 메뉴를 그리는 것은 서버 측
비용은 없지만 UX 비용은 있고, 이식된 콘솔은 이 정보가 존재한다고 가정한다).

[ADR 0022](0022-admin-console-import-from-chat-project.ko.md)의 수정 백로그가 이를 구체적으로
기록했다: 이식된 `admin/` 콘솔은 `jwtDecode<{ sub, role }>(accessToken)`을 읽어 그 결과로
자기 라우트를 게이팅한다. 이 API를 상대로는 디코드해도 `role` 필드가 없으므로 가드가
`undefined`를 보고 모든 admin을 거부한다 — 이 문제가 풀리기 전까지 콘솔은 동작할 수 없고,
ROADMAP은 이 행을 **Stage 5 나머지를 막는 행**으로 지목했다.

이 ADR이 신중히 구분하는 두 가지: **누가 행동할 수 있는가**와 **자신이 무엇을 할 수 있는지
누가 아는가**. `RolesGuard`/`AuthUser`는 오늘도 이미 첫 번째 질문에 정확히 답하고 있다 —
`JwtStrategy.validate`가 매 요청마다 `userService.findOne(payload.sub)`로 DB에서 사용자를
읽어 살아있는 `role`을 `request.user`에 담아 돌려주고, 두 소비자 모두 실제로 읽는 값은
그것이다. 액세스 토큰 payload는 이 강제 경로에 한 번도 관여한 적이 없다. 이번 결정은 오직
두 번째 질문 — 클라이언트가 추가 왕복 없이 자기 역할을 읽는 방법 — 에 관한 것이다.

## Decision

**액세스 토큰 payload에 선택적 `role: UserRole` 필드를 추가한다
(`backend/auth/interface/payload-interface.ts`), 액세스 토큰에만 채운다.** 리프레시 토큰은
기존의 최소 형태(`{ sub, type, jti }`)를 유지한다 — 리프레시 토큰은 UI 목적으로 클라이언트가
디코드하는 대상이 아니므로 실을 것이 없다.

- `AuthService.issueToken(user, isRefreshToken)`은 이제 `Pick<UserEntity, 'id' | 'role'>`을
  받는다(이전에는 `Pick<UserEntity, 'id'>`). payload에 `role: user.role`을 넣는 것은 액세스
  토큰 분기에서만이며, 기존의 "`jti`는 리프레시에서만" 조건문과 같은 형태로 짝을 맞췄다.
- `AuthService.issueTokenPair`도 동일하게 확장한다. 모든 호출부(`signIn`,
  `rotateRefreshToken`, `AuthController.userLocalLoginPassport`)가 이미 완전한 `UserEntity`(혹은
  Passport가 검증한 동등물)를 쥐고 있었으므로, `userLocalLoginPassport`의 지역 선언 요청
  타입을 넓힌 것 외에는 런타임 변경이 필요 없었다.
- **강제(enforcement)에는 변경 없음.** `JwtStrategy.validate`, `RolesGuard`, `AuthUser`는
  손대지 않았다 — 여전히 매 요청마다 새로 `userService.findOne`을 읽어 `role`을 얻으며, 토큰
  payload에서는 절대 읽지 않는다. 새 클레임은 오직 클라이언트만 읽는다.

## 이 형태를 고른 이유 — 검토한 대안과 비교

| 기준 | A. 액세스 토큰에 role 클레임 (**채택**) | B. 클라이언트가 `GET /user/:id` 호출 | C. 신규 `GET /auth/me` 엔드포인트 |
|---|---|---|---|
| `Payload`/ADR 0002 변경 | 있음 | 없음 | 없음 |
| 신규 엔드포인트 | 없음 | 없음 | 있음 |
| 앱 로드/재발급마다 추가 요청 | **없음** — 이미 쥐고 있는 토큰에서 디코드 | 1회 | 1회 |
| role 신선도 | 액세스 토큰 TTL로 한정(로컬 180초, 환경별 설정 가능) | 항상 최신(DB 직독) | 항상 최신(`request.user`, 추가 쿼리 없음) |
| 클라이언트가 자기 id를 먼저 알아야 하는가 | 아니오 | 예 — 이 라우트를 부르려면 여전히 `sub`을 디코드해야 함 | 아니오 |
| 기존 클라이언트 패턴과의 정합성 | **일치** — 프론트엔드는 이미 `sub`을 얻으려 액세스 토큰을 클라이언트 측에서 디코드 중(Frontend Repo 메모리; 프론트 ADR 없음), 이식된 `admin/` 콘솔도 이미 `jwtDecode<{ sub, role }>`를 가정 | 오늘 **ownership 가드가 전혀 없는** 라우트에 얹는 형태(이미 아무 인증 사용자나 타인의 행을 id로 조회 가능) | `AuthModule`은 원래 토큰만 담당하는데(Module Responsibility) 새 표면이 추가됨 |

A안을 고른 이유는 하나의 실질적 비용을 압도하는 두 가지 이유 때문이다:

1. **새 패턴을 도입하는 대신 이미 실전에 있는 패턴에 맞춘다.** 프론트엔드는 이미 액세스
   토큰을 클라이언트가 디코드 가능한 봉투로 다루고 있다. 여기에 필드 하나를 더 얹는 것은,
   모든 클라이언트에게 로그인마다·조용한 재발급마다 두 번째 요청을 시키도록 가르치는 것보다
   실질적으로 더 작은 변경이다.
2. **신선도 창은 한정돼 있고 권한을 좌우하지 않는다 — 보안 구멍이 아니다.** A안의 유일한
   실질 비용 — 강등된 admin의 *디코드된* role이 액세스 토큰 TTL만큼 지연될 수 있다는 점 —
   은 실제 권한으로 전혀 이어지지 않는다. `RolesGuard`는 제시된 토큰의 `role` 클레임이
   무엇이든 상관없이 매 요청마다 DB에서 role을 다시 끌어오므로, 최악의 경우도 클라이언트
   UI의 낡은 메뉴 항목일 뿐 우회된 검사가 아니다. 그렇다면 짧고 TTL로 못박힌 창에 신선도
   저하를 허용하는 편이 더 안전하다 — 이것은 무효화 신호가 없는 무한 캐시가 아니라 만료가
   확실한 UI 전용 값이다.

B안과 C안은 같은 축에서 기각됐다: 좁은 의미에서는 더 정확하다(role이 항상 최신) — 하지만 그
정확성이 여기서는 필요 없다. 보호 대상(실제 인가)은 애초에 걸려 있지 않았고, 걸려 있던 건
클라이언트 측 표시값뿐이었기 때문이다. 강제 경로가 어차피 항상 최신 값을 다시 끌어오는데,
UI 전용 값을 최신으로 유지하려고 앱 로드마다 요청 비용을 치르는 것은 아무것도 그 값에
의존하지 않는 속성을 최적화하는 셈이다.

## Alternatives rejected

- **B. 클라이언트가 `GET /user/:id`로 role을 가져온다** — 주된 기각 이유는 이것이
  클라이언트의 토큰 디코드 필요를 없애지 못한다는 점이다: 클라이언트는 여전히 `sub`을
  디코드하지 않고는 자기 `id`를 알 방법이 없으므로, "필드 하나 더 디코드"를 "필드 하나
  디코드 후 요청 하나 더"로 바꾸는 셈 — 같은 신뢰 모델에 일이 더 느는 것이고, 요청 대상
  자체도 오늘 ownership 가드가 없는 라우트에 얹힌다(이미 아무 인증 사용자나 타인을 id로
  조회 가능 — 이 ADR과 무관하게 존재하는 별개의 상태).
- **C. 신규 `GET /auth/me` 엔드포인트** — 단독으로 보면 가장 깔끔한 형태다(id 추측 불필요,
  `AuthUser` 재사용, `Payload` 변경 없음). 하지만 A안이 이미 공짜로 푸는 문제를 다시 푸는
  것이라 기각한다: 이 요청은 앱 로드마다·조용한 재발급마다 실행되는데, 그 대상 값(role)은
  클라이언트가 이미 쥔 데이터에서 A안이 이미 내주고 있다. A안의 신선도 창이 장차 어떤
  민감한 UI 표면에서 용납 불가로 판단될 경우의 대체안으로 기록해 둔다 — 그 경우 이 ADR의
  payload 변경을 대체하는 것이지, 확장하는 것이 아니다.

## Consequences

- **`Payload`에 선택 필드 하나 추가.** `role?: UserRole`, 액세스 토큰에만 존재. JWT payload
  형태에 추가적일 뿐, 기존 소비자는 깨지지 않는다(`jti`가 이미 "한 토큰 종류에만 존재하는
  필드"라는 같은 패턴을 세워 두었다).
- **`issueToken`/`issueTokenPair` 시그니처가 `Pick<UserEntity, 'id'>`에서
  `Pick<UserEntity, 'id' | 'role'>`로 넓어진다.** 현재 모든 호출부가 이미 완전한
  `UserEntity`(혹은 Passport가 검증한 동등물)를 쥐고 있었으므로,
  `AuthController.userLocalLoginPassport`의 지역 선언 요청 타입을 맞춰 넓힌 것을 빼면 컴파일
  타임에서만 일어나는 변경이다.
- **`id`뿐이던 시그니처가 문서로 남겨 두었던 여지 — 순수 JWT payload(`{ id: payload.sub }`)만으로
  DB 왕복 없이 재토큰화하는 것([ADR 0002](0002-dual-secret-token-pair.ko.md)) — 은 이제 막힌다.**
  현재 어떤 호출부도 이를 실제로 쓴 적이 없다(`signIn`, `rotateRefreshToken`,
  `userLocalLoginPassport` 모두 이미 앞선 DB 조회로 얻은 완전한 user를 쥐고 있다)는 점에서, 이는
  동작 변경이 아니라 잠재적으로만 존재하던 여지가 사라진 것이다. 훗날 순수 `sub`만으로
  재토큰화하려는 호출자가 생긴다면, 어딘가에서 `role`을 먼저 구해야 하는데 — 그것이 바로 이
  ADR이 다른 곳에서 치르지 않게 하려던 그 DB 조회다.
- **서버 측 인가에는 변경이 없다.** `RolesGuard`/`AuthUser`는 계속 `JwtStrategy.validate`의
  매 요청 DB 조회에서 나온 `request.user.role`을 읽는다. 액세스 토큰의 `role` 클레임은 어떤
  가드도 참조하지 않는다 — 오직 클라이언트가 읽으라고만 존재한다.
- **역할 변경(`PATCH /user/:id/role`)은 이미 대상의 `refreshTokenHash`를 null로 만들어**
  ([ADR 0013](0013-rbac-and-audit-log.ko.md)) 다음 재발급 시도에서 세션을 끝낸다. 짧은
  액세스 토큰 TTL과 겹쳐, 클라이언트에 보이는 role 클레임은 신선도가 문제될 수 있는 유일한
  경우(강등)에서도 빠르게 스스로 바로잡힌다.
- **Stage 5의 남은 행을 막던 문제를 해소한다.** 이식된 `admin/` 콘솔의
  `jwtDecode<{ sub, role }>(accessToken)` 가정이 이제 이 API에서도 성립한다 — 콘솔 적응
  (ROADMAP Stage 5, 2번째 행)이 진행될 수 있다.
- **스키마 변경, 마이그레이션, 새 에러 코드, 새 엔드포인트 모두 없음.**
