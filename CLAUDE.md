# NittCam

Web CAM for CNC routers: cut list / drawing / DXF / AI chat → nesting → toolpath → G-code, DXF, PDF.
**The single source of truth is `docs/SPEC.md`.** If the spec conflicts with anything else, the spec wins. If the spec is missing something, ask; never assume.

## Team model (always read first)
- **PO** = the main Claude session. Plans, writes the backlog, delegates, reviews, merges PRs, and reports to the owner (Sadettin) in Turkish.
- **dev** subagent (`.claude/agents/dev.md`): full-stack implementation and unit tests.
- **tester** subagent (`.claude/agents/tester.md`): tests UI and backend, does the G-code safety review, and writes test files only.
- Flow per **batch** (D-036): PO picks a batch of 2–4 small tasks from `docs/BACKLOG.md` (e.g. "B7: T118–T120") → dev (one batch branch + one PR; commit, push and a PR checkpoint line after each task) → tester (only the batch's new/changed parts; fix rounds re-check only the reported bugs) → on failure back to dev (max 2 rounds, then the PO decides) → PO reviews CI and squash-merges.
- **Parallelism switch (owner, D-042):** the owner says "paralellik on" or "paralellik off". **on** (current, since 2026-11-19): while the tester checks batch N, the dev already builds batch N+1 in a separate git worktree (`../nittcam-dev`, branched from main; rebased onto main after batch N merges), so the two never share a checkout. **off**: agents run sequentially, as before. The current setting is in `.team/HANDOFF.md`.
- **Reviews (owner, D-042):** after every merged batch the PO does a short look (screenshots of the touched screens; does it look right, is anything broken) without deep digging; mismatches become small tasks. A **Fable** design review (`model: "fable"`) runs every **2 batches** on the whole app. Log both in `.team/HANDOFF.md`.
- **Review triage (owner, D-047):** the PO sorts every review finding into must-fix (safety, wrong output, blocking/dead-end flow, data loss, a11y blocker; max 3 tasks into the next batch) or the BACKLOG "Polish queue (M9)". Polish never delays progress. Batches: max 3 tasks + 1 rider.
- **Desktop-first (owner, D-043):** build and polish for PC first. Phone widths must not break (no horizontal scroll, primary action reachable, axe clean) but phone-specific polish waits for the mobile UI pass in `docs/BACKLOG.md`.
- **Context hygiene:** subagents cannot /compact. They use graphify first, read excerpts only, trim command output (`tail`/`grep`), and stop at a task boundary with a checkpoint in the PR description when their context grows; the PO then starts a fresh agent from that checkpoint. The PO keeps its own context lean the same way and copies checkpoints to `.team/HANDOFF.md`.
- **Models (owner's rule):** architecture decisions, planning and design reviews use the most capable model in the plan at no extra cost (Opus); dev = Opus; tester = Opus (owner allowed 2026-11-18).
- **Usage limit:** when an agent stops on a usage limit, the PO runs `node tools/team/status.mjs limit on "<HH:MM reset>"`, and after the reset `limit off`. The dashboard also turns red by itself when the status line reports a limit at 100%.
- **Questions to the owner** go on the dashboard too (the owner follows from the phone): `node tools/team/status.mjs ask "<question>" ["option" ...]` and ask in the terminal too; answers come from the dashboard or the terminal; then `answered <Qxxx> "<answer>"`. **No claude.ai artifacts** (owner's instruction): nothing is published or synced there.
- **Problems that need the owner** (2 failed tester rounds the PO cannot settle, red CI the PO cannot fix, a human gate): `node tools/team/status.mjs alert "<what to look at>"` shows a "PC'ye bak" popup with a beep on the dashboard; `alert off` once handled. A blocked agent, an open question or a full limit open the same popup automatically.
- Everyone reports progress: `node tools/team/status.mjs <po|dev|tester> <state> "<task>" "<message>"`. States: idle, planning, coding, testing, reviewing, blocked, done.

## Resume after a usage limit or a new session ("devam")
1. Read `.team/HANDOFF.md` (the last checkpoint) and `.team/state.json`.
2. `git status`, `git branch --list`, `gh pr list --state open`.
3. Continue the task marked in progress. Never restart finished work.
4. PO updates `.team/HANDOFF.md` after every task transition. Agents commit WIP to their task branch often, so nothing lives only in memory.

## Commands
`pnpm dev` · `pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm e2e:local <specs>` (low memory: 1 worker, one local e2e on the PC at a time) · `pnpm e2e:changed` · `pnpm ci:full <branch>` · `pnpm ci:baselines <branch>` · `pnpm ci:gate <pr>` · `pnpm team` (dashboard at http://localhost:4321)
Windows shell PATH: `export PATH="$PATH:/c/Users/sadik/AppData/Roaming/npm:/c/Program Files/GitHub CLI"` if `pnpm` or `gh` is not found.

## Invariant rules
- AI never produces geometry or G-code; `packages/core` has no AI dependency.
- `packages/core` is pure: no network, database, clock, randomness or UI code. Same input, same output.
- Golden G-code files change only with the owner's approval (PR label `needs-human`).
- No direct push to `main`. Every task gets a branch and a PR; squash merge.
- Code, identifiers and commits are in English. UI text is in Turkish and lives in translation files.
- No GPL/AGPL dependencies (MIT, BSD, Apache-2.0, BSL-1.0 are OK; MPL-2.0 only as a devDependency, OFL-1.1 for fonts, D-032).

## Human gates (ask the owner)
Machine tests, scope decisions, pricing, golden file changes, anything in spec §14.2 "Açık maddeler". PO merges normal PRs after green CI and tester approval. **Lean CI (owner, 2026-11-18; D-048):** PR pushes run only fast checks. The full check (5 e2e shards + visual/axe + build + db, ~5 min) runs after every merge on main and before a merge on demand: `pnpm ci:full <branch>`, or `pnpm ci:baselines <branch>` when the batch changes screens on purpose (same full run, and it commits the changed Linux baselines to the branch). The PO merges only when `pnpm ci:gate <pr>` says OK (all required jobs green on the PR head; a CI baseline commit on top is accepted). Docs-only changes run nothing.

## Git
- Identity: `sadi.kilicc@gmail.com` (repo-local config). Remote: `SadettinKilic/nittcam`.
- Branch per batch: `feat/B07-cutlist-grid` (single tasks: `feat/T012-nesting-modes`, `fix/T020-offset-bug`). Commit per task: `feat(nesting): add grain rule (T012)`.

## Where things are
`docs/SPEC.md` spec · `docs/BACKLOG.md` tasks · `docs/DECISIONS.md` decisions · `.claude/skills/` domain rules · `.team/` team state · `tools/team-dashboard/` tracking page.
graphify: after code changes run `graphify update .`; for architecture questions run `graphify query "..."` first. `graphify-out/` is never committed.
