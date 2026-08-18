---
name: doc-authoring
description: Run CLAUDE.md's five-role Documentation Authoring Protocol (조사→계획→질문→작성→검증) for README/ARCHITECTURE/CHANGELOG/ROADMAP/CONTRIBUTING/ADR authoring or overhaul. Use when asked to write or substantially revise a project-level doc.
---

# Documentation Authoring

Operationalizes CLAUDE.md's Documentation Authoring Protocol. Scope: README.md,
ARCHITECTURE.md, CHANGELOG.md, ROADMAP.md, CONTRIBUTING.md, `docs/ADR/` — plus their
`.ko.md` siblings. Run the five roles in order; do not collapse them, and do not start
writing before the earlier roles are done.

## 1. 조사 (Investigate)

Read the actual code, git history, and existing docs before writing a word. Every claim
must trace to a file, a commit, or test output — never to memory. Evidence expires: if
anything (a commit, an edit, another session) may have touched a file since you last read
it, re-read it before concluding from it.

## 2. 계획 (Plan)

Decide the document set, each document's scope, and its end-to-end structure. State which
documents change and why before editing any of them.

## 3. 질문 (Question)

Do not guess what the code cannot tell you. Implementation *intent*, the *reason* a
technology was chosen, and the *background* of a past decision live in the developer's
head, not the source — ask for them with AskUserQuestion before writing. Precede a choice
question with a compact options × criteria table so the developer decides from the table,
not from prose. A rationale is written only after it is confirmed — never inferred and
presented as fact.

## 4. 작성 (Write)

Write the English document, then its `.ko.md` sibling in the same change (Documentation
Convention — natural Korean, identical structure, code/paths/identifiers verbatim). Record
the trade-off and the rejected alternatives, not only the outcome. An architecturally
significant decision (schema change, new module, an alternative weighed and rejected) gets
its own ADR — see the `adr-authoring` skill. Cite the ADR or file that carries each
rationale rather than restating it.

## 5. 검증 (Verify)

- Relative links resolve
- EN/KO structure stays symmetric (same headings, same list/table layout)
- Endpoint/behavior claims match the real routes — grep to confirm, don't eyeball
- Nothing is stated as done that is not actually committed

## Do not

- Do not write prose before role 3's questions are answered.
- Do not infer a rationale and present it as fact — if role 3 wasn't asked, go back and ask.
- Do not skip the `.ko.md` sibling in role 4, even for a small change.
