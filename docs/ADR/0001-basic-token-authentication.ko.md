# ADR 0001: 등록/로그인에 HTTP Basic 토큰 사용

- 상태: 승인됨
- 날짜: 2025-12-17
- English: [0001-basic-token-authentication.md](0001-basic-token-authentication.md)

## 맥락

등록과 로그인은 이메일/비밀번호 쌍을 서버로 전달해야 합니다. 일반적인 두 가지 방법은
JSON body(DTO 검증) 또는 표준 `Authorization: Basic base64(email:password)` 헤더입니다.
이 프로젝트는 HTTP 인증 메커니즘 전체 스펙트럼(Basic → Bearer → JWT)을 학습하는
목적도 함께 갖고 있었습니다.

## 결정

`POST /auth/register`와 `POST /auth/signin`은 자격 증명을 **오직**
`Authorization: Basic` 헤더로만 받으며, `AuthService.parseBasicToken`
(`backend/auth/auth.service.ts`)이 파싱합니다 — body DTO를 쓰지 않습니다. body 자격 증명
대안은 전략 패턴 시연을 위해 유지한 `POST /auth/signin/local`(Passport local 전략)
하나뿐입니다.

## 결과

- 자격 증명이 요청 body나 쿼리 스트링에 나타나지 않습니다. Swagger 내장 Basic 인증
  프롬프트(`@ApiBasicAuth`)가 `/doc`에서 흐름을 이끕니다.
- 잘못된 헤더는 세 개의 파싱 지점(스킴, 분리 길이, 디코딩 형태)에서
  `BadRequestException`으로 거부됩니다.
- 이 경로에서는 이메일 형식이 DTO로 검증되지 *않습니다*(DTO 파이프가 헤더를 보지
  못함) — 검증 커버리지는 엔티티의 `@IsEmail`과 파싱 단계에 의존합니다.
- 두 로그인 경로는 동작이 동일하게 유지되어야 합니다. 토큰 발급 변경은 `signIn`과
  local 전략 핸들러 양쪽에 적용됩니다.
