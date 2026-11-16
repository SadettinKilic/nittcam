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

## D-008 Toolchain versions for the skeleton (2026-11-16, T001)
Versions are pinned exactly and are stable releases at least two weeks old. **TypeScript 6.0** (not 7.0): typescript-eslint 8 supports `typescript <6.1`. **ESLint 9.39** (not 10): `eslint-plugin-react` and `eslint-config-next` deps are not ESLint 10 ready; we use `@next/eslint-plugin-next` + `eslint-plugin-react-hooks` + typescript-eslint directly in one root flat config. Next.js 16.4 (Turbopack), React 19.3, Tailwind 4.3, Vitest 5.0, Playwright 1.64. Core purity is enforced with `no-restricted-imports` on `packages/core/**` (no `apps/*`, db, ui, React/Next). Translations are plain JSON (`apps/web/messages/tr.json`) read through a tiny typed helper; an i18n library (e.g. next-intl) is deferred until a second locale is needed. Revisit ESLint 10 / TS 7 when the plugins support them.

## D-009 Licence policy (2026-11-16, T002)
Enforced by `scripts/check-licenses.mjs` (zero dependencies, reads `pnpm licenses list --json`), run in CI and via `pnpm licenses:check`; unit tests in `scripts/check-licenses.test.mjs`.
- **Direct dependencies** (`dependencies`/`devDependencies` of any workspace `package.json`) must be MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, BSL-1.0, 0BSD, CC0-1.0, Unlicense or BlueOak-1.0.0. GPL, AGPL and LGPL in a direct dependency fail the build.
- **Transitive dependencies** may also be MPL-2.0 (unmodified), CC-BY-4.0 (data, e.g. `caniuse-lite`), Python-2.0, and the LGPL-3.0 part of `@img/sharp-*` (dynamically linked, optional).
- **GPL or AGPL anywhere fails the build.** Unknown or unparseable licences fail too.
- SPDX expressions: `OR` means we may choose any allowed branch (a `MIT OR GPL-3.0` package passes, used under MIT); `AND` means every part must be allowed; `WITH <exception>` is judged by its base licence.
New exceptions need a new decision entry.

## D-010 Project JSON schema v1 interpretations (2026-11-16, T004)
Zod schema in `packages/core/src/schema/` (exported from `@nittcam/core`), modelled on spec §9.2. Where the spec is silent:
- **Strict objects:** unknown keys are rejected (no silent data loss); new fields arrive through a schema version + migration step.
- **Rect parts:** `params {w, h, r}` is the source; `outline` is optional and treated as a cache that is never read (`deriveOutline(part)` recomputes it). `r ≤ min(w, h) / 2`. The derived outline starts at `(r, 0)` (or `(0, 0)` when `r = 0`), runs CCW, uses quarter arcs with bulge `tan(22.5°)` and drops zero-length straight edges.
- **Contours:** `outline` and each `inners[]` entry are vertex arrays, implicitly closed. At least 3 vertices, or 2 when one segment is an arc (a circle). Direction (outer CCW, inner CW) is the stored convention but is not enforced by the schema; normalisation is T006's job.
- **Holes:** discriminated by `type`; every hole has an `id` (string, unique within its part, PO decision) so commands can address it. pocket = `id, d, cx, cy, depth, tool`; through = `id, d, cx, cy, tool` (no `depth`, it comes from stock thickness + machine sacrificial allowance, §4.5); groove = `id, d, cx, cy, depth, grooveWidth, tool`. For a groove, `d` is the **centreline** diameter (the tool centre follows that circle) and `grooveWidth < d` is required (PO decision). `tool` is the tool number in the machine profile (integer ≥ 1, PO confirmed). Rules that need other data (depth < thickness, d ≥ tool diameter, groove width vs tool) are validation rules for later tasks, not schema rules.
- **Enums:** `nesting.mode` ∈ `minWaste | fastest | minToolChanges` (§6.2); `cutting.leadIn` ∈ `arc | line`; `cutting.direction` ∈ `climb | conventional`; sheet `grain` ∈ `0 | 90` (free-angle grain is out of scope, §2.5); placement `rot` ∈ `0 | 90 | 180 | 270`.
- **Settings (§4.8, not in the §9.2 summary; PO decision):** top-level `settings.dimensionMode` ∈ `cut | finished`, default `cut` (a missing `settings` or `dimensionMode` parses as `cut`). In `finished` mode entered sizes are finished sizes and the edge-band thickness will be deducted from the cut size; only the field exists now, the deduction is implemented later.
- **Templates:** `params` is a record of number | string | boolean; `overrides` is the list of field names the user changed by hand.
- **Cross-references** checked by the schema: unique part ids; unique hole ids within a part; each placement points at an existing part, `index < qty`, and each copy is placed at most once. The grain rotation rule is enforced by the nesting engine, not the schema.
- **Migration:** `MIGRATIONS[n]` upgrades raw JSON from v`n` to v`n+1`; `parseProject(json)` upgrades then validates and returns `{ ok, project } | { ok: false, issues: [{ path, message }] }` (paths like `parts[0].holes[1].d`); `migrate(json)` throws `ProjectSchemaError`. Missing, non-integer or future `schemaVersion` is rejected with a clear message.
- **Dependencies:** `zod` 4.6.7 (MIT) in core, `fast-check` 4.10.2 (MIT) as a core devDependency.
