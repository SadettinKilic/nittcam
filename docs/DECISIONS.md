# Decisions (ADR log)

Every new decision goes here (or into the spec). Claude Code does not remember earlier conversations.

## D-001 Team model: PO + dev + tester (2026-11-16)
The main session acts as PO (backlog, delegation, review, merge, reporting). Two subagents: `dev` (full stack) and `tester` (UI + backend tests and the §7.2 G-code safety review; it merges the spec's `safety-reviewer` role). They run sequentially. The owner (Sadettin) decides scope, pricing, machine tests and golden files. **Override of spec §10.2/10.5:** the PO merges PRs itself after green CI and tester PASS (owner's instruction).

## D-002 Repo location and identity (2026-11-16)
The repo lives at `tao_tech/nittcam/nittcam` (product-folder convention of the workspace) with the remote `SadettinKilic/nittcam` (private). The commit identity is `sadi.kilicc@gmail.com`, set repo-locally. Credentials go through `gh auth git-credential` (personal account) for this repo only.

## D-003 Usage-limit resilience (2026-11-16)
State lives on disk, not in conversation: `.team/state.json` (live status), `.team/HANDOFF.md` (last checkpoint, updated by PO at each task transition), WIP commits pushed to task branches. On "devam", the resume protocol in `CLAUDE.md` runs. `tester` runs on Sonnet to save quota; `dev` inherits the main model.

## D-004 Local database without Docker (2026-11-16)
The dev machine has no Docker. Local dev and tests use **PGlite** (Postgres compiled to WASM, in-process), so `pnpm dev` and `pnpm test` need no service. CI and production use a real Postgres (`DATABASE_URL`). `docker-compose.yml` (Postgres + MinIO) stays for later. File storage sits behind an adapter: local filesystem now, S3-compatible later. Revisit if PGlite lacks a needed feature.

## D-005 Runtime versions (2026-11-16)
Node ≥ 22 (CI runs on Node 24 LTS), pnpm 9 via the `packageManager` field. TypeScript strict.

## D-006 Branch protection without GitHub Pro (2026-11-16)
The free plan has no branch protection on private repos. Instead: Claude's `.claude/settings.json` denies pushes to `main` and force pushes; every change goes through a PR; the PO merges only after green CI and tester PASS. Revisit if the owner moves to GitHub Pro.

## D-007 M0 backlog approved by the owner (2026-11-16)
