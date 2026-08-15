# ADR 0008: `CORS_ORIGIN`을 통한 opt-in CORS

- 상태: 승인됨
- 날짜: 2026-07-22
- English: [0008-opt-in-cors.md](0008-opt-in-cors.md)

## 맥락

API에는 CORS 설정이 전혀 없었습니다 — 동일 출처/Swagger 사용에는 문제없지만, 다른
출처의 브라우저 프론트엔드는 차단됩니다. 피해야 할 두 가지 실패 형태는 소스에 출처를
하드코딩하는 것과 고전적인 `origin: '*'`(어떤 도메인이든 인증된 요청을 보낼 수 있게
함)입니다.

## 결정

CORS는 **기본적으로 꺼져** 있고, 선택적 환경변수 `CORS_ORIGIN`이 설정된 경우에만
활성화됩니다 (`backend/main.ts`):

- `CORS_ORIGIN`은 콤마로 구분된 출처 허용 목록이며, 부트스트랩에서 분리·트리밍됩니다.
  Joi 스키마에 선택적으로 선언되고 `.env.example`에 문서화되어 있습니다.
- 활성화 시: `credentials: true`, 메서드 `GET, POST, PATCH, DELETE, OPTIONS`,
  허용 헤더 `Content-Type, Authorization`.
- 변수 미설정 = `enableCors`가 호출되지 않음 — 관대한 기본값 없음.

**금지**: `origin: '*'`, `main.ts`에 출처 하드코딩.

## 결과

- 로컬 Swagger/동일 출처 사용은 설정이 전혀 필요 없습니다.
- 브라우저 프론트엔드 추가는 코드 변경이 아니라 환경변수 한 줄 변경입니다.
- 프론트엔드를 추가하는 사람은 변수 설정을 기억해야 합니다 — 실패 형태는 브라우저
  콘솔에 보이는 CORS 에러이지, 조용한 보안 구멍이 아닙니다.
