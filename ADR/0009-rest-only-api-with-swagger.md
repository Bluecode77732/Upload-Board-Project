# ADR 0009: REST-Only API Layer Documented with Swagger

- Status: Accepted
- Date: 2025-12-17
- 한국어: [0009-rest-only-api-with-swagger.ko.md](0009-rest-only-api-with-swagger.ko.md)

## Context

The API surface is small (4 controllers, ~13 routes) and request/response shaped —
CRUD plus a two-step upload. GraphQL, WebSocket, or gRPC would each add a schema
layer, a client story, and operational complexity that nothing in the feature set
requires. The API also needs to be manually testable without building a frontend.

## Decision

- REST only, via NestJS controllers.
- Swagger (OpenAPI) is the API documentation, served at `/doc` with
  `persistAuthorization: true`; the `@nestjs/swagger` CLI plugin is enabled in
  `nest-cli.json` for automatic DTO introspection.
- Decorator contract: every controller carries `@ApiTags`; endpoints document status
  codes via `@ApiResponse`; auth-protected controllers carry `@ApiBearerAuth`,
  Basic-token endpoints `@ApiBasicAuth`. The Swagger doc must describe the *real*
  behavior — decorator drift is a bug.
- Swagger UI (plus Postman) is the sanctioned manual test surface; no frontend exists.

**Never suggest** (without explicit request): GraphQL, WebSocket, gRPC.

## Consequences

- One protocol, one documentation source; `/doc` doubles as the manual test bench
  (Basic auth for register/sign-in, persisted Bearer token for the rest).
- Any endpoint change carries a decorator obligation — verified in review
  (`CLAUDE.md` Result Review: "verify the Swagger doc at `/doc` still describes the
  real behavior").
- No real-time or streaming capability; if that need ever arises it is an explicit
  architectural change, not an increment.
