# ADR 0001: HTTP Basic Token for Register/Sign-in

- Status: Accepted
- Date: 2025-12-17
- 한국어: [0001-basic-token-authentication.ko.md](0001-basic-token-authentication.ko.md)

## Context

Registration and sign-in need to carry an email/password pair to the server. The two
common options are a JSON body (validated by a DTO) or the standard `Authorization:
Basic base64(email:password)` header. This project was also built as a learning
exercise in the full spectrum of HTTP auth mechanisms (Basic → Bearer → JWT).

## Decision

`POST /auth/register` and `POST /auth/signin` accept credentials **only** via the
`Authorization: Basic` header, parsed by `AuthService.parseBasicToken`
(`src/auth/auth.service.ts`) — not by body DTOs. A body-credential alternative exists
solely as `POST /auth/signin/local` (Passport local strategy), kept to demonstrate the
strategy pattern.

## Consequences

- Credentials never appear in request bodies or query strings; Swagger's built-in
  Basic-auth prompt (`@ApiBasicAuth`) drives the flow at `/doc`.
- Malformed headers are rejected with `BadRequestException` at three parse points
  (scheme, split length, decoded shape).
- The email format is *not* DTO-validated on this path (the DTO pipe never sees the
  header) — validation coverage relies on the entity's `@IsEmail` and the parse steps.
- Two sign-in paths must stay behaviorally identical; changes to token issuance apply
  to both `signIn` and the local-strategy handler.
