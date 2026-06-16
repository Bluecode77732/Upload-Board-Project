# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hallucination Prevention (환각 방지)

Before making any change:
1. Inspect the codebase thoroughly — read the relevant files, grep for symbols, trace the actual call chain.
   Concern-to-entrypoint map (check these first):
   - Auth flow change    → read `backend/src/auth/`; grep `JwtAuthGuard`, `RbacGuard`
   - Chat/WS change      → trace `backend/src/chat/chat.gateway.ts` → `chat.service.ts` → `QueryRunnerDecorator`
   - Redis change        → read `backend/src/redis/redis-subscriber.service.ts`; check pub/sub channel names
   - GraphQL schema      → read `backend/src/schema.gql` before adding any type or field
   - Frontend auth       → read `frontend/src/api/apollo.ts` (errorLink) and `frontend/src/socket/socket.ts` (reconnectSocket)
2. Never invent APIs, files, functions, or types that you have not confirmed exist in the codebase.
3. Reuse existing patterns only; do not introduce new abstractions unless explicitly asked.
4. Verify every assumption with actual code, search results, or test output — not memory or inference alone.
5. Run `pnpm lint` and `pnpm test` (or the relevant subset) before claiming success.
6. Show the exact diff of changes made, not a paraphrase.
7. Explicitly state all uncertainties instead of guessing — say "I'm not sure" and propose a verification step.

## Scope Discipline (범위 준수)

Do not make any of the following unless explicitly requested:
- Unrelated refactors or code cleanups
- Architectural changes
- New dependency additions — confirm via pnpm before installing
- Schema or migration changes — if an entity change is needed, describe the required column/relation in plain text and stop. Never run `pnpm migration:generate`.
- Large-scale formatting edits

High-blast-radius files — require explicit approval before any edit:
`app.module.ts`, `*.entity.ts`, `*.interceptor.ts`, `backend/src/schema.gql`

Touching any of the following always counts as "beyond the stated task":
AppModule providers array, EntityBase, shared guards, `redis-subscriber.service.ts`

If a change requires touching files beyond the stated task, list all affected files first and wait for approval.
Stick strictly to the stated task.

## Clarification Protocol

Before implementing anything non-trivial, ask the one question that applies:

| Trigger                               | Ask                                                                                |
|---------------------------------------|------------------------------------------------------------------------------------|
| New handler (Gateway or Resolver)     | Does this need `@UseInterceptors(WsQueryRunnerInterceptor)` or REST equivalent?    |
| New Guard                             | Where in the `JwtAuthGuard → RbacGuard → handler` chain does this sit?            |
| New Redis key                         | What TTL and does it follow `{service}:{entity}:{id}` naming?                     |
| New GraphQL type or field             | Will this conflict with existing types in `schema.gql`?                            |
| Frontend auth flow change             | Does `apollo.ts` errorLink or `socket.ts` reconnectSocket need a parallel update? |

Ask one focused question rather than a list. Do not proceed on assumptions when intent is ambiguous.

## Analysis Protocol (분석)

### Introduction Analysis (도입)
When a new tool, library, or concept is being introduced, always cover the following before writing any code:
- Background: why it was created and what problem it solves
- Implementation purpose: what specific goal it serves in this context
- Practical disadvantages if not implemented, and the root causes of those disadvantages

Do not write excessive code during this phase.

### Structure Analysis (구조)
When planning an implementation, answer the following before proceeding:
- What overall structure will this create, end to end?
- Does the current structure and plan align with general web development principles?
- Provide a detailed breakdown: overall architecture, page flow, data flow, etc.
- What is the core relationship between this implementation and the existing project?
- If a relationship exists, what is the concrete, practical impact of that relationship?

  Project structure checklist:
  - Does this add a NestJS provider? → which module's `providers[]` needs it?
  - Does this change transaction scope? → verify correct decorator: `QueryRunnerDecorator` (REST) vs `WsQueryRunnerDecorator` (WS)
  - Does this modify the GraphQL schema? → restart server to regenerate `schema.gql`, then diff it

### Modification Analysis (수정)
For each change being made, explicitly state:
- What does this change mean in plain terms?
- What is the purpose of implementing it?
- Why is it being implemented at this stage specifically?
- Does it fit the existing design structure — verify and list the reasons it does or does not.

  Service-level impact:
  - `ChatService` change → check `chat.service.spec.ts` for broken mocks
  - `AuthService` change → check `auth.service.spec.ts`; verify guard chain still holds
  - `SessionCacheService` change → verify all Redis hash field names remain consistent

### Result Review (결과 검토)
After completing any implementation, apply the review perspective that matches what was just done.

**After an Introduction:**
- Did this tool/library actually solve the problem it was introduced to solve?
- Is the implementation purpose clearly reflected in the result?
- Would skipping this still cause the practical disadvantages described earlier?

**After a Structure change:**
- Does the implemented structure match the plan that was laid out?
- Is it consistent with existing patterns in the codebase?
- Does the data flow and page flow behave as designed?

**After a Modification:**
- Do the changes work correctly? Run `pnpm lint` and `pnpm test` to verify.
  - Socket.IO handler changed → verify `handleConnection` and `handleDisconnect` are symmetric (every `socket.on` in connect must have a matching `socket.off` in disconnect)
  - `apollo.ts` changed → verify split link still routes: subscription → `wsLink`, rest → `errorLink → authLink → httpLink`
  - Redis key added → confirm TTL is set and key follows `{service}:{entity}:{id}` naming
- Are there any regressions in existing functionality?
- What side effects or hidden risks does this change introduce?
- Is the change isolated enough, or does it bleed into unrelated areas?

## Change Summary

After completing any task, always append a brief summary in this format:

```
## Change Summary
- What changed: <one line per file or concern>
- Why: <the stated reason>
- Side effects: <impact on: schema.gql / Redis key set / guard chain / frontend graphql-operations.ts>
- Guard chain impact: <any change to guard order or new guard added — list affected endpoints; omit if no guard was touched>
- Pending: <anything deferred, left incomplete, or requiring follow-up>
```

## Never Do — Forbidden Patterns
These patterns defeat the purpose of TypeScript and cause production failures.
Violations are grouped by failure class.

### GROUP 1 — Runtime Crash

Patterns that pass compilation but crash at runtime — they nullify the reason for using TypeScript.

```typescript
// ❌ Non-null assertion → Cannot read properties of null
user!.email
// ✅
user?.email ?? throw new Error('user is null')

// ❌ Type casting bypasses type checker → wrong type propagates to DB
const req = context.req as AuthRequest
// ✅
if (!isAuthRequest(req)) throw new UnauthorizedException()

// ❌ any — type errors silently pass through refactors
parse(data: any)
// ✅
parse(data: unknown) // narrow with typeof / instanceof

// ❌ @ts-ignore without explanation — masks real errors
// @ts-ignore
// ✅
// @ts-expect-error: upstream type mismatch in graphql-ws v5, tracked in #123

// ❌ Empty catch — swallows errors, invisible in Sentry
try { ... } catch (e) {}
// ✅
catch (e) { this.logger.error(e); throw e; }

// ❌ Floating promise → unhandledRejection crashes process
publishMessage()
// ✅
await publishMessage()

// ❌ JSON.parse without try/catch → immediate crash on bad input
JSON.parse(rawBody)
// ✅
try { JSON.parse(rawBody) } catch { throw new BadRequestException() }

// ❌ Synchronous blocking → blocks event loop, all requests stall
fs.readFileSync('file')
// ✅
await fs.promises.readFile('file')

// ❌ Load all records into memory → heap OOM on large datasets
await this.chatRepository.find()
// ✅
await this.chatRepository.find({ take: 50, skip: offset })

// ❌ EventEmitter listener leak → OOM over time (Socket.IO rooms)
socket.on('message', handler)  // without cleanup
// ✅
socket.on('message', handler)
socket.on('disconnect', () => socket.off('message', handler))

// ❌ DB connection pool exhaustion → all new requests hang
const conn = await dataSource.getConnection()  // never released
// ✅ Always use QueryRunnerDecorator — interceptor handles release
```

### GROUP 2 — Data Integrity

Patterns that cause data loss or inconsistency — the most irreversible class of failure.

```typescript
// ❌ synchronize: true → TypeORM auto-alters schema → data loss in prod
TypeOrmModule.forRoot({ synchronize: true })
// ✅
TypeOrmModule.forRoot({ synchronize: false })
// Migrations only via: pnpm migration:generate / pnpm migration:run

// ❌ Multiple DB writes without transaction → partial update on failure
await this.roomRepository.save(room)
await this.chatRepository.save(message)  // if this fails, room is orphaned
// ✅ Use QueryRunnerDecorator — interceptor handles commit/rollback

// ❌ N+1 query → DB overload under traffic
const rooms = await this.roomRepository.find()
for (const room of rooms) {
  room.chats = await this.chatRepository.find({ where: { room } })
}
// ✅
await this.roomRepository.find({ relations: ['chats'] })

// ❌ process.env.X directly → undefined propagates silently to DB
const secret = process.env.JWT_SECRET
// ✅ All env vars validated at startup via Joi; access via ConfigService only
const secret = this.configService.get<string>('JWT_SECRET')

// ❌ Pagination missing → full table scan, OOM, slow response
getMessages(): Promise<ChatEntity[]>
// ✅
getMessages(take: number, skip: number): Promise<ChatEntity[]>
```

### GROUP 3 — Security

Patterns where an external attacker is the threat — discovered latest, highest damage.

```typescript
// ❌ JWT secret hardcoded → full token forgery if source is exposed
sign(payload, 'mysecret')
// ✅
sign(payload, this.configService.get('JWT_SECRET'))

// ❌ bcrypt rounds < 10 → brute-force vulnerable
bcrypt.hash(password, 4)
// ✅
bcrypt.hash(password, 12)

// ❌ CORS origin: * → any domain can make authenticated requests
app.enableCors({ origin: '*' })
// ✅
app.enableCors({ origin: configService.get('ALLOWED_ORIGIN'), credentials: true })

// ❌ Raw @Body() without DTO → malicious payload reaches DB
async register(@Body() body: any)
// ✅
async register(@Body() dto: RegisterDto)  // class-validator enforced

// ❌ Role from client body → privilege escalation
const role = dto.role
// ✅ Role assigned server-side only, never from request payload

// ❌ Stack trace in error response → internal structure exposed
throw new Error(err.stack)
// ✅ GlobalExceptionFilter strips internal details in prod

// ❌ Sensitive data in logs → token/password in plaintext
this.logger.log(JSON.stringify(user))
// ✅
this.logger.log(`user signed in: ${user.id}`)

// ❌ File upload without validation → malicious file, storage exhaustion
@UploadedFile() file: Express.Multer.File
// ✅ Validate mimetype + size limit in multer config

// ❌ Redis keys without TTL → unbounded memory growth
await this.redis.set(key, value)
// ✅
await this.redis.set(key, value, 'EX', 86400)
```

## Architecture Decisions

Do not suggest alternatives to these decisions without explicit request.

### Auth
- accessToken: 15m lifetime, stored in-memory on frontend (Zustand store)
- refreshToken: 7d lifetime, stored in localStorage (httpOnly cookie migration pending)
- Guard order: `JwtAuthGuard` → `RbacGuard` → handler
- WebSocket auth: JWT validated on `handleConnection` via connectionParams
- **Never suggest**: REST-only auth, session-based auth, storing accessToken in localStorage

### Cache (Redis via ioredis)
- Key naming: `{service}:{entity}:{id}` — e.g. `chat:session:userId`
- TTL required on every key — no indefinite cache
- pub/sub uses dedicated subscriber connection (`redis-subscriber.service.ts`)
- **Never suggest**: node-redis (ioredis is unified across codebase)

### Database (PostgreSQL + TypeORM)
- `synchronize: false` always — migrations only
- All multi-write operations via `QueryRunnerDecorator` or `WsQueryRunnerDecorator`
- Relations: always explicit (`eager`/`lazy` never assumed from defaults)
- **Never suggest**: `synchronize: true`, inline raw transactions

### API Layer
- GraphQL (Apollo) for all queries, mutations, subscriptions
- Socket.IO for real-time chat events only
- **Never suggest**: adding REST controllers where GraphQL infrastructure exists
- **Never suggest**: mixing Socket.IO and GraphQL Subscription for the same event

## Project Overview

Real-time one-to-one chat application. NestJS backend + React frontend in a **pnpm monorepo** (`backend/` and `frontend/` as workspace packages). Deployed on Railway (backend) and Vercel (frontend).

## Commands

### Root (workspace-level)
```bash
pnpm install          # Install all workspace dependencies
pnpm build            # Build backend (pnpm --filter backend build)
pnpm test             # Run backend tests
pnpm lint             # Lint backend
```

### Backend
```bash
cd backend
pnpm start:dev        # Development server with hot reload (port 3000)
pnpm build            # Compile TypeScript to dist/
pnpm lint             # ESLint with auto-fix
pnpm format           # Prettier formatting
pnpm test             # Unit tests (Jest)
pnpm test:cov         # Unit tests with coverage report
pnpm test:e2e         # End-to-end tests (test/ directory)
pnpm migration:generate -- src/migrations/MigrationName
pnpm migration:run    # Run pending migrations
```

### Frontend
```bash
cd frontend
pnpm dev              # Vite dev server (port 5173)
pnpm build            # Production build
pnpm lint             # ESLint
```

### Targeting a single test file
```bash
cd backend
pnpm test -- --testPathPattern=auth.service
```

### Docker (local full stack)
```bash
docker compose up -d --build
```

## Architecture

### Monorepo Layout
- **`backend/`** — NestJS backend (pnpm workspace package, single deployable)
- **`frontend/`** — React + Vite (pnpm workspace package)
- **`backend/src/`** — NestJS source
- **`backend/test/`** — E2E specs
- **`backend/src/migrations/`** — TypeORM migration files

### Backend Modules

**AppModule** wires together:
- `ConfigModule` — Joi-validated env (see `backend/.env.example` for all required vars)
- `TypeOrmModule` — PostgreSQL with `synchronize: false`; auto-runs migrations in prod
- `GraphQLModule` — Apollo Driver, auto-generates `backend/src/schema.gql`, subscriptions via `graphql-ws`
- `UserModule`, `ChatModule`, `AuthModule`

**AuthModule** (`backend/src/auth/`)
- REST: `POST /auth/register`, `POST /auth/signin`, `POST /auth/token/refreshaccess`
- JWT access + refresh token pair; access token in memory, refresh token in localStorage
- Guards: `JwtAuthGuard`, `LocalAuthGuard`, `RbacGuard`, `GraphqlAuthGuard`
- `UserRole` enum: `user` (0) | `admin` (1)

**ChatModule** (`backend/src/chat/`)
- `ChatGateway` — Socket.IO: validates JWT on `handleConnection`, joins rooms, handles `sendMessage`
- `ChatResolver` — GraphQL: `sendMessage` mutation, `receiveMessage` subscription (by roomId), `getOnlineUser` query
- `SessionCacheService` — tracks `userId → {socketId, status}` in Redis hashes with 24h TTL
- `RateLimitGuard` — Redis-backed 10 messages/min per user
- Transaction interceptors wrap both REST and WebSocket handlers for ACID message saves

**RedisModule** (`backend/src/redis/`) — global module; provides `ioredis` client and `SessionCacheService`

**GraphQL PubSub** (`backend/src/graphql/pubsub.service.ts`) — `RedisPubSub` singleton bridging mutations to subscriptions

### Data Flow for Sending a Message
1. Client emits `sendMessage` via Socket.IO or GraphQL mutation
2. `RateLimitGuard` checks Redis counter
3. Transaction interceptor opens a `QueryRunner`
4. `ChatService.sendMessage()` resolves or creates `RoomEntity`, saves `ChatEntity` in the transaction
5. Publishes to Redis Pub/Sub channel; subscribers receive via `receiveMessage` subscription
6. Socket.IO also broadcasts to the room

### Entities (TypeORM)
- `UserEntity` — email (unique), hashed password, role, relations to chats/rooms
- `ChatEntity` — message text, participant (sender FK), room FK
- `RoomEntity` — many-to-many with users (join table), one-to-many with chats
- All extend `EntityBase` (created/updated timestamps, excluded from API responses)

### Frontend Architecture (`frontend/src/`)
- **`api/apollo.ts`** — Apollo Client config
- **`api/graphql-operations.ts`** — all GQL queries, mutations, subscriptions in one file
- **`socket/socket.ts`** — Socket.IO client singleton
- **`store/auth.store.ts`** — Zustand store: JWT in memory, refresh token in localStorage
- **`pages/`** — `chat-page.tsx`, `signin-page.tsx`, `register-page.tsx`
- **`components/protected-route.tsx`** — wraps authenticated routes

## Key Conventions

### Testing
- Tests live alongside source files as `*.spec.ts`
- Jest excludes controllers, gateways, guards, interceptors, resolvers, decorators, strategies, DTOs, entities from coverage — only services and the Redis module are measured
- Bcrypt mocked globally via `backend/src/mocks/bcrypt.ts`
- `mockReturnValue` (sync) vs `mockResolvedValue` (async) — must not be confused
- `QueryRunner` mock pattern: `as unknown as QueryRunner`
- DB direct access in tests is forbidden — use repository mocks

```typescript
// Standard repository mock pattern
const mockRepository = {
  findOne: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
};
```

### Environment Variables
- Copy `backend/.env.example` to `backend/.env` for local dev
- All vars validated at startup via Joi; missing vars throw on boot
- `DB_TYPE` must be `"postgres"`
- Never access `process.env` directly — use `ConfigService`

### Transactions
- Use `QueryRunnerDecorator` (REST) or `WsQueryRunnerDecorator` (WebSocket) to inject `QueryRunner`
- Do not create raw transactions inline
- Interceptors handle commit/rollback automatically

### Logging
- Use injected NestJS `Logger` (winston under the hood)
- Logs write to `logs/logs.log` and `logs/error.logs.log` in non-Vercel environments
- Never log sensitive fields: `password`, `token`, `refreshToken`, `secret`

### Code Style
- Single quotes, trailing commas (`backend/.prettierrc`)
- `@typescript-eslint/no-explicit-any` is off in ESLint — but `any` is still forbidden by convention (see Never Do)
- Floating promises are warnings in ESLint — but must be awaited or caught by convention (see Never Do)

### Frontend Conventions

#### State (Zustand — `frontend/src/store/auth.store.ts`)
- `accessToken`, `userId` — in-memory only; intentionally excluded from `partialize`
- `lastRecipientId` — only persisted field via `persist` middleware
- Non-React contexts (apollo.ts, socket.ts): always read via `useAuthStore.getState()`, not hooks
- **Never**: add a second `persist` key for auth data; never access `localStorage` directly for tokens

#### Apollo Client (`frontend/src/api/apollo.ts`)
- `errorLink` owns all 401 recovery (refresh → retry) — do not add duplicate retry logic in components
- `authLink` calls `useAuthStore.getState()` at request time; this is intentional, not a stale-closure bug
- Split rule: subscriptions → `wsLink`; queries/mutations → `errorLink → authLink → httpLink`
- **Never**: instantiate a second `ApolloClient`

#### Socket.IO (`frontend/src/socket/socket.ts`)
- `socket` is a mutable module export; `reconnectSocket()` reassigns it after token refresh
- `autoConnect: false` is intentional — connect only after auth is confirmed
- **Never**: call `socket.connect()` before verifying `accessToken` is non-null

#### GQL Operations (`frontend/src/api/graphql-operations.ts`)
- All queries, mutations, subscriptions in one file — do not split by feature
- New operation: append to file, follow existing `gql` tag naming convention

#### Components
- Route auth: handled solely in `protected-route.tsx` — no auth checks inside page components
- No component-level API instances — all data via Apollo or the shared `socket` singleton

## CI/CD

GitHub Actions (`.github/workflows/deploy.yml`):
1. **Test job**: `pnpm install` → `pnpm --filter backend lint` → `pnpm --filter backend test` (Node 24, pnpm 10.14.0)
2. **Deploy job**: `pnpm --filter backend build` → Railway CLI deploy (requires `RAILWAY_TOKEN` secret)

Railway start command: `cd backend && pnpm migration:run && node dist/main`