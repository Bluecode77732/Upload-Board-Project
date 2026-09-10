# ADR 0012: httpOnly 쿠키 기반 refresh 토큰과 회전·재사용 감지

- 상태: 승인됨
- 날짜: 2026-07-24
- English: [0012-refresh-cookie-rotation.md](0012-refresh-cookie-rotation.md)

## 맥락

[ADR 0002](0002-dual-secret-token-pair.ko.md)는 토큰 쌍을 응답 body로 반환했고,
"유출된 refresh 토큰은 만료까지 유효하다"를 Swagger가 유일한 소비자인 무상태
API의 트레이드오프로 수용했다. 프론트엔드 분리
결정([ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md))이 그 전제를
무너뜨렸다: 브라우저 클라이언트는 refresh 토큰을 JavaScript가 닿는 곳에
저장해야 하고(XSS 표면), 서버 측 무효화 수단이 없는 장수명 토큰의 탈취는
브라우저 앱이 물려받을 수 있는 최악의 실패 모드다. 이 작업을 Stage 2에서
앞당긴 이유가 정확히 이것이다 — 프론트엔드 첫 줄을 쓰기 전에 인증 전송 방식을
확정한다.

## 결정

- **전송** — refresh 토큰은 `refreshToken`이라는 httpOnly 쿠키로만 이동하고,
  응답 body는 액세스 토큰만 싣는다(`{ accessToken }`). 쿠키 속성: `HttpOnly`,
  `SameSite=Strict`(XHR 전용 쿠키라 Lax와 실동작이 같으면서 가장 엄격),
  `Path=/auth/token`(refresh 엔드포인트에만 전송), `Max-Age` =
  `REFRESH_TOKEN_SECRET_EXPIRES_IN`, `ENV=prod`일 때 `Secure`, `Domain`
  미설정(호스트 전용). 액세스 토큰은 현행 Bearer 헤더 그대로다.
- **서버 측 앵커** — `UserEntity.refreshTokenHash`(nullable, `@Exclude`)가
  현행 refresh 토큰의 **SHA-256**을 저장한다; `null`은 활성 세션 없음을
  뜻한다. bcrypt가 아닌 SHA-256인 이유: JWT 문자열은 bcrypt의 72바이트 입력
  한계를 초과해 조용히 잘리고, 고엔트로피 토큰에는 느린 해시가 불필요하다.
  토큰 테이블이 아닌 컬럼 하나 — 계정당 1세션은 포트폴리오 규모에서 수용한
  트레이드오프이며(새 로그인이 다른 기기를 로그아웃), 멀티 디바이스 세션
  테이블은 필요해질 때의 별도 작업이다.
- **회전과 재사용 감지** — `POST /auth/token/refresh`는 쿠키의 JWT를
  검증(ADR 0002대로 시크릿 **그리고** `type` 클레임)한 뒤 그 SHA-256을 저장
  해시와 대조한다:
  - 일치 → 새 쌍 발급, 새 해시 저장, 쿠키 재설정;
  - 불일치 → 회수된 토큰의 재사용: 저장 해시를 비워(세션 전체 무효화)
    401 `AUTH_REFRESH_REUSED`(신규 코드 — ADR 0011 규칙상 추가는 자유)를
    반환;
  - 저장 해시 없음 / 미확인 사용자 / 잘못된 JWT → 401 `AUTH_TOKEN_INVALID`.
- **signout의 실체화** — 신규 `POST /auth/signout`(액세스 토큰 가드)이 저장
  해시와 쿠키를 지운다; 라우트 추가는 ADR 0010 동결에서 free다.
- **ADR 0002 개정** — "토큰의 서버 측 저장 금지" 조항을 개정한다(ADR 0002에
  날짜 병기 노트): 저장하는 것은 토큰 저장소가 아니라 현행 토큰 1개의
  *해시*(회전 앵커)이며, 이중 시크릿 + `type` 클레임 결정 자체는 불변이다.
  `parseBearerToken`은 분해되었다 — 순수 `verifyToken(token, isRefreshToken)`
  코어(시크릿+type, 둘 중 하나만은 없음)는 존속하고, 마지막 소비처를 잃은
  "Bearer " 분리 래퍼는 제거되었다.

## 기각한 대안

- **body 반환 유지 + 프론트 localStorage** — 이 작업이 닫으려는 XSS 표면을
  그대로 남기고, 나중의 전환은 (프론트+백엔드) 이중 breaking이 된다.
- **refresh 토큰 테이블(멀티 디바이스 세션, 토큰 패밀리)** — 실재하는
  요구사항이 없다; nullable 컬럼 하나로 회전+재사용 감지를 훨씬 적은
  스키마·코드 비용에 달성한다.
- **`SameSite=Lax` / `None`** — XHR 전용 쿠키에서 Lax는 Strict 대비 이점이
  없다; None은 CSRF 방어를 포기하고 로컬 HTTPS를 강제하며, 크로스 도메인
  배포에서만 필요해진다(Stage 4 배포 ADR에서 재검토).
- **저장 해시에 bcrypt** — 72바이트에서 조용히 잘린다; 고엔트로피 JWT
  문자열에는 잘못된 도구다.

## 결과

- Breaking(승인된 사전 결정 Stage F 작업, 소비자 0명): `signin`/`signin/local`
  body가 `{ accessToken }`으로 줄고, refresh 엔드포인트가 Bearer 헤더 대신
  쿠키를 소비한다.
- 탈취된 refresh 토큰은 다음 정상 갱신까지만 유효하며, 재사용 시 세션 전체가
  소리 내며 종료된다(`AUTH_REFRESH_REUSED`).
- 프론트엔드는 refresh/signout 호출에 `credentials: 'include'`를 보내야 하고,
  refresh 토큰 자체는 결코 보지 못한다.
- 세션 테이블 작업이 잡히기 전까지 계정당 1세션이다.
- Stage F 완결 — 프론트엔드가 의존할 API 표면·에러 계약·인증 전송이 모두
  확정되었다; frontend repository를 시작할 수 있다(RBAC은 API 표면을 바꾸지
  않으므로 병행).
