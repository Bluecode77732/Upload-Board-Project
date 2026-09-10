---
name: migration-review
description: Walk through CLAUDE.md's required migration:generate review workflow — plain-text description first, line-by-line diff review, strip spurious constraint-rename statements, then separate approval before migration:run. Use when an entity/relation change needs a migration.
---

# Migration Review

Operationalizes CLAUDE.md's Scope Discipline > Schema changes rule and the Architecture
Decisions > Database migration policy. Do not skip steps or run `migration:generate`/
`migration:run` from anywhere but this sequence.

## Steps

1. **Plain-text description first.** Before touching any code, state in plain text: which
   entity, which column/relation, nullable/default, and why. Get explicit confirmation from
   the developer. Never run `migration:generate` without this having already happened — the
   `check-migration-generate.js` PreToolUse hook enforces an approval prompt for the command
   itself, but the actual plain-text description still has to precede it.

2. **Confirm entity registration.** If this is a new entity, it must be added to
   `backend/entities.ts`'s `ENTITIES` array only — not `app.module.ts` or
   `backend/data-source.ts` directly (both import that one array). An entity missing from
   `ENTITIES` is invisible to `migration:generate` even though it would be live in the app.

3. **Run** `pnpm migration:generate -- backend/migrations/<Name>`.

4. **Review the generated file line-by-line.** The baseline migration
   (`1784678400000-InitialSchema.ts`) uses readable constraint names, not TypeORM hashes —
   `generate` diffs against the DB and may emit spurious `DROP CONSTRAINT`/`ADD CONSTRAINT`
   rename statements for constraints that didn't actually change. Identify and strip those;
   keep only the statements that implement the described change.

5. **Re-confirm scope.** After stripping, the migration's `up()`/`down()` should contain
   exactly the described column/relation change — nothing else. If anything else survived,
   go back to step 4.

6. **New table → update the e2e suite too.** If this migration creates a table,
   `test/e2e-utils.ts`'s `MIGRATIONS` and `TABLES` need their own line — omitting it fails
   loudly on the next e2e run, but it is a separate edit from the migration file itself.

7. **Final approval before running.** Show the cleaned migration file and ask for explicit
   approval before `pnpm migration:run`. Step 1 confirmed the *intent*; this step confirms
   the *generated SQL* — they are not the same approval.

## Do not

- Do not run `migration:generate` speculatively "to see what it does" — step 1 comes first.
- Do not accept `generate`'s output verbatim without step 4's line-by-line pass.
- Do not run `migration:run` in the same turn as `generate` without step 7's separate approval.
