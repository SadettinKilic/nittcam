# NittCam Backlog

Statuses: `todo` · `doing` · `review` · `done` · `blocked`. Format and definition of done: `.claude/skills/task-workflow`.
Order inside a milestone is the order of work. Agents run sequentially.

---

## M0: Temel (exit: CI green; offset decision recorded in DECISIONS.md)

### T001 Monorepo skeleton   [status: todo]
Spec: §8.3, §10.1 · Depends: none · Owner: dev
Acceptance:
- [ ] pnpm workspace with `apps/web` (Next.js App Router, React, Tailwind), `packages/core`, `packages/db`, `packages/ui`, `packages/machines`, `e2e/`
- [ ] TypeScript strict across the repo; shared `tsconfig.base.json`; `packages/core` cannot import from `apps/*` (enforced by lint rule or TS project refs)
- [ ] ESLint + Prettier; root scripts `dev`, `build`, `test`, `lint`, `typecheck`, `e2e`, `team`
- [ ] Vitest runs in core with one sample test; Playwright set up with one smoke test (home page renders a Turkish title)
- [ ] `apps/web` home page shows "NittCam" with Turkish text from `messages/tr.json`
- [ ] `.gitignore` covers node_modules, .next, coverage, graphify-out, .env*, playwright reports
- [ ] `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass locally

### T002 CI + branch protection + licence check   [status: todo]
Spec: §10.5, §8.3 · Depends: T001 · Owner: dev (PO sets branch protection)
Acceptance:
- [ ] `.github/workflows/ci.yml` on PRs and pushes to main: install (frozen lockfile), lint, typecheck, unit tests, build, Playwright (chromium)
- [ ] Licence check fails the build on GPL/AGPL dependencies (allow MIT, BSD, Apache-2.0, BSL-1.0, ISC, 0BSD, CC0)
- [ ] Golden-file guard: PRs touching `packages/machines/**/golden/**` get label `needs-human`
- [ ] Node version pinned (`.nvmrc` / `engines`), pnpm via `packageManager` field
- [ ] Branch protection on `main`: PR required, CI must pass, no force push (PO applies via `gh api`)

### T003 Claude Code setup: CLAUDE.md, skills, agents, permissions   [status: review]
Spec: §10.2–10.4, §10.6 · Depends: none · Owner: PO
Acceptance:
- [x] `CLAUDE.md` (short; team model, resume protocol, rules, human gates)
- [x] 10 skills in `.claude/skills/` (task-workflow … ai-chat)
- [x] `.claude/agents/dev.md`, `.claude/agents/tester.md` (tester also does the §7.2 safety review)
- [x] `.claude/settings.json` permissions
- [x] team status CLI `tools/team/status.mjs` + dashboard `tools/team-dashboard/`
- [ ] merged via PR after T001/T002 so CI validates it

### T004 Project JSON schema v1 (Zod) + example projects   [status: todo]
Spec: §9.2, §6.1, §8.2 · Depends: T001 · Owner: dev
Acceptance:
- [ ] `packages/core/schema`: Zod schema matching §9.2 (schemaVersion, machine, stock, parts, nesting, layout, cutting); all lengths in mm
- [ ] parametric parts: `params` is the source and `outline` is derived; freeform parts: `outline` is the source
- [ ] migration registry `migrate(json) → latest` with a v1 no-op and a test
- [ ] 3 example projects in `packages/core/schema/__fixtures__/` (cabinet doors, shelf set, mixed with holes) that validate
- [ ] invalid examples are rejected with readable errors (tests)

### T005 Command layer skeleton + first 5 commands   [status: todo]
Spec: §5.1 · Depends: T004 · Owner: dev
Acceptance:
- [ ] registry with apply / undo / redo / log (who, when, command); pure apply via Immer patches
- [ ] commands: setMachine, setMaterial, setThickness, setSheetSize, addPart
- [ ] validation hook runs after each command and returns a warning list
- [ ] property test: apply then undo restores the project exactly, for random command sequences
- [ ] the command schemas export as JSON Schema (future AI tool definitions)

### T006 Geometry core: bulge polyline   [status: todo]
Spec: §6.1 · Depends: T001 · Owner: dev
Acceptance:
- [ ] types `Vertex {x,y,bulge}`, `Polyline {vertices, closed}`; constants EPS=0.001, JOIN_TOL=0.05
- [ ] functions: signedArea, orientation/normalize (outer CCW, inner CW), bbox (arc-aware), length (arc-aware), transform (translate, rotate 90° steps, mirror)
- [ ] fast-check: area invariant under translation and rotation; bbox contains every sampled point; orientation round-trips

### T007 Offset spike: CavalierContours (WASM) vs Clipper2 + arc fitting   [status: todo]
Spec: §8.3, §14.1 · Depends: T006 · Owner: dev
Acceptance:
- [ ] both candidates evaluated on the same fixtures (rect, rounded rect, inner contour, small radius below the tool radius, self-intersecting result)
- [ ] criteria scored: arc preservation, correctness (distance property test), browser + Node support, bundle size, licence, maintenance
- [ ] decision written to `docs/DECISIONS.md`; the chosen one wrapped behind `offset(polyline, d)` in core with property tests

### T008 Database: schema v1 + local dev without Docker   [status: todo]
Spec: §8.5, §9.1, §8.6 · Depends: T001 · Owner: dev
Acceptance:
- [ ] `packages/db` Drizzle schema for the §9.1 tables; every table has `company_id` (except companies); migrations generated
- [ ] local dev and tests use PGlite (embedded Postgres) by default (D-004); `DATABASE_URL` switches to a real Postgres; `docker-compose.yml` kept for later
- [ ] storage adapter interface with a local-filesystem implementation (S3/MinIO later)
- [ ] tenant-scoped query helper + test: company A cannot read company B's rows

### T009 Detailed M1 backlog   [status: todo]
Spec: §12.2 · Depends: T001–T008 · Owner: PO
Acceptance:
- [ ] T010–T024 written with acceptance criteria and dependencies; owner approves

---

## M1: İnce dilim (outline; detailed in T009)
T010 machine and tool profile schema + form (Z zero, origin) · T011 cut list table + Excel/CSV paste · T012 rectangle placer (min waste, gap, margin, multi-sheet) · T013 layout view (2D canvas) · T014 toolpath model: outer contour, multi-pass, lead-in/out · T015 tabs + small-part auto tabs · T016 cut order + rapid ordering · T017 post config schema + generator; "generic plain G-code"; first golden files · T018 G-code reader · T019 automatic checks + safety scenario tests · T020 simulation screen · T021 NC export, header, unverified-profile warning · T022 air cut test program + test part · T023 simple project save + wizard skeleton · T024 Playwright e2e flow
