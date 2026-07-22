# ADR 0006: `synchronize: false` + Manual Schema, Migrations to Be Adopted

- Status: Accepted
- Date: 2026-07-22 (`synchronize: false` committed 2026-04-14)
- 한국어: [0006-schema-policy-and-migration-adoption.ko.md](0006-schema-policy-and-migration-adoption.ko.md)

## Context

Early development ran with `synchronize: true` — TypeORM auto-altering the schema on
boot. That is a data-loss hazard the moment real data exists (a renamed column becomes
drop + add). The flag was flipped to `false` on 2026-04-14 (commit `2f2fc99`), but no
migration tooling replaced it, leaving schema changes without any managed path.

## Decision

- `synchronize: false` is committed and stays that way.
- **TypeORM migrations will be adopted** (`migration:generate`/`migration:run` scripts
  + `src/migrations/`) as a dedicated roadmap task — not bootstrapped as a side effect
  of another change.
- Until that task lands, the schema is applied manually (temporarily flipping
  `synchronize` in a local dev environment is transitional guidance that dies with
  migration adoption).
- Once migrations exist: entity change requests are described in plain text first, and
  `migration:generate` output is always reviewed line-by-line before running.
- Entities stay registered explicitly in `app.module.ts` (`entities: [...]`) alongside
  `autoLoadEntities: true` — both kept in sync when adding an entity.

## Consequences

- No environment can silently mutate the production-shaped schema.
- The manual window has a real cost: entity edits and DB state can drift until
  migrations land — this is the top roadmap item ([ROADMAP.md](../ROADMAP.md)).
- `CLAUDE.md` Scope Discipline forbids running `migration:generate` as a drive-by;
  schema changes are always described in plain text and approved first.
