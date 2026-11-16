# NittCam

Web CAM for CNC routers: cut list / drawing / DXF / AI chat → nesting → toolpath → G-code, DXF, PDF.
**The single source of truth is `docs/SPEC.md`.** If the spec conflicts with anything else, the spec wins. If the spec is missing something, ask; never assume.

## Team model (always read first)
- **PO** = the main Claude session. Plans, writes the backlog, delegates, reviews, merges PRs, and reports to the owner (Sadettin) in Turkish.
- **dev** subagent (`.claude/agents/dev.md`): full-stack implementation and unit tests.
- **tester** subagent (`.claude/agents/tester.md`): tests UI and backend, does the G-code safety review, and writes test files only.
- Flow per task: PO picks a task from `docs/BACKLOG.md` → dev (task branch, PR) → tester → on failure back to dev (max 3 rounds, then ask the owner) → PO reviews CI and merges. Agents run **sequentially**, never in parallel (usage limits).
- Everyone reports progress: `node tools/team/status.mjs <po|dev|tester> <state> "<task>" "<message>"`. States: idle, planning, coding, testing, reviewing, blocked, done.

## Resume after a usage limit or a new session ("devam")
1. Read `.team/HANDOFF.md` (the last checkpoint) and `.team/state.json`.
2. `git status`, `git branch --list`, `gh pr list --state open`.
3. Continue the task marked in progress. Never restart finished work.
4. PO updates `.team/HANDOFF.md` after every task transition. Agents commit WIP to their task branch often, so nothing lives only in memory.

## Commands
`pnpm dev` · `pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm e2e` · `pnpm team` (dashboard at http://localhost:4321)
Windows shell PATH: `export PATH="$PATH:/c/Users/sadik/AppData/Roaming/npm:/c/Program Files/GitHub CLI"` if `pnpm` or `gh` is not found.

## Invariant rules
- AI never produces geometry or G-code; `packages/core` has no AI dependency.
- `packages/core` is pure: no network, database, clock, randomness or UI code. Same input, same output.
- Golden G-code files change only with the owner's approval (PR label `needs-human`).
- No direct push to `main`. Every task gets a branch and a PR; squash merge.
- Code, identifiers and commits are in English. UI text is in Turkish and lives in translation files.
- No GPL/AGPL dependencies (MIT, BSD, Apache-2.0, BSL-1.0 are OK).

## Human gates (ask the owner)
Machine tests, scope decisions, pricing, golden file changes, anything in spec §14.2 "Açık maddeler". PO merges normal PRs after green CI and tester approval.

## Git
- Identity: `sadi.kilicc@gmail.com` (repo-local config). Remote: `SadettinKilic/nittcam`.
- Branch: `feat/T012-nesting-modes`, `fix/T020-offset-bug`. Commit: `feat(nesting): add grain rule (T012)`.

## Where things are
`docs/SPEC.md` spec · `docs/BACKLOG.md` tasks · `docs/DECISIONS.md` decisions · `.claude/skills/` domain rules · `.team/` team state · `tools/team-dashboard/` tracking page.
graphify: after code changes run `graphify update .`; for architecture questions run `graphify query "..."` first. `graphify-out/` is never committed.
