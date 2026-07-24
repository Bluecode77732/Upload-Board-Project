# ADR 0002: `type` 클레임을 가진 이중 시크릿 액세스/리프레시 토큰 쌍

- 상태: 승인됨
- 날짜: 2025-12-17
- English: [0002-dual-secret-token-pair.md](0002-dual-secret-token-pair.md)

## 맥락

액세스·리프레시 토큰에 단일 JWT 시크릿을 쓰면 구조적으로 유효한 토큰이 어느
엔드포인트에서든 검증을 통과합니다 — 수명이 긴 리프레시 토큰이 액세스 토큰으로
재사용되어 세션 수명이 몇 분에서 리프레시 기간으로 조용히 늘어날 수 있습니다.
세션 기반 인증은 배제했습니다(무상태 API, 세션 저장소 없음).

## 결정

- 두 개의 시크릿: `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET`, 별도의 숫자형
  만료 환경변수(`*_EXPIRES_IN`).
- 페이로드 형태: `{ sub: userId, type: 'access' | 'refresh' }`
  (`backend/auth/interface/payload-interface.ts`).
- `parseBearerToken(rawToken, isRefreshToken)`은 대응하는 시크릿으로 검증하고
  **동시에** `payload.type`을 확인합니다 — 둘 중 하나만 하는 일은 없습니다.
- `JwtStrategy`는 액세스 토큰만 검증합니다. `POST /auth/token/refresh`는
  리프레시 토큰을 Bearer 헤더로 받아 새 액세스 토큰을 반환합니다.
  (2026-07-23: 리프레시 라우트를 `POST /auth/token/refresh`로 정규화 —
  [ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md).)
- `issueToken`은 `Pick<UserEntity, 'id'>`를 받으므로 순수 JWT 페이로드
  (`{ id: payload.sub }`)를 DB 왕복 없이 재토큰화할 수 있습니다.
- `JwtModule.register({})`가 비어 있는 것은 의도입니다 — 호출별 시크릿이 핵심입니다.

**금지**: 단일 공유 JWT 시크릿, 세션 기반 인증, 토큰의 서버 측 저장.

> 2026-07-24: "토큰의 서버 측 저장" 조항은
> [ADR 0012](0012-refresh-cookie-rotation.ko.md)로 개정되었다 — 저장하는 것은
> 토큰 저장소가 아니라 현행 refresh 토큰의 SHA-256 *해시*(회전·재사용 감지
> 앵커)다. 이중 시크릿 + `type` 클레임 결정은 불변이며, refresh 토큰은 이제
> httpOnly 쿠키로 이동하고 `parseBearerToken`의 순수 검증 코어는
> `verifyToken`으로 존속한다.

## 결과

- 리프레시→액세스 재사용이 구조적으로 불가능합니다: 잘못된 시크릿은 검증에 실패하고,
  같은 시크릿 버그가 있어도 `type` 검사에 걸립니다.
- 새 토큰 소비자는 두 검사를 모두 재현해야 하며, 이 규칙은 `CLAUDE.md`
  (Dual Token Authority)에 성문화되어 있습니다.
- 서버 측 폐기(revocation)는 없습니다 — 유출된 리프레시 토큰은 만료까지 유효합니다
  (무상태 포트폴리오 API로서 수용한 트레이드오프).
