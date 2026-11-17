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
- [ ] ~~Branch protection~~ not available on the free plan for private repos (D-006); local deny rules + PO merge discipline instead

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
- [ ] validation rule: blind pocket depth < thickness (§4.5)

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
- [x] `packages/db` Drizzle schema for the §9.1 tables; every table has `company_id` (except companies); migrations generated
- [x] local dev and tests use PGlite (embedded Postgres) by default (D-004); `DATABASE_URL` switches to a real Postgres; `docker-compose.yml` kept for later
- [x] storage adapter interface with a local-filesystem implementation (S3/MinIO later)
- [x] tenant-scoped query helper + test: company A cannot read company B's rows

### T009 Detailed M1 backlog   [status: done]
Spec: §12.2 · Depends: T001–T008 · Owner: PO
Acceptance:
- [x] T010–T024 written with acceptance criteria and dependencies
- [x] owner approved (2026-11-16)

---

## M1: İnce dilim (exit: a file downloaded from the browser passes every automatic check; then field test 1) — **exit met 2026-11-17 (T024, #31); field test 1 pending (owner)**

Goal: cut list → nesting → toolpath → G-code → air cut on a real machine, as early as possible (spec §12, v2 change table). Single user, rectangular parts, outer contour only. Order = dependency order.

### T010 Machine & tool profile: schema, versions, form   [status: done]
Spec: §7.1, §6.4, §3.4, §3.6 · Depends: T008 · Owner: dev
Acceptance:
- [ ] core Zod `MachineProfile`:
  - identity; work envelope X/Y/Z; table size
  - **origin corner + axis directions**
  - **Z-zero reference (table | material top) + spoilboard allowance**
  - spindle (min/max rpm, warm-up dwell)
  - tool changer (auto/manual/none, capacity, G43 yes/no)
  - hold-down (vacuum M codes)
  - constraints (file-name length, file size, arcs, line numbers, drill cycle)
- [ ] tool table (number, type, diameter, flute length, flutes) and material parameter sets per material + thickness (feed, plunge, rpm, pass depth)
- [ ] saving a profile creates a new immutable `machine_profile_versions` row; verification resets to "re-verification needed" when the profile, tool set or post version changes (§7.3)
- [ ] Makineler page: list + create/edit form (Turkish, validation messages, empty/loading/error states); seed profile "Genel düz G-code router"
- [ ] validate rule: tool diameter vs groove width / hole diameter (deferred from T005)
- [ ] tests: schema bounds, version increment, re-verification trigger, form e2e (create → appears in list)

### T011 Cut list table + Excel/CSV paste   [status: done]
Spec: §4.1, §5.1 · Depends: T005 · Owner: dev
Acceptance:
- [ ] cut list grid (name, width, height, qty, grain lock, edge band) bound to commands; new commands `importCutList`, `updatePart`, `removePart`, `duplicatePart` with undo
- [ ] paste from Excel/CSV (tab, semicolon, comma; Turkish decimal comma) with auto column mapping and a confirmation step; ambiguous unit (mm/cm) → ask
- [ ] invalid rows highlighted with Turkish messages; nothing applied until confirmed
- [ ] tests: parser property tests (generated tables round-trip, decimal comma), command undo, e2e paste flow

### T011b Edge band: one column per edge   [status: done]
Spec: §4.1, §4.8 · Depends: T011 · Owner: dev · Owner decision Q002 (2026-11-17) · Decision: D-024
Acceptance:
- [ ] parser recognises named edge columns (Üst/Alt/Sol/Sağ bant, Top/Bottom/Left/Right; case- and diacritic-insensitive, "Sag" too) and maps each to its edge
- [ ] parser recognises the long/short convention (Uzun1/Uzun 1/U1, Uzun2/U2, Kısa1/K1, Kısa2/K2) and maps it by orientation: w ≥ h → U1 bottom, U2 top, K1 left, K2 right; w < h → U1 left, U2 right, K1 bottom, K2 top (square: w is the long side)
- [ ] the single "Bant/Kenar bandı/Edge" column still applies to all 4 edges; with per-edge columns present, per-edge wins and a warning is shown
- [ ] per-edge values are numbers (mm, "0,8" / "1" / "2"); empty, "-", "–" and "yok" → 0; other text → row error with a Turkish message
- [ ] grid: 4 compact columns (Üst / Alt / Sol / Sağ, mm) bound to `updatePart`, one undo step per edit, no-op rule kept; usable at 390 px with no page-level horizontal scroll
- [ ] paste preview mapping dropdowns include the new targets
- [ ] all strings in `tr.json`
- [ ] tests: parser unit tests (named edges, U1/U2/K1/K2 for landscape/portrait/square, single + per-edge conflict, invalid values); fast-check round trip with per-edge columns; e2e: paste with Uzun1/Kısa2 → correct edges in the grid, edit one edge → one undo step, 390 px no overflow

### T012 Rectangle placer: min-waste mode   [status: done]
Spec: §6.2 · Depends: T006 · Owner: dev
Acceptance:
- [ ] MaxRects + guillotine heuristics, several orderings, lowest objective wins; **deterministic**
- [ ] tool diameter, gap and sheet margin respected; multi-sheet when parts do not fit; sheet count and waste % reported
- [ ] grain rule: grain-locked parts rotate only 0°/180°
- [ ] `runNesting` command writes `layout`; locked placements kept
- [ ] validate: part-larger-than-sheet subtracts `nesting.margin` (deferred from T005)
- [ ] fast-check: no overlap, inside sheet minus margin, gap kept, grain rule, same input → same output; benchmark set in `__bench__` with utilisation %
- [ ] runs in a Web Worker in the browser

### T013 Layout view (2D canvas)   [status: done]
Spec: §3.6, §6.5 · Depends: T012 · Owner: dev
Acceptance:
- [ ] react-konva: sheet, numbered parts, grain arrow, waste area, sheet tabs; zoom/pan
- [ ] drag + lock a part (`lockPlacement`); re-nest keeps locked parts
- [ ] waste summary; Turkish labels; reduced motion respected
- [ ] e2e: nest the shelf-set fixture → N parts and waste % shown
- [ ] validate `LOCKED_PLACEMENT_INVALID` (error): a locked part in the margin, off the sheet, or closer than tool diameter + gap to another placed part; the drag-and-drop UI never commits an invalid drop (PO, from the T012 tester notes)

### T014 Toolpath model: outer contour, multi-pass, lead-in/out   [status: done]
Spec: §6.3 · Depends: T007, T010, T012 · Owner: dev
Acceptance:
- [ ] machine-independent model: rapid, plunge, linear and arc moves with tool, feed, rpm in the sheet frame
- [ ] outer contour via `offset(+toolRadius)` (D-013); multi-pass by pass depth; through-cut depth = thickness + spoilboard allowance
- [ ] lead-in/out (arc or line), ramped or straight plunge, climb/conventional
- [ ] D-013: `ARC_COLLAPSED` → user warning; `SPLIT` on an inner contour → export-blocking error
- [ ] properties: no cutting move below target depth; every cutting move at tool radius from the part (± EPS)

### T015 Tabs + small-part auto tabs   [status: done]
Spec: §6.3, §2.4 · Depends: T014 · Owner: dev
Acceptance:
- [ ] tabs: count, width, height; never on corners or arcs; evenly spaced
- [ ] parts below an area threshold get tabs automatically (thin-skin option is M3)
- [ ] properties: tabs lie on the contour; tab height kept on the final pass

### T016 Cut order + rapid ordering   [status: done]
Spec: §6.3 · Depends: T014 · Owner: dev
Acceptance:
- [ ] holes/pockets → inner contours → outer contours; small parts before large ones
- [ ] same-tool operations grouped; nearest-neighbour rapids; deterministic
- [ ] property: ordering constraints hold for random layouts

### T017 Post processor + "Genel düz G-code" + golden files   [status: done]
Spec: §6.4, §7.2 · Depends: T014 · Owner: dev · **Human gate: golden files need the owner's approval (`needs-human`)**
Acceptance:
- [ ] declarative, versioned post config (Zod) covering every item of §6.4; one generator interprets it
- [ ] all 10 rules of §7.2 enforced in the generator
- [ ] machine-origin and Z-zero conversion happen only here
- [ ] **two post configs:** "Genel düz G-code" and "Mach3" (D-015); the Mach3 dialect from Mach3 documentation, then checked against real Mach3 NC files from the owner's machine when they arrive
- [ ] golden NC files for 3 fixtures in `packages/machines/generic/v1/golden/`, byte-for-byte test

### T018 G-code reader   [status: done]
Spec: §6.5 · Depends: none (independent of T017 on purpose) · Owner: dev
Acceptance:
- [ ] G0/G1/G2/G3 (I/J and R), G17/G20/G21/G90/G91/G54, F/S/T, M3/M5/M6, comments, line numbers, modal state
- [ ] **must not import the generator** (lint rule)
- [ ] tests: hand-written NC samples, both arc forms, modal carry-over

### T019 Automatic checks + safety scenarios   [status: done]
Spec: §6.5, §7.2, §11 · Depends: T017, T018 · Owner: dev (tester does the safety review)
Acceptance:
- [ ] checks on the read path: sheet/table/axis/Z limits, rapid inside material, cutting with the spindle off or no feed, tool-change order, read path ≈ toolpath model, part count/positions = layout
- [ ] **one deliberately broken G-code test per §7.2 rule**, each caught
- [ ] any failed check blocks the download

### T020 Simulation screen (2D)   [status: done]
Spec: §6.5 · Depends: T018, T013 · Owner: dev
Acceptance:
- [x] drawn from the **read G-code**: sheet, parts, tool-centre path, tool circle, dashed rapids, arrows, cut-order numbers, Z depth colour
- [x] play/pause, speed, scrubber, highlight of the current G-code line
- [x] summary: estimated time, cut length, tool changes; banner "Simülasyon air cut'ın yerine geçmez"
- [x] e2e: simulate a fixture to the end

### T021 NC export   [status: done]
Spec: §6.6, §7.2 · Depends: T019 · Owner: dev
Acceptance:
- [ ] the server regenerates the file from the saved project revision; stores file + record (revision, profile version, post version, hash) in `exports`
- [ ] header comment (project, revision, post version, verification status); unverified profile → "DOĞRULANMADI, önce air cut" + an accept step
- [ ] pre-export checklist (origin, tool, air cut); same input → same file (hash test)

### T022 Air-cut test program + test part   [status: done]
Spec: §7.3 · Depends: T017, T019 · Owner: dev
Acceptance:
- [ ] air-cut program (Z up or spindle off): tool change, spindle start, safe XY/Z moves, small geometry, stop, end
- [ ] test part 200×200 with a 100 mm hole and one blind pocket; measurement form → tolerance check → suggests a tool-diameter or Z correction
- [ ] verification states (draft → air cut approved → test cut approved → verified) per profile version

### T023 Simple project save + wizard skeleton   [status: done]
Spec: §3.6, §8.2 · Depends: T008, T011, T013 · Owner: dev
Acceptance:
- [ ] single user (no login yet): create/open/save via route handlers + `forCompany` with a default company; revision conflict shown in the UI
- [ ] wizard: machine & sheet → parts → layout → preview/simulation → export; step indicator, back/next, autosaved draft
- [ ] validation warnings panel fed by the command layer

### T024 End-to-end flow   [status: done]
Spec: §11 · Depends: T010–T023 · Owner: tester (dev assists)
Acceptance:
- [ ] cut-list paste → nesting → simulation → NC download; the downloaded file passes every automatic check (= M1 exit)
- [ ] runs in CI

### Field test 1 (owner)   [status: todo]
Spec: §12.1, §12.3 · Depends: T024
- [ ] owner collects the machine info (§12.3) into `docs/machines/<machine>/`, starting with 2–3 NC files that work today
- [ ] post config adapted to the real controller (new post version + golden files, owner approval)
- [ ] air cut, then a test cut on scrap; "NittCam test etti" record

### Deferred notes
- validate "pocket depth too close to thickness" (§4.5): M3 with the hole object
- AI: flat w/h/r adapter for `addPart`: M5
- command log: persist undo/redo events: done in T023 (D-029)
- db defence in depth (tester note on T008): DB triggers that block UPDATE on version tables; Postgres RLS on company_id: M2 (before multi-company login)
- owner: identify the second machine's controller (brand, model, software version) and collect 2–3 working NC files from each machine (§12.3)
