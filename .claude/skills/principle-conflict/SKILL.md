---
name: principle-conflict
description: Run CLAUDE.md's Principle Conflict Protocol when applying an Engineering Principle would conflict with an existing rule, established pattern, or current implementation — including a violation discovered mid-task. Stops work, explains the conflict, and offers three resolution paths for the developer to choose. Use the moment a conflict is noticed, not after picking a side.
---

# Principle Conflict Protocol

Operationalizes CLAUDE.md's Principle Conflict Protocol. The trigger is broad on purpose:
any tension between "Engineering Principles" and an existing rule, established pattern, or
current implementation — noticed while planning, or discovered mid-task. The moment it's
noticed, stop. Do not continue past the conflict, and do not silently resolve it by
picking a side — that includes Auto Mode's default bias toward proceeding without asking;
this protocol is exactly the case where that bias does not apply.

## Steps

1. **Stop and explain.** State which principle is in tension with which existing rule or
   pattern — cite `file:line` for the existing rule/pattern, not just its name — and why
   the conflict exists. If work already started this turn, stop advancing it; don't finish
   the change first and explain after.

2. **State a prevention plan.** A concrete, scoped way to avoid this same conflict
   recurring — e.g., a new row in the Clarification Protocol table, or a documented
   convention added to Project-Specific Principles. This is a proposal to include alongside
   the resolution paths below, not something to implement yet.

3. **Ask step-by-step, not as one flat question.** Narrow down with the developer what is
   negotiable and what is not before proposing a resolution. Use AskUserQuestion for this
   rather than a single open-ended paragraph.

4. **Offer three resolution paths and let the developer choose** — do not default to one:
   - **Autonomous implementation** — proceed with the original plan, knowingly accepting
     the principle violation. State exactly what is being violated and why it is
     acceptable to leave as-is.
   - **Alternative implementation** — a scoped change that satisfies both the principle
     and the existing rule/pattern. State the concrete diff and its cost.
   - **Principle-faithful implementation** — fully honor the new principle, accepting the
     cost to the existing rule/pattern. State what changes and its cost.

   If two paths converge on the same concrete change, say so rather than presenting
   artificial alternatives — three distinct-sounding options that are actually the same
   diff is worse than naming the convergence directly.

5. **Wait.** Do not implement any path until the developer selects one.

## Do not

- Do not resolve the conflict yourself and mention it only in the Change Summary — the
  protocol is a stop-and-ask, not a disclose-after-the-fact.
- Do not skip step 4's three-path framing in favor of a single recommendation — the
  developer chooses the trade-off, not the model.
- Do not treat this as optional under Auto Mode — a principle conflict is one of the
  "genuinely blocked, needs the developer's decision" cases Auto Mode still stops for.
