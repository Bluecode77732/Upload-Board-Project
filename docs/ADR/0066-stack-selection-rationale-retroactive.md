# ADR 0066: Stack selection rationale, recorded retroactively

- Status: Accepted — a retroactive record; no code, schema or API change
- Date: 2026-10-12
- Relates to: [ADR 0009](0009-rest-only-api-with-swagger.md) (REST via NestJS controllers), [ADR 0043](0043-terraform-project-adaptation.md) and [ADR 0047](0047-observability-prometheus-grafana.md) (the AWS and observability reasons that were already written down), [ADR 0053](0053-global-rate-limiting.md) and [ADR 0054](0054-per-route-rate-limit-tuning.md) (the rate-limit values), [ADR 0065](0065-multi-file-upload-client-sequential.md) D4 (the 15-file batch)
- 한국어: [0066-stack-selection-rationale-retroactive.ko.md](0066-stack-selection-rationale-retroactive.ko.md)

## Context

Four choices that shape this project have no recorded reason. A search of `docs/`, `README.md`,
`frontend/` and the changelog on 2026-10-12 found only what is listed here.

| Choice | What the repository already says | What it does not say |
|---|---|---|
| NestJS, TypeORM, PostgreSQL | The first commit (2025-12-17) is already a NestJS app ([CHANGELOG.md](../CHANGELOG.md), "Initial application"). ADR 0009: "REST only, via NestJS controllers." | Why these three. |
| AWS/EKS with Helm and Terraform | ROADMAP §6 calls it "the industry-standard DevOps toolchain." ADR 0043 gives reasons for RDS (D2), Graviton nodes (D3) and ACM (D4); ADR 0047 gives reasons for Prometheus and Grafana. | Why AWS and Kubernetes rather than another way to run containers. No document mentions ECS or Fargate. |
| `frontend/` without a state or data-fetching library | `frontend/CLAUDE.md`: do not add one; propose with a rationale first. The stack itself, React + Vite, was decided 2026-07-24 (ROADMAP §7). | Why none was needed. |
| 100 / 5 / 15 requests per minute | ADR 0053 D1: a "conservative default." ADR 0054: the credential routes and `POST /upload/attach` are the surfaces to tighten. ADR 0065 D4: 15 files per selection because attach is limited to 15 a minute. | Where the numbers come from. |

The developer supplied the reasons on 2026-10-12. This ADR writes them down next to what the
repository already shows, and says plainly which parts are unrecorded or unmeasured.

The date above is when this was written, not when the choices were made. The stack dates from
2025-12-17, the AWS tooling entered the plan on 2026-07-23 (ROADMAP, Consistency note), the
frontend stack was fixed on 2026-07-24, and the rate limits landed on 2026-09-10.

## Decision

### D1 — NestJS, TypeORM and PostgreSQL

Chosen with a later move toward services in mind, if heavy traffic ever arrives. NestJS's module
and dependency-injection structure also enforces the module split this project relies on (Auth,
User, File, Post, Comment, Upload), and it has first-party integrations for the pieces used here:
Passport, Swagger and Throttler. TypeORM fits NestJS and provides the `QueryRunner` that the manual
transaction pattern needs ([ADR 0004](0004-transaction-pattern-selection.md)).

PostgreSQL is what the design leans on: the typed outcomes for `23505` and `23503`
([ADR 0019](0019-upload-claim-idempotency.md), [ADR 0023](0023-board-domain-schema.md)) and the
`pg_trgm` GIN indexes behind title search ([ADR 0049](0049-performance-capacity-criteria.md)).

The services idea is forward-looking and nothing more. What exists is a layered modular monolith
with one replica (ROADMAP §4), and ROADMAP §7 explains why no service mesh was added. The
preparation is the module boundaries, which only talk through `exports`/`imports` contracts, and
the `FileStorage` port. Two things would block scaling out today: the in-memory rate-limit counter
([ADR 0053](0053-global-rate-limiting.md)) and the `local` storage default
([ADR 0029](0029-storage-port-adapter.md)).

### D2 — AWS/EKS with Helm and Terraform

Two reasons. Kubernetes brings an ecosystem that is reused as is: Helm for releases, Terraform
modules for the cluster, Prometheus and Grafana for observability. And learning the tools that are
standard in the deployment market was itself a goal of the project, the same way ADR 0001 records
learning the HTTP authentication mechanisms as a goal. ROADMAP §1 describes the project as a
portfolio and learning backend.

The reasons for the parts inside that choice are in ADR 0043 (RDS, Graviton, ACM) and ADR 0047
(Prometheus, Grafana, and the rejection of the managed AMP/AMG).

No comparison with ECS, Fargate or any other container service was written down when this was
chosen, and this ADR does not reconstruct one. The cost of the choice that is on record is the
hourly charge for the EKS control plane, RDS, the NAT gateway and the ALB
([ADR 0043](0043-terraform-project-adaptation.md) D1).

### D3 — A frontend without a state or data-fetching library

`frontend/` has few screens, and its server state is lists and detail pages. A `fetch` wrapper and
component state were enough, and a library would only have added a dependency, bundle weight and
upkeep. `frontend/README.md` also records one place where `fetch` was not enough: upload progress
uses an `XMLHttpRequest` path in the same file, because `fetch` exposes no upload-progress event.

`admin/` differs on purpose. It came from the Chat Project already built on Zustand and axios
([ADR 0022](0022-admin-console-import-from-chat-project.md)), and was adapted rather than rewritten.

Adding a library later goes through the rule in `frontend/CLAUDE.md`: propose it with a rationale
first.

### D4 — The rate-limit values

- **100 per minute** is the global default. ADR 0053 D1 records it as a single conservative
  default asked for by the developer.
- **5 per minute** applies to `register`, `signin` and `token/refresh`. It lets a person retry
  after a typo and cuts a scripted guess to a handful of attempts a minute.
- **15 per minute** applies to `POST /upload/attach`, and it is also the 15-file selection cap in
  [ADR 0065](0065-multi-file-upload-client-sequential.md) D4.

These are judgment calls. No load test or abuse data stands behind them. They would be revisited
with the move to more than one replica that ADR 0053 already names, since the counters are
per-instance until then.

## Consequences

- A "why" question about any of the four choices now has a document to point at, and that document
  says which parts are the developer's stated reasoning and which were never weighed in writing.
- The services reasoning in D1 must not be read as a claim that microservices exist or are
  scheduled. ROADMAP §4 and §7 stay the statement of the current architecture.
- Two gaps are recorded rather than filled: no ECS/Fargate comparison exists, and the rate-limit
  values are unmeasured.
- No change to `CLAUDE.md`. Its Architecture Decisions already treat these choices as settled.
  [ARCHITECTURE.md](../ARCHITECTURE.md) gains a one-line pointer to this ADR.
