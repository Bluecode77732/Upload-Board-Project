---
name: adr-authoring
description: Author a new ADR (or supersede/amend/extend an existing one) in this project's lightweight MADR style, matching docs/ADR/ conventions exactly — numbering, filename, .ko.md sibling, README.md table entry. Use when a decision has been confirmed as architecturally significant.
---

# ADR Authoring

Operationalizes the convention recorded in `docs/ADR/README.md`. Only run this after an
architecturally significant decision has actually been confirmed with the developer
(Clarification Protocol's last row) — this skill records a decision, it does not make one.

## Steps

1. **Check whether this amends, extends, or supersedes an existing ADR** rather than
   standing alone. Read `docs/ADR/README.md`'s table for anything covering related ground.
   - *Amends*: changes a prior decision's stance without replacing the whole thing (e.g.
     ADR 0029 D6 amending ADR 0005's storage framing).
   - *Extends*: builds on a prior decision without changing it (e.g. ADR 0040 extending
     ADR 0025/0027).
   - *Supersedes*: fully replaces a prior decision — flip the old ADR's `Status` line to
     `Superseded by NNNN`; never edit the original decision's Context/Decision text.

2. **Next number.** Take the next sequential number after the last row in
   `docs/ADR/README.md`'s table — check the table, not just the highest filename on disk,
   in case of a discrepancy.

3. **Filename.** `NNNN-short-kebab-title.md` + `NNNN-short-kebab-title.ko.md` sibling.

4. **Header block** (exact fields, in this order):
   ```
   # ADR NNNN: <Title>

   - Status: Accepted (or "Accepted — implemented", "Accepted (design-only)",
     "Accepted — implemented, unapplied", etc. — match what's actually true)
   - Date: YYYY-MM-DD
   - Amends / Extends / Supersedes: [ADR NNNN](...) <relationship, if any — omit if standalone>
   - 한국어: [NNNN-short-kebab-title.ko.md](NNNN-short-kebab-title.ko.md)
   ```

5. **Body sections, in order:**
   - `## Context` — the problem/gap being addressed, grounded in actual code/investigation
     (not invented)
   - `## Decision` — the chosen approach. If there are multiple distinct decision points,
     break them into `### D1 — <short title>`, `### D2 — ...` subsections rather than one
     undifferentiated block
   - `## Consequences` — what changes as a result, and what trade-offs were accepted

6. **`.ko.md` sibling in the same change** — natural Korean, identical structure
   (Documentation Convention).

7. **Update `docs/ADR/README.md` AND `docs/ADR/README.ko.md`** — add the new row to the
   table (# / Title / Status / Decided), keeping both tables in sync.

8. **Cross-check CLAUDE.md.** If this ADR's decision changes a rule CLAUDE.md states
   (Architecture Decisions, Never Do, Project-Specific Principles), CLAUDE.md needs its own
   update in the same change — an ADR records the *why*; CLAUDE.md is where the resulting
   rule actually lives and gets enforced day to day.

## Do not

- Do not write an ADR for a decision that hasn't been confirmed with the developer yet —
  that's role 3 of the `doc-authoring` skill (질문), not this skill.
- Do not edit a superseded ADR's Context/Decision text — flip its Status line only.
- Do not add a new ADR number without checking `docs/ADR/README.md`'s table first.
