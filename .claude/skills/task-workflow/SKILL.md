---
name: task-workflow
description: Every NittCam task: backlog format, branch/commit/PR naming, definition of done, status reporting. Use at the start and end of any task.
---

# Task workflow

## Backlog format (docs/BACKLOG.md)
```
### T012 Rectangle placer: min-waste mode   [status: todo|doing|review|done]
Spec: §6.2  ·  Depends: T006  ·  Owner: dev
Acceptance:
- [ ] parts never overlap (fast-check)
- [ ] ...
```

## Flow
1. PO moves the task to `doing` and updates `.team/HANDOFF.md`.
2. dev: branch `feat/Txxx-short` (or `fix/`, `chore/`, `docs/`, `test/`) → commits `type(scope): msg (Txxx)` → PR.
3. tester: PASS/FAIL comment on the PR. A FAIL goes back to dev (max 3 rounds, then ask the owner).
4. PO: CI green + tester PASS → `gh pr merge <n> --squash --delete-branch` → task `done` → HANDOFF updated.

## PR template
What / Why (spec §) / How tested / Acceptance checklist / Screenshots (UI) / Risks.

## Definition of done
Acceptance criteria all checked · unit tests (and property tests for core invariants) · lint+typecheck+test green in CI · tester PASS · Turkish UI text in translation files · decisions recorded in `docs/DECISIONS.md` · no golden file change without `needs-human`.

## Status reporting
`node tools/team/status.mjs <po|dev|tester> <idle|planning|coding|testing|reviewing|blocked|done> "<Txxx>" "<short Turkish message>"` at every step change.
