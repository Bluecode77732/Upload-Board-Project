# ADR 0009: Swagger로 문서화된 REST 전용 API 계층

- 상태: 승인됨
- 날짜: 2025-12-17
- English: [0009-rest-only-api-with-swagger.md](0009-rest-only-api-with-swagger.md)

## 맥락

API 표면은 작고(컨트롤러 4개, 라우트 약 13개) 요청/응답 형태입니다 — CRUD와 2단계
업로드. GraphQL, WebSocket, gRPC는 각각 스키마 계층, 클라이언트 스토리, 운영 복잡성을
추가하지만 기능 집합의 어느 것도 이를 요구하지 않습니다. API는 또한 프론트엔드 없이
수동 테스트가 가능해야 합니다.

## 결정

- NestJS 컨트롤러를 통한 REST 전용.
- Swagger(OpenAPI)가 API 문서이며 `/doc`에서 `persistAuthorization: true`로
  서빙됩니다. 자동 DTO 추론을 위해 `nest-cli.json`에 `@nestjs/swagger` CLI 플러그인이
  활성화되어 있습니다.
- 데코레이터 계약: 모든 컨트롤러는 `@ApiTags`를 달고, 엔드포인트는 `@ApiResponse`로
  상태 코드를 문서화하며, 인증 보호 컨트롤러는 `@ApiBearerAuth`, Basic 토큰
  엔드포인트는 `@ApiBasicAuth`를 답니다. Swagger 문서는 *실제* 동작을 기술해야 하며,
  데코레이터 괴리는 버그입니다.
- Swagger UI(및 Postman)가 공인된 수동 테스트 표면입니다. 프론트엔드는 없습니다.

**금지 제안** (명시적 요청 없이는): GraphQL, WebSocket, gRPC.

## 결과

- 하나의 프로토콜, 하나의 문서 소스. `/doc`은 수동 테스트 벤치를 겸합니다
  (등록/로그인은 Basic 인증, 나머지는 유지되는 Bearer 토큰).
- 모든 엔드포인트 변경에는 데코레이터 의무가 따릅니다 — 리뷰에서 검증합니다
  (`CLAUDE.md` Result Review: "`/doc`의 Swagger 문서가 실제 동작을 여전히
  기술하는지 검증").
- 실시간·스트리밍 능력은 없습니다. 그 필요가 생긴다면 점진적 증가가 아니라 명시적
  아키텍처 변경입니다.
