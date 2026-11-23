# NittCam Backlog (v3 plan, 2026-11-17)

Statuses: `todo` · `doing` · `review` · `done` · `blocked`. Format and definition of done: `.claude/skills/task-workflow`.
Order inside a milestone is the order of work. Agents run sequentially. Plan rationale: D-032…D-036, spec §1 "v3 değişiklikleri", §12.1.

## How to work this backlog (D-036)
- **Small tasks:** one task ≈ one focused dev session (≈ 300–500 changed lines, one screen or one engine piece).
- **Batches:** the PO hands the dev one batch (2–4 related tasks). One branch and one PR per batch: `feat/B07-cutlist-grid`, PR title `feat(cutlist): grid v2, row actions, import (T118–T120)`. The dev commits and pushes after each task and appends a checkpoint line per task to the PR description. The tester tests the batch; the PO squash-merges the batch.
- **Every task** has spec refs, dependencies, testable acceptance criteria and a **Tester focus** line. Tester focus is the minimum the tester must check, not the maximum.
- **Visual standard (from B1 on):** every new or changed screen is built from `packages/ui` components and design tokens, works in light and dark, at 1440 and 390 px, with no serious/critical axe violation. These checks are implied in every UI task's acceptance even when not repeated.
- **Spec sections** refer to the v3 spec. Old milestone names in older decisions map as listed in spec §12.1.

## Summary

| Milestone | Tasks | Batches | Exit |
| --- | --- | --- | --- |
| M0 Temel | T001–T009 | – | done |
| M1 İnce dilim | T010–T024 | – | done (2026-11-17) |
| M2 Tasarım sistemi ve uygulama kabuğu | T100–T111 (12) | B1–B4 | every existing screen in the new design, visual + axe checks in CI |
| M2.5 Marka ve çalışma alanı cilası (Fable review #1) | T194–T199, T194a, T194b (8) | B4a–B4b | brand mark in the shell, mono numerics, canvas-first workspace on steps 3–4, calmer notices |
| Fable review #2 follow-ups | T240–T247 (8) | B10a (T240–T243) + riders (T244–T247) | board usable on a phone, canvas gets the space, one tool-state language (D-039) |
| Fable review #3 follow-ups | T248–T254 (7) | B8a (T248–T251) + riders (T252–T254) | phone cut list and simulation usable, one inspector pattern, download is the last step's primary action, canvas has a material tone (D-040) |
| CTO review #4 follow-ups | T257–T263 (7) | B11a (T257–T260) + riders (T261–T263) | the default path cuts out of the box, blocking errors are caught at step 1, the cabinet generator adds only parts the stock can make, laptop widths keep the canvas (D-045) |
| CTO review #5 must-fixes | T264–T266 (3) | B12a | "Kesim ayarı ekle" returns to the same project, a prefilled parameter set is never saved blind, corner tools fit the properties panel (D-047: everything else went to the polish queue) |
| CTO review #6 must-fixes | T269–T271 (3) | B13a (T269–T270 + rider T271) | the file's profile version is shown where it is made, an inner cut without room for 2 tabs is caught where it is drawn, a new project never defaults to an unverified cutting set (D-047) |
| CTO review #7 must-fixes | T274–T276 (3) | B14a | multi-tool programs ask for every tool and remind to re-zero Z, hole errors are caught where the hole is drawn, a hole near the edge lands where it is clicked (D-047) |
| Tester/CI findings | T267–T268, T272–T273 (4) | T267 + rider T268 in B13; T272 + rider T273 in B18 | CSV export → import keeps small sizes; no flaky core test; small all-arc parts get tabs (D-049) |
| M3 Kesim listesi, malzeme, damar kadranı | T112–T123 (12) | B5–B8 | free-angle grain respected from cut list to G-code; cut list editable without Excel |
| M4 Çizim tahtası I: editör | T124–T137 (14) | B9–B13 (+ B12a, B13a) | a drawn freeform part with fillets is nested and gives checked G-code (done 2026-11-19) |
| M5 Çizim tahtası II: delik, cep, şablon, DXF | T138–T151 (14) + T272–T273 | B14–B18 | hinge-door project via template and a DXF sign job both give checked G-code |
| M6 3D önizleme | T152–T161 (10) | B19–B21 | 360° preview + cutting playback, 300 parts within the perf budget, 2D fallback |
| M7 Dizilim yükseltmeleri | T162–T171 (10) | B22–B24 | 3 modes, true-shape with rotation, offcuts, edge-band deduction |
| M8 Export, etiket, proje yönetimi | T172–T183 (12) | B25–B28 | NC + DXF + PDF + labels from the server; projects/home/settings complete (closed 2026-11-21: CTO #12 exit B41 + T298 + T301 met) |
| M9 Cila ve saha hazırlığı | T184–T193 (10) | B29–B31 | **~90 % line: field-test ready** (owner sign-off) |
| Saha 1 (owner) | – | – | air cut + test cut incl. holes, pockets, arcs on both machines |
| M10 Hesap ve çok şirket | T200+ (outline) | – | after field test |
| M11 AI sohbet | T220+ (outline) | – | after M10; Q001 |
| M12–M14 Pilot, Ticari, Büyüme | – | – | spec §12.1 |
| M-Metal Metal ve kompozit (proposal, D-xxx) | T340–T372 (33) | MB1–MB11 | after field test 1 (only T340–T342 may start before); ACM tray and aluminium test part cut on a real machine; existing goldens byte-identical |

**Before the field test: 139 tasks in 39 batches** (counted from the task headings with a status, deferred T248 not counted; the mobile UI pass T248 + T255 comes on top. 2026-11-19: + 3 from CTO review #7 (T274–T276, batch B14a), + 3 from CTO review #6 (T269–T271, batch B13a), + T267/T268 (B13) and T272/T273 (B18) from tester/CI findings, T255/T256 now counted. Before that 127 tasks in 37 batches: + 3 from CTO review #5, `docs/reviews/2026-11-19-cto-design-review-5.md`: T264–T266, one new batch B12a; before that 124 tasks in 36 batches: + 7 from CTO review #4, `docs/reviews/2026-11-19-cto-design-review-4.md`: T257–T263, one new batch B11a; T255 and T256 were added on 2026-11-19 and are not in this count; before that: 117 tasks in 35 batches = 94 + 7 from Fable design review #1 + T194b, `docs/reviews/2026-11-18-fable-design-review-1.md`; + 8 from review #2, `docs/reviews/2026-11-18-fable-design-review-2.md`: T240–T247, numbered from T240 because T200+/T220+ are reserved for M10/M11; + 7 from review #3, `docs/reviews/2026-11-19-fable-design-review-3.md`: T248–T254). The "~90 % / field-test ready" line is the end of M9 (T193).

**Order note (2026-11-18, D-035 amendment):** after B4b come B9–B10 (drawing board foundation, T124–T129), then **B10a** (Fable review #2 must-fixes, T240–T243), then M3 B5–B8, then B11+.

**Order note (2026-11-19, Fable review #3):** **B8a** (T248–T251) runs right after B8 and before B11. T252 and T253 ride with B8, T254 rides with B11. No other batch moves.

**Order note (2026-11-19, CTO review #4):** **B11a** (T257–T260) runs right after B11 and before B12. T261 rides with B12, T262 and T263 ride with B13. No other batch moves.

**Order note (2026-11-19, CTO review #5, D-047):** **B12a** (T264–T266) runs right after B12 and before B13. Everything else from that review is in "Polish queue (M9; D-047)". No other batch moves.

**Order note (2026-11-19, CTO review #6, D-047):** **B13a** (T269–T270 + rider T271) runs now, in parallel with B13 and B14/B16. The rest of review #6 is in the Polish queue. No other batch moves.

**Order note (2026-11-19, CTO review #7, D-047):** **B14a** (T274–T276) runs on the first free dev, before B18.

**Order note (2026-11-19, D-054, paralellik on):** M4 is done (B13, B13a landed). M5 continues (B15, B16 → B17 → B18) and M6 **B19** (3D foundation) runs in parallel with M5 because it touches other files; B20 waits for M5. Statuses here are set to `done` by DevOps in each integration PR (the dashboard reads this file from origin/main).

---

## Done: M0 Temel (T001–T009) and M1 İnce dilim (T010–T024)

All done and merged (last: T024, #31; M1 exit met 2026-11-17). Details: git history, PRs #1–#32 and DECISIONS D-001…D-031.
- M0: monorepo + CI + licence check (T001–T002), Claude Code setup (T003), project schema v1 (T004), command layer (T005), bulge polyline geometry (T006), own arc-preserving offset (T007, D-013), db on PGlite (T008), M1 backlog (T009).
- M1: machine/tool profile + versions (T010), cut list table + Excel/CSV paste (T011) + per-edge band (T011b), MaxRects min-waste placer (T012), 2D layout view with drag/lock (T013), toolpath outer contour/multi-pass/leads (T014), tabs (T015), cut order (T016), declarative post + generic/Mach3 + golden files (T017), G-code reader (T018), automatic checks (T019), 2D simulation (T020), NC export (T021), air-cut test program + verification (T022), project save + wizard (T023), end-to-end flow (T024).

### Deferred notes (carried into v3)
- validate "pocket depth too close to thickness" (§4.5): T140
- AI: flat w/h/r adapter for `addPart`: M11
- db defence in depth (triggers on version tables, Postgres RLS on company_id): M10, before multi-company login
- owner: identify the second machine's controller and collect 2–3 working NC files from each machine (§12.3), needed before Saha 1
- project status "üretildi" after export: T179; export of air-cut/test files as records: T191

---

## M2: Tasarım sistemi ve uygulama kabuğu (exit: every existing screen in the new design; visual + axe checks run in CI)

Goal: a modern, corporate, professional look before any new screen is built (D-032). Stack: Tailwind v4 tokens + Radix primitives in shadcn-style components owned in `packages/ui`, lucide icons, cmdk, sonner, next-themes, Inter via `next/font`.

### Batch B1: T100–T102 (design foundation)

### T100 Design tokens, theme and `packages/ui` setup   [status: done]
Spec: §3.7, §8.3 · Depends: none
Acceptance:
- [ ] tokens as CSS variables in one file (`packages/ui/src/tokens.css`) mapped to Tailwind v4 `@theme`: colour scales (neutral, brand, success, warning, danger, info), semantic roles (bg, surface, border, text, muted, accent, focus), radius, spacing, shadow/elevation, typography scale, motion durations; light and dark values
- [ ] `next-themes` provider: system / light / dark, no flash on load (class strategy), choice persisted
- [ ] Inter (or Geist) via `next/font`, tabular numbers for measurements
- [ ] `packages/ui` exports `cn()` (clsx + tailwind-merge) and `cva` variants; Radix, lucide-react, cmdk, sonner, next-themes added; licence check green
- [ ] `ui-conventions` skill updated with token names and usage rules
Tester focus: licence check output; theme switch without flash (reload in dark); token contrast pairs text/bg ≥ 4.5:1 in both themes (script or axe).

### T101 Core primitive components   [status: done]
Spec: §3.7 · Depends: T100
Acceptance:
- [ ] Button (primary/secondary/ghost/destructive/outline; sm/md/lg; loading), IconButton (required aria-label), Input, Textarea, **NumberInput** (mm unit suffix, Turkish decimal comma, min/max, step with arrows, invalid state), Select, Checkbox, Switch, RadioGroup, Label, FormField (label + hint + error)
- [ ] Tooltip, Popover, DropdownMenu, Dialog, AlertDialog, Sheet (side drawer), Tabs, Badge, Card, Separator, Skeleton, Kbd
- [ ] all keyboard operable with visible focus ring; respect reduced motion
- [ ] unit tests for NumberInput parsing (`"12,5"` → 12.5, `"1.200,5"` → 1200.5, invalid → error)
Tester focus: keyboard-only pass over every component; NumberInput edge cases; focus visible in light and dark.

### T102 UI gallery route + visual QA harness   [status: done]
Spec: §11 · Depends: T101
Acceptance:
- [ ] dev-only route `/dev/ui` shows every component in every variant and state (hidden in production build)
- [ ] Playwright project `visual`: viewports 1440×900 and 390×844, light and dark; helper `snap(page, name)` writing to `e2e/__screenshots__/`; `toHaveScreenshot` baselines generated in CI (Linux) only, artefacts uploaded
- [ ] `@axe-core/playwright` helper `expectNoA11yViolations(page)` (serious + critical fail); dev-only licence exception MPL-2.0 per D-032
- [ ] `pnpm e2e:visual` script; CI job runs it
Tester focus: run the visual suite twice → zero diff (deterministic: fonts loaded, animations off); axe helper catches a planted violation.

### Batch B2: T103–T105 (app shell)

### T103 App shell: sidebar, top bar, mobile drawer   [status: done]
Spec: §3.3, §3.7 · Depends: T101
Acceptance:
- [ ] left sidebar: logo + company name (default company), operator name placeholder, nav (Ana sayfa, Projeler, Makineler, Şablonlar, Ayarlar) with lucide icons and active state, prominent "+ Yeni proje"; collapsible to icons (state remembered)
- [ ] top bar: breadcrumb, page title, slot for page actions, save status, theme toggle
- [ ] < 768 px: sidebar becomes a Sheet opened by a menu button; no horizontal page scroll at 390 px
- [ ] all existing pages render inside the shell; nav works with keyboard; skip-to-content link
Tester focus: screenshots of shell at 1440/390 × light/dark; keyboard nav order; collapsed state persists after reload.

### T104 Command palette + keyboard shortcuts   [status: done]
Spec: §3.7 · Depends: T103
Acceptance:
- [ ] `Ctrl/Cmd+K` palette (cmdk): go to page, new project, recent projects (from API), toggle theme, open shortcuts help; fuzzy search with Turkish characters (ı/i, ş/s folding)
- [ ] shortcut registry (single source) used by palette, menus and the "?" help dialog; shortcuts ignored while typing in inputs
- [ ] Turkish labels in `tr.json`
Tester focus: e2e open palette → search "makine" → navigates; "?" dialog lists shortcuts; shortcuts do not fire inside inputs.

### T105 Feedback states: toasts, empty, error, loading   [status: done]
Spec: §3.7 · Depends: T101
Acceptance:
- [ ] sonner toasts (success/error/info, action button, themed); helper `notify.*`
- [ ] `EmptyState` (icon, title, text, action), `ErrorState` (retry), page skeletons
- [ ] Turkish `not-found` and `error` pages in the shell; React error boundary around canvases
- [ ] existing ad-hoc messages (save errors, export errors) switched to toasts
Tester focus: force API error (route mock) → toast + retry; empty project list shows EmptyState; screenshots of the 404 page.

### Batch B3: T106–T108 (redesign: home, machines, verification)

### T106 Ana sayfa redesign   [status: done]
Spec: §3.4 · Depends: T103, T105
Acceptance:
- [ ] cards: recent projects (with status badge), machines needing verification, quick actions (Yeni proje, Makine ekle, Kesim listesi yapıştır); waste summary placeholder card (real data in T180)
- [ ] EmptyState when there is no project/machine
Tester focus: visual 1440/390 light/dark; empty vs filled state (seed); links work.

### T107 Makineler list + profile form redesign   [status: done]
Spec: §3.4, §7.1 · Depends: T103, T105
Acceptance:
- [ ] list as cards/table with verification badge (Taslak / Air cut onaylandı / Test kesimi onaylandı / Doğrulanmış / Yeniden doğrulama gerekli)
- [ ] form split into sections with a side index (Kimlik, Çalışma alanı, Orijin, Z sıfır, Spindle, Takım değiştirici, Tutma, Kısıtlar, Takımlar, Malzeme parametreleri); sticky save bar with dirty state; NumberInput everywhere; leave-page guard when dirty
- [ ] origin corner picker as a visual sheet diagram (click a corner)
- [ ] existing machine e2e still passes (selectors updated)
Tester focus: create/edit profile e2e; version increments on save; dirty-guard; visual + axe.

### T108 Doğrulama (verification) page redesign   [status: done]
Spec: §7.3 · Depends: T107
Acceptance:
- [ ] stage stepper (draft → air cut → test cut → verified) with current stage; download cards for air-cut and test-part programs with the acceptance checkbox (rule 10)
- [ ] measurement form in the new FormField style with inline tolerance result and suggestion card
Tester focus: full verification e2e still green; rule-10 acceptance cannot be bypassed (download disabled until checked); visual + axe.

### Batch B4: T109–T111 (redesign: wizard, layout, simulation, export, projects)

### T109 Wizard shell redesign   [status: done]
Spec: §3.6 · Depends: T103
Acceptance:
- [ ] stepper header (5 steps, done/current/blocked states), left panel for fields, right panel for preview, sticky footer with Geri / İleri and autosave indicator (Kaydedildi / Kaydediliyor / Kaydedilemedi)
- [ ] step 1 (machine & sheet) restyled; validation warnings panel as a collapsible side card with severity icons
- [ ] browser back/forward between steps still works (D-030)
Tester focus: wizard e2e (T024 flow) green; 390 px: panels stack, footer stays reachable; visual all steps.

### T110 Layout view + simulation screens restyle   [status: done]
Spec: §3.6, §6.5 · Depends: T109
Acceptance:
- [ ] canvas palette from tokens (light and dark: sheet, parts, waste, selection, rapids, cuts, depth colours); toolbars as icon buttons with tooltips; sheet tabs as Tabs
- [ ] simulation controls (play/pause, speed, scrubber) as one control bar; G-code panel in monospace with current-line highlight; summary as stat cards
- [ ] banner "Simülasyon air cut'ın yerine geçmez" kept and visible in both themes
Tester focus: layout drag/lock e2e and simulation-to-end e2e green; dark-mode canvas readability (screenshot review); reduced motion.

### T111 Export step + Projeler list restyle; screen baselines   [status: done]
Spec: §3.4, §6.6 · Depends: T109
Acceptance:
- [ ] export step: checklist as a card list, unverified warning as a danger callout, file list with hash, history table in the new Table component
- [ ] Projeler list in the new Table/Card style (data features come in T178)
- [ ] visual baselines + axe for every route (Ana sayfa, Projeler, Makineler, form, doğrulama, wizard 1–5) in CI; old unused styles removed
Tester focus: complete screenshot review of all routes 1440/390 × light/dark; zero serious axe violations; export e2e green.

---

## M2.5: Marka ve çalışma alanı cilası (exit: the product has a recognisable identity and a canvas-first workspace before new screens are built on it)

Source: Fable design review #1 (`docs/reviews/2026-11-18-fable-design-review-1.md`, 2026-11-18). These are foundational: every M3–M6 screen inherits them, so they run **before B5**. Scores at review time: corporate image 5/10, modernity 7/10, usability 6.5/10, readiness for M3–M6 6/10. Owner questions FQ1–FQ6 are listed at the end of the review; T194 waits for FQ1 (logo direction) and FQ2 (logo placement), the rest can start.

### Batch B4a: T194, T194a, T195 (brand, shell, type)

### T194 Brand identity: mark, wordmark, favicon, shell placement   [status: done]
Spec: §3.7 · Depends: T103 · Decision: D-032 · Owner: FQ1, FQ2
Acceptance:
- [ ] `Logo` component in `packages/ui` (inline SVG, `currentColor` + accent token, no image download): **mark** (monogram "N" drawn as a toolpath: lead-in, two plunges, one diagonal pass, a tool dot at the end) and **wordmark** "NittCam" (Inter 600, tight tracking, "Cam" in `accent-text`); sizes 20/24/32 px; mark-only variant for the collapsed sidebar
- [ ] sidebar header shows the NittCam logo (top-left, links to Ana sayfa); the company tile ("Atölyem / Operatör") moves to the **bottom** of the sidebar as the account/workspace row (above "Menüyü daralt"); mobile drawer and the 390 px top bar show the mark
- [ ] favicon + app icons (`app/icon.svg`, `apple-icon`, 32/180/512 px, light and dark variants), `theme-color` meta for both themes, page titles "<Sayfa> · NittCam"
- [ ] brand section in `/dev/ui` (mark, wordmark, clear space, on light/dark/accent backgrounds); `ui-conventions` skill gains a short "Brand" paragraph (where the logo may appear, never recoloured outside tokens)
Tester focus: logo crisp at 1× and 2× in both themes; collapsed sidebar shows the mark only; favicon visible in the tab; axe (logo link has an accessible name "NittCam, ana sayfa"); shell baselines updated on purpose.

### T194a Shell and home declutter, domain icons   [status: done]
Spec: §3.4, §3.7 · Depends: T194 · Owner: FQ4 ("Oluştur" removal only)
Acceptance:
- [ ] one primary "Yeni proje" per screen: the sidebar button stays; the Ana sayfa header button is removed while the sidebar is visible (kept below 768 px, where the sidebar is a drawer); the empty state keeps its own CTA
- [ ] nav: "Oluştur" is removed as a separate item (it opens the same wizard as "Yeni proje"; a new unsaved project highlights "Projeler"); items that are not built yet (Şablonlar, Ayarlar) move to a muted "Yakında" group at the bottom instead of sitting between live items with badges
- [ ] Ana sayfa: the placeholder KPI "Ortalama fire / Yakında" is hidden until it has data (3 KPI cards, or 4 once T180 lands); with zero projects the KPI row is replaced by a 3-step start strip ("1 Makine · 2 Kesim listesi · 3 G-code") with a line illustration built from canvas tokens
- [ ] 6 domain icons as SVG components in `packages/ui` (24 px grid, 1.5 px stroke, lucide-compatible): router/spindle (replaces the generic chip for machines), sheet/plaka, grain/damar, nesting/dizilim, toolpath/takım yolu, air cut; used in nav, machine rows, quick actions and wizard steps
- [ ] wording: "export" in UI text becomes "dışa aktarma" everywhere ("Bu hafta dışa aktarma", "Henüz dışa aktarma yok"); new projects are named "Adsız proje" + counter instead of a date-time string, and the name field is focused and selected on the first wizard step
Tester focus: exactly one accent-filled "Yeni proje" on Ana sayfa at 1440; nav item count and active state through a new-project flow; no "export" word left in `tr.json` values (grep); icons readable at 16/20/24 px in both themes.

### T195 Typography: mono numerics, type scale tune   [status: done]
Spec: §3.7 · Depends: T100 · Decision: D-032 (OFL fonts allowed)
Acceptance:
- [ ] a mono family via `next/font` (Geist Mono or JetBrains Mono, OFL-1.1, Turkish glyphs İ ı Ş ğ checked) as `--font-mono`; used for G-code, file names/hashes, canvas dimension labels and the coordinate read-outs; no fallback to Consolas/Courier on Windows
- [ ] page titles drop one step (30 → 24 px on desktop, 20 px on phones) and the wizard step title is merged with the stepper's active label (no second H1 under the stepper); KPI numbers use `text-3xl` tabular figures with the unit in `fg-muted`
- [ ] `Measure` text component (value + unit, Turkish formatting, tabular, mono optional) replaces hand-formatted measurement strings on Makineler, wizard summaries and the simulation "Özet"
- [ ] a `data-density="compact"` scope in tokens (control height 32 px, table row 36 px, panel padding 12 px) usable by a container; **not** a user setting yet (that stays in T183)
Tester focus: font files are self-hosted (no request to a font CDN); Turkish capital İ renders in mono; gallery shows both densities; contrast test still green; baselines updated on purpose.

### Batch B4b: T194b, T196–T199 (wordmark, canvas language, workspace layout, notices)

### T194b Wordmark: bold, slightly italic "NittCAM" text logo   [status: done]
Spec: §3.7 · Depends: T194 · Owner: request 2026-11-18
Acceptance:
- [ ] the shell logo is a text wordmark "NittCAM" ("CAM" in capitals) in the brand font, bold (700–800) with a subtle italic skew; tokens only, works in light and dark
- [ ] collapses gracefully: at 320 px and on the collapsed rail it shrinks/abbreviates without overflow; accessible name "NittCam, ana sayfa" unchanged; favicon may stay
Tester focus: shell baselines light/dark at 1440/390/320; no overflow; axe.

### T196 Canvas visual language v1 (layout, simulation, sheet preview)   [status: done]
Spec: §2.4, §3.6, §6.5 · Depends: T110, T195
Acceptance:
- [ ] part label = number + **name** and "W × H" in mono when the part is large enough on screen; falls back to the number only, then to nothing (no overflowing text); the same rule in layout and simulation
- [ ] sheet shows its real size: dimension labels on the top and left edges ("2.800" / "2.070"), an origin marker, a scale bar; step 1 "Önizleme" shows the sheet with margin, dimensions, the table outline with a label and the grain as a fine line texture instead of one large arrow
- [ ] dark theme: `sim-part` / `sim-part-stroke` / `sheet` / `canvas` re-tuned so a part is clearly separable from the sheet and the sheet from the well (non-text contrast ≥ 3:1 between adjacent fills or their strokes); added to `tokens.test.ts`
- [ ] simulation at t = 0 shows the whole toolpath as a faint ghost (cut = accent 35 %, rapid = dashed) and the cut-order numbers, so the screen is never an empty sheet; played moves draw at full strength over the ghost
- [ ] "Diz" result: parts fade/settle in (≤ 240 ms total, staggered, off with reduced motion); utilisation shown as a thin bar per plate tab (accent fill, `warning` under 50 %)
Tester focus: screenshots layout + simulation, light/dark, 1440/390; label fallback at 3 zoom levels; contrast test; reduced-motion run has no animation; golden files untouched (UI only).

### T197 Workspace layout for Dizilim and Simülasyon (desktop)   [status: done]
Spec: §3.6 · Depends: T109, T195
Acceptance:
- [ ] `WorkspaceLayout` in `apps/web/components/wizard/`: left settings panel (300 px, collapsible, compact density), centre canvas that **fills the remaining viewport height** (no page scroll at ≥ 1024 px on steps 3 and 4; panels scroll inside themselves), right inspector (280 px, collapsible) for the selected part / G-code
- [ ] canvas toolbar floats on the canvas (top-left: plate tabs; top-right: zoom/fit/grid; bottom-left: legend as a popover; bottom-right: cursor/scale), replacing the rows of controls above and below it; "Parça seç" select and the text summary move into the inspector
- [ ] simulation: transport bar docks at the bottom of the canvas, the depth strip sits directly above it; G-code panel is the right inspector with the current line highlighted
- [ ] the wizard header is one row (project name + stepper + undo/redo) on ≥ 1280 px so the canvas gets ≥ 620 px of height at 1440 × 900
- [ ] this layout is the base the drawing board (T124) and 3D preview (T152, T160) plug into: exported with slots `left`, `canvas`, `right`, `canvasOverlay`
Tester focus: at 1440 × 900 and 1024 × 768 the whole sheet is visible without scrolling on steps 3 and 4; panels collapse/expand with keyboard; existing layout/simulation e2e (drag, lock, play) stay green; axe.

### T198 Workspace on phone and tablet: canvas first   [status: done]
Spec: §3.7 · Depends: T197
Acceptance:
- [ ] below 1024 px steps 3 and 4 show the **canvas first** (≥ 55 % of the viewport height), with settings and inspector as bottom sheets opened from a two-button bar ("Ayarlar", "Parça / G-code"); "Diz" stays reachable without scrolling
- [ ] the sticky wizard footer respects `env(safe-area-inset-bottom)` and never covers the last control of a panel (content gets matching bottom padding)
- [ ] pinch zoom and two-finger pan on the canvas do not scroll the page; one-finger drag on empty canvas scrolls the page only when the canvas is not zoomed
- [ ] 768 px (tablet, landscape and portrait) checked as a first-class size: left panel collapses to an icon rail
Tester focus: touch emulation at 390 × 844 and 768 × 1024: nest, select a part, play the simulation without scrolling past settings; nothing hidden behind the footer; visual both themes.

### T199 Notice hierarchy: fewer, calmer warnings   [status: done]
Spec: §7.4, §8.2 · Depends: T105, T108 · Owner: FQ3
Acceptance:
- [ ] one rule, documented in `ui-conventions`: **danger** = blocks the action or risks the machine now; **warning** = needs the operator's confirmation once; **info** = context. At most one Callout per screen region; repeats become a status chip that opens the detail in a popover
- [ ] "profil doğrulanmadı" is shown as one persistent `warning` chip in the wizard header (all steps) with the reasons in a popover; the separate callouts on step 1 and the red line in the simulation machine card are replaced by it. The export step keeps its full notice and the mandatory acknowledgement checkbox (unchanged behaviour and text); only its tone changes from danger to warning if the owner agrees (FQ3)
- [ ] verification page: the right-hand reasons panel and the in-step warning are merged; the acknowledgement checkbox row is a plain row, not a second yellow box
- [ ] no safety text is removed: every sentence that exists today is still reachable in one click, and the G-code header warning is unchanged
Tester focus: **safety**: an unverified profile still cannot be downloaded without the acknowledgement; every previous warning sentence is found in the UI (string list from `tr.json`); callouts per screen region ≤ 1; axe (popover reachable by keyboard).


### T199a CI gap: missing visual baselines fail   [status: done]
Depends: T102 · Owner: PO request 2026-11-18 (B4a lost hours to flaky captures)
Acceptance:
- [ ] in CI a missing or changed baseline fails (`updateSnapshots: 'none'`); the actual images are copied into the `visual-screenshots` artefact as candidate baselines (`tools/ci/visual-candidates.mjs`), so the baseline-refresh workflow stays; locally (or `VISUAL_UPDATE=missing`) missing ones are still written
- [ ] `settle()` makes captures deterministic: network idle, fonts, no pending autosave, canvases sized, transitions/animations frozen, page scrolled to 0,0
Tester focus: a deleted baseline makes the CI visual job red and the artefact holds the candidate; commit the Linux baselines from the artefact.

### T199b B4b follow-ups   [status: done]
Spec: §3.6, §3.7 · Depends: T196–T198 · Owner: B4b tester + PO review 2026-11-18
Acceptance:
- [ ] desktop plate tabs never cut off the last tab (e.g. "Plaka 3" at 1440): the strip scrolls with fade edges, or the overflow goes into a "+N" menu
- [ ] below 640 px the simulation step shows the plate tabs on their own row, the same as Dizilim
- [ ] tool-order markers in the simulation never cover part labels (markers offset to the part corner, or labels under markers hidden at low zoom)
Tester focus: 1440 with 3+ plates (last tab fully visible / reachable); 390 simulation with 2+ plates; simulation screenshot at fit zoom, labels readable.

---

## M4 early: Çizim tahtası temeli, B9–B10 (moved before M3; D-035 amendment 2026-11-18)

The owner wants the drawing board early. B9 and B10 depend only on T110 (and on T197's `WorkspaceLayout`), so they run right after B4b and before M3 B5–B8. B11+ stay in M4 below. **Work order: B4b → B9 → B10 → B10a → B5 → B6 → B7 → B8 → B11 → …**

### Batch B9: T124–T126 (canvas foundation)

### T124 Editor canvas foundation   [status: done]
Spec: §4.2 · Depends: T110
Acceptance:
- [ ] "Çizim" view in the Parts step (tabs: Liste / Çizim, same data, §3.6); Konva stage in mm, Y up, pan (space-drag, middle mouse, two-finger), zoom to cursor (wheel, pinch), fit-to-content
- [ ] built on `WorkspaceLayout` (T197): vertical tool rail on the left edge of the canvas (40 px buttons, tooltip + shortcut letter), compact inspector on the right, a status bar under the canvas (cursor X/Y in mono, snap toggles, zoom %, units); dot grid rather than lines at the finest level; canvas language from T196 (dimension labels in mono, accent selection, `info` colour for snap guides)
- [ ] adaptive mm grid (1/10/100), rulers, cursor coordinates, scale bar; theme colours
- [ ] editor store: tool, selection, hover, viewport; project data only through commands
Tester focus: pan/zoom with mouse + touch emulation; coordinates correct at 3 zoom levels; visual both themes.

### T125 Selection, move, clipboard, mirror, rotate   [status: done]
Spec: §4.2, §4.4 · Depends: T124
Acceptance:
- [ ] click / Shift-click / box select; move by drag and arrows (1 mm, Shift 10 mm); Delete; Ctrl+C/V/D; mirror H/V; rotate 90°
- [ ] all through commands (`movePart` in the drawing frame, `mirrorPart`, `rotatePart`) with undo; Ctrl+Z / Ctrl+Y
Tester focus: e2e select-move-undo; clipboard paste offsets; mirror keeps outline orientation rules (outer CCW).

### T126 Snap engine (core)   [status: done]
Spec: §4.4 · Depends: T124
Acceptance:
- [ ] pure `snap(point, context)`: endpoint, midpoint, centre, intersection, grid, perpendicular, 45°/90° angle lock; priority order and screen-space tolerance; returns kind + point
- [ ] snap glyphs in the editor; toggle per kind; hold Alt to disable
- [ ] fast-check: a snapped point equals the target within EPS; no snap outside tolerance
Tester focus: property tests; e2e drawing a line onto an endpoint ends exactly there (read from properties panel).

### Batch B10: T127–T129 (drawing tools)

**Look and feel for all three tools (Fable review #2, D-039), implied in each task's acceptance:**
- **Tool rail states:** a tool that works is `fg` colour; the active tool is an accent-filled button (not only a tinted background) and stays active after a shape is finished (repeat mode; Esc or `V` returns to Seç); a tool that is not built yet is not shown at all (no grey, dead buttons). Every rail button has a tooltip with the Turkish name + shortcut letter (`V` seç, `H` kaydır, `R` dikdörtgen, `C` daire, `L` çizgi, `A` yay).
- **In-progress geometry:** accent 1.5 px dashed preview with a 10 % accent fill once the shape is closed; committed parts keep the `sim-part` fill. Cursor is a crosshair while a drawing tool is active; snap glyphs use the `info` colour (T126) and the snapped kind is named in the status bar ("Uç nokta", "Orta nokta").
- **Typed input = one "dynamic input" chip at the cursor** (mono, same chip style as the selection size label "596 × 716"): shows the live value(s), takes digits straight from the keyboard without clicking, Tab moves between fields, Enter commits, Esc cancels. No modal dialog and no input in a side panel for drawing.
- **Next-step hint lives in the status bar** (left, replaces the "İmleç" text while a tool is active), one short Turkish line per state, e.g. "İlk köşeyi tıklayın" → "Karşı köşeyi tıklayın ya da En;Boy yazın". No prose paragraphs in the inspector.
- **Phone (390 px):** tools are usable with one finger (tap-tap, not drag-only); the dynamic input chip docks above the keyboard as a one-row bar with a numeric keypad (`inputmode="decimal"`); two-finger pan/zoom keeps working while a tool is active.
- Visual baselines per tool: one "in progress" capture (preview + chip + hint) at 1440 light and 390 dark.

### T127 Rectangle and circle tools   [status: done]
Spec: §4.3, §4.4 · Depends: T125, T126
Acceptance:
- [ ] rectangle: drag or click + typed "W;H" → parametric rect part (corner radius in properties); circle: centre + radius → freeform round part (bulge arcs)
- [ ] live dimension labels while drawing; Esc cancels
- [ ] look and feel per the B10 block above: accent-filled active rail button, crosshair, dashed accent preview, dynamic input chip "En ; Boy" (rectangle) / "R" or "Ø" (circle) at the cursor, status-bar hint per state; the rail shows only tools that work (line and arc buttons appear with T128/T129)
- [ ] a new part gets the next free name ("Parça 6") and is selected after creation, so the inspector shows it at once
Tester focus: typed sizes exact; new parts appear in the cut list; undo; rail has no dead button; in-progress baseline (1440 light, 390 dark); a rectangle can be drawn with taps only at 390 px.

### T128 Line / polyline tool with typed length   [status: done]
Spec: §4.4, §6.1 · Depends: T126
Acceptance:
- [ ] click-click polyline; type a length + Enter for the current segment, Tab to type the angle; 45°/90° lock with Shift
- [ ] ends within JOIN_TOL close the contour → freeform part (`addSegment`, CCW normalised); open shape shows "Kesilemez, kapalı değil"
- [ ] look and feel per the B10 block above: chip shows "Uzunluk" and "Açı" (Tab switches), rubber-band segment dashed in accent, placed vertices as 6 px square nodes, the start node grows and shows a "Kapat" snap glyph when the cursor is within JOIN_TOL; Backspace removes the last vertex; an open shape is drawn in `warning` stroke with **one** chip on the shape ("Kapalı değil"), not a callout (T199 rule)
Tester focus: e2e drawing an L-shape by typed lengths → exact outline; open shape blocked from nesting with the Turkish warning; Backspace/Esc behaviour; in-progress baseline.

### T129 Arc tool and segment bulge   [status: done]
Spec: §4.4, §6.1 · Depends: T128
Acceptance:
- [ ] 3-point arc and "drag segment middle to bend" (`setSegmentBulge`); typed radius
- [ ] arcs survive save/load and produce G2/G3 (checked through the pipeline)
- [ ] look and feel per the B10 block above: chip shows "R"; the bend handle is a round node at the segment middle (distinct from square vertex nodes), visible only on the selected part, with a ≥ 24 px hit area (44 px on touch); while bending, the arc centre is marked with a small cross and the radius is live in the chip
Tester focus: arc radius from properties = typed radius; G-code contains G2/G3 for the arc; reader check passes; bend handle usable with touch emulation at 390 px.

### Batch B10a: T240–T243 (Fable review #2 must-fixes; runs right after B10)

Source: Fable design review #2 (`docs/reviews/2026-11-18-fable-design-review-2.md`, 2026-11-18). Scores: corporate image 6.5/10 (was 5), modernity 7.5 (7), usability 7 (6.5), readiness for M3–M6 7 (6). Rule: D-039 (canvas budget, one tool-state language). Each task ≤ ½ day.

### T240 Phone board: status bar visible, compact wizard header   [status: done]
Spec: §3.6, §3.7 · Depends: T124, T198 · Decision: D-039
Acceptance:
- [ ] 390 × 844 and 360 × 740, step 2 "Çizim": the board status bar is fully visible; nothing of it sits behind the "Parçalar / Özellikler" button bar or the wizard footer (the canvas card ends above the button bar; on phones the status bar shows only the snap toggle + zoom %, cursor X/Y is hidden because there is no hover)
- [ ] below 640 px the wizard header is **one row ≤ 56 px**: step title + "2 / 5" with a 5-segment progress line (tap opens the step list as a popover with the same lock rules), then the unverified-profile chip (icon only) and undo/redo; the separate "Proje adı / Adsız proje" block and the stepper card are not rendered (the project name is in the top bar title and stays editable on step 1)
- [ ] the Liste / Çizim switch sits in the same band as the canvas toolbar (no row of its own); result: the canvas gets **≥ 55 % of the viewport height** on step 2 Çizim, step 3 and step 4 at 390 × 844 (today ≈ 46 % on the board)
- [ ] the tool rail on phones does not cover the left ruler numbers (the rail starts right of the ruler, or the ruler is hidden below 640 px)
Tester focus: bounding-box assertions (status bar bottom ≤ button bar top; canvas height / viewport height ≥ 0.55) at 390 × 844 and 360 × 740; step popover with keyboard + touch; locked steps still locked; baselines updated on purpose (steps 2–4 mobile).

### T241 Desktop board: canvas budget   [status: done]
Spec: §3.6 · Depends: T124, T197 · Decision: D-039
Acceptance:
- [ ] at 1440 × 900 with both panels open the board canvas is **≥ 640 px wide and ≥ 660 px high** (today ≈ 548 × 632): the "Parçalar" panel is 232 px, the inspector 264 px, and the Liste / Çizim switch moves into the wizard header row (left of the stepper) so it no longer takes a row of its own
- [ ] at 1024–1279 px the "Parçalar" panel starts collapsed (icon rail); the choice is remembered per browser (localStorage, safe when unavailable)
- [ ] the panel collapse buttons sit inside their panel header (same row as "Parçalar · 5 parça" / the part name), not on an empty row above the panels
- [ ] the same widths apply to Dizilim and Simülasyon (one `WorkspaceLayout` default), so the three steps do not jump when stepping through the wizard
Tester focus: bounding-box assertions at 1440 × 900, 1280 × 800, 1024 × 768; no page scroll on steps 2 (Çizim), 3, 4; collapse state survives reload; baselines updated on purpose.

### T242 Board inspector: icon actions, no shortcut prose   [status: done]
Spec: §4.2 · Depends: T125 · Decision: D-039
Acceptance:
- [ ] "İşlemler" becomes one row of 32 px icon buttons (yatay aynala, dikey aynala, 90° döndür, çoğalt, then a separator and sil in `danger` text colour), each with a tooltip "Ad · kısayol" and an `aria-label`; no label touches its button border at 264 px (today "Yatay aynala" / "Dikey aynala" fill their buttons edge to edge)
- [ ] the "Kısayollar: Ctrl+C …" paragraph is removed from the inspector; the same list is a "Çizim tahtası" section in the existing shortcuts dialog (T104), opened from a "?" button in the board status bar
- [ ] on phones the same icon row appears as a floating mini-toolbar above the selection (in the canvas overlay), so mirror/rotate/duplicate/delete do not need the "Özellikler" sheet
- [ ] with nothing selected the inspector shows a compact summary (parça sayısı, toplam alan in m², board extents) instead of an empty panel
Tester focus: every action reachable and named for the keyboard and a screen reader (axe); tooltips show the shortcut; the mini-toolbar never leaves the canvas at 390 px; existing select-move-undo e2e stays green.

### T243 Board reference frame: origin, sheet ghost, fit   [status: done]
Spec: §4.2, §2.4 · Depends: T124, T196 · Decision: D-039
Acceptance:
- [ ] the origin is a clear marker (X axis to the right and Y axis up, 24 px arms with "X" / "Y" in mono, the same glyph as the layout canvas origin) instead of a 4 px dot
- [ ] the project's stock sheet is drawn as a **reference outline** from the origin (dashed `sheet` stroke, label "Plaka 2.800 × 2.070" in mono at its top edge); it is view-only (not selectable, never exported, never a nesting constraint) and has a toggle next to "Izgara" ("Plaka")
- [ ] entering the board and the fit button frame the parts' bounding box with 48 px padding, so the parts fill the canvas (today 5 parts use about a quarter of it); with no parts, fit frames the sheet outline
- [ ] the grid toggle is an icon toggle button with a tooltip (like zoom/fit) at every width, not a checkbox + text
Tester focus: coordinates still correct at 3 zoom levels; the sheet outline is absent from project data and from all exports (unit test: toggling it creates no command); visual both themes, 1440 and 390.

### Review #2 riders: T244–T247 (not a batch; each rides with the batch named in its title; no reorder)

### T244 Dizilim panels: less prose, one summary (rides with B6)   [status: done]
Spec: §3.6 · Depends: T197
Acceptance:
- [ ] left panel: the "Dizilim" card's two paragraphs become one line of chips ("Boşluk 8 mm · Kenar 10 mm · Takım Ø8") with the rest in an info popover; the three KPI tiles do not wrap their labels at the panel width ("Plaka", "Fire", "Kullanım")
- [ ] the per-plate summary exists once (left list); the right inspector shows only the selected plate/part, and with nothing selected a 2-line hint, not three cards
- [ ] the grid/zoom toolbar shares the row with the plate tabs (tabs left, tools right) and the sheet is centred in the remaining canvas (today it hangs at the top with an empty band below)
Tester focus: no sentence with a safety meaning is removed (string list); sheet centred at 1440 × 900 and 1024 × 768; baselines.

### T245 Simulation transport and summary polish (rides with B6)   [status: done]
Spec: §8.2 · Depends: T197
Acceptance:
- [ ] "Oynat" is a solid accent button in its idle state (today it is a pale tint that reads as disabled); while playing it becomes "Duraklat" in the secondary style
- [ ] one info text per region (T199): the reduced-motion note under the transport becomes an info icon with a popover; the "air cut'ın yerine geçmez" callout stays, unchanged in text
- [ ] "Özet" is a 2-column definition list in compact density (6 values in ≤ 150 px height) instead of six tiles; the dashed table outline is never clipped by the canvas edge at fit zoom
Tester focus: **safety**: the air-cut sentence is still visible without a click; play/pause e2e green; contrast of the idle "Oynat" ≥ 4.5:1.

### T246 Cut list feedback and empty warnings (rides with B7, with T118)   [status: done]
Spec: §4.1 · Depends: T105
Acceptance:
- [ ] "5 satır eklendi. Geri almak için …" is a toast with a "Geri al" action (sonner), not a persistent full-width green banner above the table
- [ ] the "Uyarılar" panel with no issues collapses to a single "Sorun yok" chip in the table header and the table uses the full width; with issues the panel returns (count in the chip)
- [ ] the helper sentence next to the Liste / Çizim switch moves into the table's empty state and the import dialog
Tester focus: the toast action undoes the paste in one step; chip ↔ panel switch when a warning appears; axe (toast is announced).

### T247 Shell tidy: one save state, no duplicate nav (rides with B8)   [status: done]
Spec: §3.4, §3.7 · Depends: T103 · Owner: FQ4 decided by the reviewer (design delegated 2026-11-18)
Acceptance:
- [ ] the save state is shown once per screen: in the wizard the footer keeps "Kaydedildi" and the top-bar chip is hidden (≥ 1024 px); on phones the top-bar dot stays and the footer text is dropped
- [ ] "Oluştur" is removed from the nav (same target as "Yeni proje"); it returns with the AI chat in M11
- [ ] wizard header at ≥ 1280 px: the "Proje adı" caption is dropped and the project name is an inline-editable title on every step (pencil on hover, Enter saves, Esc cancels)
Tester focus: nav item count and active state through a new-project flow; a rename from step 3 persists after reload; baselines updated on purpose.

---

## M3: Kesim listesi, malzeme kütüphanesi, damar kadranı (exit: a free-angle grain set on sheet and part is respected in nesting, preview and G-code; the cut list is fully editable in the app)

### Batch B5: T112–T114 (grain angle engine)

### T112 Grain angle model: schema v2, migration, commands   [status: done]
Spec: §6.2, §9.2 · Depends: none · Decision: D-034
Acceptance:
- [ ] schema v2: `stock.sheet.grain` = angle in degrees [0, 180) (or `null` = no grain); part `grain: { mode: 'free' | 'fixed', angle }` (angle in the part frame, [0, 180)); placement `rot` = any degrees [0, 360) (number, 3 decimals)
- [ ] migration v1 → v2: sheet `grain` 0/90 kept; `grainLock: true` → `{ mode: 'fixed', angle: sheet grain }`, `false` → `{ mode: 'free', angle: 0 }`; placements unchanged; v1 fixtures migrate and validate
- [ ] commands `setGrain(angle|null)` (sheet), `setPartGrain(id, {mode, angle})`, undoable; `updatePart` keeps accepting `grainLock` as an alias for one release
- [ ] pure `allowedRotations(part, sheet, policy)`: fixed → {g, g+180} with g = sheetGrain − partGrain (mod 360); free → {0, 90, 180, 270} (+ policy steps later, T166)
- [ ] fast-check: for every fixed part and every rotation from `allowedRotations`, (partGrain + rot) ≡ sheetGrain (mod 180)
- [ ] D-038: `rotatePart` / `mirrorPart` turn `part.grain.angle` with the shape via `turnGrain` / `mirrorGrain` (core, B9); unit tests: 4 × rotate 90° = identity incl. grain, mirror twice = identity
Tester focus: migration on every existing fixture + saved projects in PGlite; undo round-trip; property test review.

### T113 Arbitrary-angle rotation through geometry, toolpath, post and checks   [status: done]
Spec: §6.1, §6.3, §6.5, §7.2 · Depends: T112
Acceptance:
- [ ] geometry `transform` supports any angle (bulges unchanged, vertices rotated); arc-aware bbox of rotated outlines
- [ ] toolpath, cut order, tabs and the G-code checks (part positions vs layout) work for non-90° placements; post unchanged
- [ ] all existing golden files byte-identical
- [ ] properties: for random angles every cutting move stays at tool radius from the rotated part (± EPS); area invariant under rotation
Tester focus: **G-code safety**: a 30°-rotated part through post + reader + checks; §7.2 rule tests still pass; golden diff = none.

### T114 Placer: grain-aware rotations with rotated footprints   [status: done]
Spec: §6.2 · Depends: T113
Acceptance:
- [ ] the min-waste placer takes rotations from `allowedRotations`; an axis-aligned angle uses the rectangle as today; a non-axis angle places the **axis-aligned bbox of the rotated outline** (interim until true-shape, T165–T167) and reports `GRAIN_ROTATED_BBOX` info with the extra waste
- [ ] `PART_LARGER_THAN_SHEET` respects the forced rotation
- [ ] fast-check: no overlap (exact rotated rectangles), inside margin, gap kept, grain rule holds, deterministic
- [ ] benchmark set gains a grain-30° case
Tester focus: property tests for the grain rule; a fixed 30° part never appears at another angle; deterministic re-run.

### Batch B6: T115–T117 (grain dial UI)

### T115 GrainDial component   [status: done]
Spec: §3.6, §3.7 · Depends: T101
Acceptance:
- [ ] circular dial like an angle wheel: drag the handle around the circle, click on the ring to jump, numeric input next to it (°, decimal comma), quick buttons 0° / 45° / 90° / 135°
- [ ] look (Fable review #1): 120 px dial (72 px variant for popovers and table cells); outer ring with ticks every 15° and longer ticks + labels at 0/45/90/135; the **handle is a diameter line with a grip at both ends** (a grain has no direction, so both ends drag and "30° = 210°" is seen, not explained); the disc is filled with fine grain lines clipped to the circle; the angle read-out sits in the centre in mono ("30°"); the tick under a snap lights up in accent while snapped
- [ ] snaps to multiples of 45° within ±3° while dragging (hold Alt to disable); grain lines inside the dial rotate live
- [ ] keyboard: role `slider`, arrows ±1°, Shift+arrows ±15°, Home = 0°; aria-valuetext "30 derece"
- [ ] angle normalised to [0, 180) with a visible note that 30° and 210° are the same grain; `disabled` and "no grain" states
- [ ] in `/dev/ui` gallery; unit tests for angle maths (pointer → angle, snap, normalise)
Tester focus: drag interaction e2e (mouse + touch emulation), keyboard steps, snap behaviour, axe, screenshots both themes.

### T116 Grain in the UI: sheet, parts, layout and simulation   [status: done]
Spec: §3.6, §4.1, §6.5 · Depends: T114, T115
Acceptance:
- [ ] wizard step 1: GrainDial for the sheet (only for wood/veneered materials; "damar yok" otherwise); the sheet preview (T196) redraws its grain texture live while the dial is dragged
- [ ] cut list: grain column shows a mini arrow + angle and fixed/free toggle; editing opens a popover with the GrainDial; bulk edit sets the same grain
- [ ] layout view + simulation: sheet grain texture lines at the sheet angle; each part shows a grain arrow at its effective angle (part grain + rot); rotated parts drawn rotated
Tester focus: visual check that arrows match angles (screenshot at 0/30/90°); editing grain is one undo step; free parts show no arrow.

### T117 Grain end-to-end test   [status: done]
Spec: §11 · Depends: T116
Acceptance:
- [ ] e2e: sheet grain 0°, part A fixed 0°, part B fixed 90°, part C fixed 30° → nesting places A at 0/180, B at 90/270, C at −30/150; simulation and NC download pass every check
- [ ] core test: the read G-code of C's outer contour matches the 30°-rotated outline within tolerance
Tester focus: run the e2e; inspect the NC file contour direction for C; G-code safety review of the rotated case.

### Batch B7: T118–T120 (cut list UX)

### T118 Cut list grid v2   [status: done]
Spec: §4.1 · Depends: T111
Acceptance:
- [ ] TanStack Table + virtual rows: name, W, H, qty, grain, edge Üst/Alt/Sol/Sağ, material note; sticky header; column resize
- [ ] spreadsheet-like inline editing: click/Enter to edit, Tab/Shift+Tab, arrows, Esc cancels, Enter commits and moves down; Turkish decimal comma; per-cell validation with tooltip
- [ ] "+ Satır ekle" and Enter on the last row add a part; each commit = one command, one undo step
- [ ] 1 000 rows: scroll ≥ 50 fps, edit commit < 50 ms
- [ ] 390 px: card list mode instead of the grid
- [ ] compact density (T195): 36 px rows, numbers right-aligned in tabular figures, the four edge-band columns collapsed into one "Bant" cell with a 4-side glyph (click opens the four inputs), so name/W/H/qty/grain fit without horizontal scroll at 1024 px
Tester focus: keyboard-only edit flow e2e; perf trace with 1 000 rows; undo/redo after a series of edits; visual both widths.

### T119 Row actions, multi-select and bulk edit   [status: done]
Spec: §4.1, §5.1 · Depends: T118
Acceptance:
- [ ] row menu: duplicate, delete, move up/down; Ctrl/Shift multi-select; Ctrl+D duplicate, Delete removes (with undo toast)
- [ ] bulk edit Sheet for the selection: qty, grain, edge bands, name prefix; new command `updateParts` = one undo step
- [ ] footer summary: rows, total pieces, total area m², estimated sheets (area / usable sheet area)
Tester focus: bulk edit of 50 rows → one undo restores all; summary numbers checked against a hand calculation.

### T120 Import and export: CSV/XLSX file, paste dialog, CSV out   [status: done]
Spec: §4.1 · Depends: T118
Acceptance:
- [ ] "İçe aktar" dialog: drop/select `.csv`, `.xlsx` (MIT/Apache reader, licence-checked), or paste; reuses the T011/T011b parser and mapping preview; size limit and type check (§8.6)
- [ ] "Dışa aktar" CSV (semicolon, Turkish decimal comma, UTF-8 BOM) that re-imports to the same parts
- [ ] round-trip property test (export → import = same parts)
Tester focus: real Excel files (merged header row, empty rows, Turkish chars); oversized file rejected; round trip.

### Batch B8: T121–T123 (materials, cabinets, organisation)

Riders in this batch: T247 (review #2), T252 with T121 and T253 with T123 (review #3; text in "Review #3 riders" below).

### T121 Material & stock library   [status: done]
Spec: §3.4, §3.6, §9.1 · Depends: T111
Acceptance:
- [ ] Ayarlar → Malzemeler page: CRUD of materials (type, name, thickness list, colour/texture key, default grain angle, stock sheet sizes, linked parameter set per machine), company-scoped `materials` table + migration
- [ ] wizard step 1 picks material → thickness → sheet size from the library (custom size still possible); seed: MDF 18, Kontrplak 18, Melamin 18, Akrilik 5 with 2800×2070, 2440×1220
- [ ] tenancy test for the new table
Tester focus: CRUD e2e; wizard uses library values; company isolation test; visual + axe.

### T122 Parametric cabinet box generator   [status: done]
Spec: §4.7 (v3 note) · Depends: T119
Acceptance:
- [ ] pure core `cabinetParts(params)`: W, H, D, thickness, back panel (none/inset/overlay, thickness), fixed shelves count, doors (0/1/2, gap), plinth height → named rect parts with grain (sides vertical) and edge band defaults; no joinery
- [ ] "Dolap ekle" dialog with live mini preview (2D front view) → `importCutList` as one undo step; parts tagged with a group name
- [ ] no lock-in (owner, D-041): every generated part is a plain cut-list row; it can be deleted, copied/duplicated and edited (dims, qty, grain, bands, name) one by one; deleting or editing one part never changes the others; the group tag is only a label (editable, removable), never a lock; no hidden link back to the generator
- [ ] unit + property tests (dimensions add up, all parts positive, door gaps)
Tester focus: generated dimensions vs hand calculation for 3 cabinets; undo removes the whole cabinet; dialog keyboard flow; generate → delete one part, copy one, edit one → the rest unchanged and nesting/export work.

### T123 Cut list organisation: groups, search, sort, filter   [status: done]
Spec: §4.1 · Depends: T119
Acceptance:
- [ ] group column (cabinet/tag) with collapsible groups; search box (Turkish folding); sort by any column; filter "hatalı satırlar"
- [ ] sorting/filtering never changes part order in the project (view only)
Tester focus: e2e search + sort + group collapse; project JSON order unchanged after sorting.

### Batch B8a: T249–T251 (Fable review #3 must-fixes; runs right after B8; T248 deferred, D-043)

Source: Fable design review #3 (`docs/reviews/2026-11-19-fable-design-review-3.md`, 2026-11-19, screenshots in `docs/reviews/2026-11-19-fable-3/`). Scores: corporate image 7/10 (was 6.5), modernity 8 (7.5), usability 7.5 (7), readiness for M4–M6 7.5 (7). Rule: D-040. Each task ≤ ½ day.

### T248 Phone cut list: compact cards, one-row toolbar   [status: done]
> **Deferred to the mobile UI pass (D-043).** Only the import-panel bullet (sticky "N satır ekle / Vazgeç" row, one-sentence intro) stays in B8a and moved to T250.
Spec: §4.1, §3.7 · Depends: T118, T119, T120, T123 (same toolbar)
Acceptance:
- [ ] below 640 px a part card is **≤ 88 px high** when it has no issue (today 158 px): line 1 = checkbox, row number, name, "⋯" menu; line 2 = "560 × 720" in mono, "×8", the grain chip ("↔ 0°" / "Serbest") and a band chip only when a band is set; tapping a value edits it in place as today; at 390 × 844 at least 5 cards are visible under the toolbar
- [ ] the list toolbar is **one row** at 390 px and 360 px: "İçe aktar" (primary) + "Satır ekle" as icon+text, everything else ("Dışa aktar", and T123's sort / filter) in one "⋯" menu; with a selection the row is replaced by "2 seçili · Toplu düzenle · ⋯ · ✕" (today 2 rows, 4 rows with a selection)
- [ ] the "Bant ☐ –" compact cell is replaced by the band chip above (phone) and by T253's cell (desktop compact layout); no control without a visible meaning
- [ ] import panel, every width: the "N satır ekle" / "Vazgeç" row is sticky at the bottom of the panel so it is visible without scrolling at 1440 × 900 and 390 × 844; the intro paragraph is one sentence, the rest moves into an info popover
Tester focus: card height and visible-card count by bounding box at 390 × 844 and 360 × 740; every toolbar action still reachable by keyboard and named (axe); edit, select, bulk edit and import e2e stay green; baselines updated on purpose.

### T249 Dizilim and Simülasyon panels II: one toolbar row, shared inspector rows   [status: done]
Spec: §3.6, §8.2 · Depends: T244, T245, T242 · Decision: D-040
Acceptance:
- [ ] Dizilim and Simülasyon at ≥ 1024 px: plate tabs (left) and the canvas tools (right) share **one row** (today two rows at 1440; open item from T244); the grid toggle is the same icon toggle button as on the board (no checkbox + "Milimetre ızgarası (100 mm)" text; the text is its tooltip), at every width
- [ ] one shared `InspectorRow` (label left, mono value right, one line, 32 px) in `packages/ui`; the board inspector and the Dizilim "Seçili parça" list both use it; at 264 px no value wraps ("596 × 716 mm", "X 622 · Y 742 mm", "Damar · kilitli 30°")
- [ ] Dizilim left panel: the "Boşluk / Kenar" chips that repeat the two inputs above them are removed (the "Takım Ø8" chip stays); the per-plate prose lines are removed (the tabs carry "fire %"); the sentences "Şimdilik üç mod da …" and "Artık parça kullanımı (yakında)" are removed from the UI (unbuilt options are not shown, D-039)
- [ ] *(deferred to the mobile UI pass, D-043; see T255)* Simülasyon below 640 px: the whole transport (scrubber, time, speed chips, position line) is visible above the "Ayarlar / G-code" button bar with nothing behind it (same rule as T240); the wizard header shows the short label "Simülasyon" below 640 px (the step name itself is unchanged, spec §3.7)
Tester focus: **safety**: the air-cut sentence and every warning string are still present (string list before/after); bounding boxes: transport bottom ≤ button bar top at 390 × 844 and 360 × 740; tabs and tools on one row at 1440 and 1024; play/pause and layout drag e2e green; baselines updated on purpose.

### T250 Export step: download in the footer, tidy file rows   [status: done]
Spec: §3.7, §7.1 · Depends: T111, T199 · Decision: D-040
Acceptance:
- [ ] on step 5 the wizard footer's primary button is **"İndir"** (where "İleri" sits on steps 1–4), so it is visible without scrolling at 1440 × 900 and 390 × 844; it is disabled until the checklist and the unverified-profile acceptance are complete, and its disabled reason ("İndirmek için kontrol listesini tamamlayın") is shown next to it; the in-page button is removed (one download action per screen)
- [ ] no safety text, checkbox or acceptance step is removed or reworded; the download request and its server-side checks are unchanged
- [ ] file rows never break inside a word at any width: file name (mono, truncated in the middle if needed) on line 1; size in Turkish format ("20,1 KB") and "sha256 f2acd1f0…" (first 8 characters, full hash in a tooltip and a copy button) on line 2
- [ ] "Dışa aktarma geçmişi" uses the same file row
Tester focus: **safety**: download impossible until every box is ticked (keyboard and click), same as before; full hash still reachable and correct (copy); no mid-word wrap at 390 and 360 px; export e2e green.

### T250 import-panel note
> T250 also carries the T248 import-panel bullet (D-043): the "N satır ekle" / "Vazgeç" row is sticky at the bottom of the import panel so it is visible without scrolling at 1440 × 900; the intro paragraph is one sentence, the rest moves into an info popover.

### T251 Canvas material tone   [status: done]
Spec: §3.2, §8.3 · Depends: T196 · Decision: D-040
Acceptance:
- [ ] new tokens for the stock sheet and for parts in a warm, pale wood family, light and dark (the sheet lighter, parts one step stronger, ink outline); used by the layout canvas, the simulation canvas, the board, the step 1 preview and the home/project thumbnails; no hard-coded colours in canvas code
- [ ] the UI accent stays cobalt: selection, handles, active tool, previews and snap guides keep their colours; orange/amber stays only for the simulation tool and rapids; no second UI colour is added
- [ ] part labels and measures on the new part fill ≥ 4.5:1, part outline against the sheet ≥ 3:1, both themes (`tokens.test.ts` covers the new pairs); the grain hatch and the grain glyph stay readable on the new fills
- [ ] a locked part, a selected part and an overlapping/invalid part are still told apart without relying on colour alone (existing icons/strokes kept)
Tester focus: contrast tests; all canvas baselines regenerated on purpose and looked at one by one in both themes; simulation toolpath colours still distinct from the part fill.

### Review #3 riders: T252–T254 (not a batch; each rides with the batch named in its title; no reorder)

### T252 Step 1: grain dial next to the sheet preview (rides with B8, with T121)   [status: done]
Spec: §3.7, §2.4 · Depends: T116
Acceptance:
- [ ] at ≥ 1024 px the "Damar yönü" dial sits in the "Önizleme" card under the sheet preview (dial left, angle input and presets right), not at the end of the form; at 1440 × 900 the dial and the preview are both fully visible without scrolling (today the dial starts behind the footer)
- [ ] below 1024 px the preview card comes directly above the dial block (today the "Uyarılar" card sits between them and they are ≈ 400 px apart)
- [ ] the "Uyarılar" card with no issues becomes the "Sorun yok" chip in the step card header (same component as T246); with issues the card returns
Tester focus: bounding boxes at 1440 × 900 and 390 × 844; dial keyboard use and undo unchanged (T115/T116 e2e green); chip ↔ card switch.

### T253 Cut list grid: quiet zeros, stable layout with warnings (rides with B8, with T123)   [status: done]
Spec: §4.1 · Depends: T118, T246
Acceptance:
- [ ] an edge band value of 0 is shown as a dimmed "–" (the cell is still editable and shows the number while focused); data and CSV export are unchanged (still 0)
- [ ] when the first issue appears the grid does not move or change its columns: "Uyarılar" opens as a right-side panel over the free space at ≥ 1280 px (or as a popover from the issue chip when there is no room), and the four band columns stay as they were
- [ ] in the compact band layout (grid < 1040 px) the "Bant" cell shows four small edge marks (which edges have a band) and opens the four inputs in a popover; no bare checkbox
Tester focus: typing 9000 into a width cell at 1440 and 1280 leaves every other cell's x position unchanged (bounding boxes); export CSV still writes 0; keyboard path through the band popover; axe.

### T256 Floating Uyarılar panel never covers cells; toasts above the footer (rides with B11)   [status: done]
Spec: §4.1 · Depends: T253, T246 · Source: B8 tester r1 + B8a tester notes (2026-11-19)
Acceptance:
- [ ] the Parçalar "Uyarılar" panel auto-opens only when it fits right of the last grid column without covering any cell or header; otherwise it stays closed behind the issue chip (as at 1024 px)
- [ ] once the user closes it, it stays closed for that project (remembered per project, survives reload) until a new issue type appears
- [ ] toasts (e.g. "N satır eklendi · Geri al") sit above the wizard footer and never cover its right-hand button (İleri / İndir) at 1440 and 1024
Tester focus: bounding boxes at 1440 and 1280 with issues: no overlap with grid cells; close → reload → still closed; toast box above footer box.

### T254 Board: fit to the sheet, grain glyph, focus ring (rides with B11, with T130)   [status: done]
Spec: §4.2, §2.4 · Depends: T243, T116 · Decision: D-040 (replaces the "fit frames the parts only" line of T243)
Acceptance:
- [ ] with the sheet outline on, entering the board and the fit button frame the **union of the sheet outline and the parts** with 48 px padding, so at 1440 × 900 all four sheet edges and the "Plaka 2.800 × 2.070" label are visible (today only two dashed lines show and the label is under the ruler); with the outline off, fit frames the parts as before
- [ ] parts with a fixed grain show the same grain glyph as on the layout canvas, at the part's angle; it follows rotate and mirror (D-038)
- [ ] the canvas focus indicator is a full 2 px inset ring on all four sides (today only the right and bottom edges show while drawing), or none when the pointer is in use (`:focus-visible` rule)
Tester focus: sheet edges inside the canvas box at 1440 × 900, 1024 × 768 and 390 × 844; glyph angle after rotate 90° and mirror on 2 parts; focus ring with keyboard only; baselines.

### Batch B11a: T257–T260 (CTO review #4 must-fixes: ease of use; runs right after B11, before B12)

Source: `docs/reviews/2026-11-19-cto-design-review-4.md` (operator walkthrough). Rule: D-045. Each task is at most half a day. Desktop-first (D-043): checks at 1440 and 1024; 390 is a smoke check.

### T257 Seeded materials cut out of the box   [status: done]
Spec: §3.7, §2.4 · Depends: T121 · Decision: D-045, D-044
Acceptance:
- [ ] the seeded example machine profile has a parameter set for Melamin 18 mm and Kontrplak 18 mm (same values as its MDF 18 mm set; the profile stays "Taslak / Örnek" and unverified); Akrilik 5 mm stays without a set; existing golden G-code files stay byte-identical
- [ ] step 1 material list: a library entry that has no parameter set on the selected machine shows a small amber "ayar yok" mark (icon + text) in the list, before it is picked
- [ ] Ayarlar → Malzemeler: the per-machine chip shows a short status ("Tamam" / "Ayar yok") after the machine name and is never cut with "…" at 1440 or 1024; the full sentence is in the tooltip
- [ ] on a fresh database a project with library "Melamin 18 mm" goes from step 1 to "İndir" with no error
Tester focus: fresh PGlite DB, Melamin 18 and Kontrplak 18 end to end (checks green, file downloads); golden files unchanged; Akrilik shows the mark; chip text at 1440 and 1024.

### T258 "No cutting parameters" is caught at step 1, with one action to fix it   [status: done]
Spec: §3.7, §9 · Depends: T257 · Decision: D-045
Acceptance:
- [ ] the step 1 error box has a button "Kesim ayarı ekle": it opens the machine form scrolled to "Malzeme parametreleri" with the material kind and thickness prefilled in a new set; after saving, a "Projeye dön" link returns to the same project and step
- [ ] while this error exists the step indicator marks step 1 with an error dot, visible from every step (today the user learns that nothing can be downloaded only on step 4, after nesting)
- [ ] user-facing text only: "Makineler → Malzemeler" becomes "Makineler → Malzeme parametreleri" (Malzemeler is now a page under Ayarlar); the line "Teknik ayrıntı: No cutting parameters for …" is not shown; the raw "TOOLPATH" chip on the export step becomes "Takım yolu"
Tester focus: Akrilik 5 mm project: button → set saved → back in the project, error gone, export reachable; no English sentence and no upper-case internal code on steps 1, 4 and 5 (text scan); keyboard path.

### T259 Step 1 material field and sheet preview polish   [status: done]
Spec: §3.7, §2.4 · Depends: T121, T252
Acceptance:
- [ ] the closed Malzeme select shows a library entry on one line (swatch, "MDF · 18 mm"); today the second line is clipped at the bottom edge at 1440 and 1024
- [ ] the list shows the library first; the generic kinds sit below under one heading "Kütüphane dışı" (today "MDF" appears twice with no explanation); a new project starts on the library's first usable entry for the machine, not on a bare kind
- [ ] with a material that has no grain ("Yok") the sheet preview has no grain hatch and the dial block says "Bu malzemede damar yok" (today the preview is striped while the dial shows "–"); the "Plaka damar yönü" legend chip on Simülasyon is hidden in the same case
- [ ] the thickness field has no native datalist arrow next to the number
Tester focus: bounding box of the select value inside the trigger at 1440 and 1024, both themes; MDF vs Melamin preview (hatch off/on); step 1 e2e (T121, T252) green.

### T260 Cabinet generator: only parts this stock can make, calmer form   [status: done]
Spec: §4.1 · Depends: T122 · Decision: D-045, D-041
Acceptance:
- [ ] when "Arkalık kalınlığı" differs from the project's plate thickness the back panel is **not** added to the cut list by default: the summary shows it as "1 × Arkalık 564 × 720 · 8 mm · ayrı plaka" with a checkbox "Yine de listeye ekle"; when added it carries the note "8 mm" (today an 8 mm back lands silently in the 18 mm list and is nested on the 18 mm sheet)
- [ ] generated rows get a fixed grain only when the project's stock has a grain; on a material without grain they are "Serbest"
- [ ] the dialog remembers the last used values per browser (shelves, back, door, band, gap); width/height/depth keep their defaults
- [ ] at 1440 and 1024 the door radios are on one line each ("Tek kapak", "Çift kapak" do not wrap) and the "Arkalık" select shows its value in full
Tester focus: a cabinet with 2 shelves on an 18 mm project adds 7 pieces without the back and 8 with the checkbox ticked; MDF project rows are "Serbest", Melamin rows keep grain; one undo still removes the whole set (D-041); axe.

### CTO review #4 riders: T261–T263 (not a batch; each rides with the batch named in its title; no reorder)

### T261 Parçalar → Dizilim flow: no phantom row, nesting runs on first entry (rides with B12, with T135)   [status: done]
Spec: §4.1, §3.7 · Depends: T118 · Decision: D-045
Acceptance:
- [ ] a row created by pressing Enter on the last row and never edited ("Parça N", 100 × 100) is removed when focus leaves it or the step changes; a row added with "Satır ekle" is kept (today the leftover row is nested and cut as a 100 × 100 part)
- [ ] entering Dizilim with parts and no layout runs the nesting once automatically (same command as "Diz", one undo step); after that "Diz" works as today; nothing runs automatically when a layout exists
Tester focus: type a row, press Enter, click İleri: the count has no extra row; first entry to Dizilim shows a layout without a click; locked parts and an existing layout are never re-nested by entering the step.

### T262 Simülasyon G-code panel shows the real file header (rides with B13, with T137)   [status: done]
Spec: §3.7, §9 · Depends: T020, T021
Acceptance:
- [ ] the G-code panel on Simülasyon shows the same file name, project name and revision as the file the export step downloads (today: "NittCam_S1.tap", "(PROJE: NittCam)", "(REVIZYON: 0)" against "Mutfak_alt_dolap_60_S1.tap", "(PROJE: Mutfak alt dolap 60)", "(REVIZYON: 3)"); if the revision is only known after saving, the panel says "kaydedilince" instead of 0
Tester focus: compare the first 12 lines of the panel with the downloaded file on a saved project.

### T263 Laptop widths: canvas budget at 1280 and 1024, Malzemeler row fits (rides with B13, with T137)   [status: done]
Spec: §3.6, §8.3 · Depends: T197, T240 · Decision: D-039, D-045
Acceptance:
- [ ] below 1440 px the app sidebar opens as the icon rail on the workspace steps (board, Dizilim, Simülasyon); the user's own toggle wins and is remembered
- [ ] with that, the wizard header is one row at 1280 (as at 1440) and the canvases measure at least: board and Dizilim 640 × 520 at 1280 × 800 and 580 × 480 at 1024 × 768; Simülasyon 640 × 380 at 1280 × 800 and 580 × 300 at 1024 × 768 (measured today: board 494 × 509 and 430 × 457, Simülasyon 494 × 346 and 430 × 250)
- [ ] Ayarlar → Malzemeler has no page-level horizontal scroll at 1024 and both row actions (edit, delete) are visible (today the page overflows by 37 px and the delete button is off screen)
Tester focus: bounding boxes at 1280 × 800 and 1024 × 768; sidebar toggle remembered after reload; 1440 baselines unchanged.

---

## M4: Çizim tahtası I: editör (exit: a freeform part drawn with lines, arcs and fillets is nested and gives checked G-code)

Konva stays the 2D engine (§8.3). Every edit is a command (§5.1). Snap/geometry logic is pure core code with property tests.

B9–B10 (T124–T129) were moved up and run right after M2.5, before M3 (D-035 amendment, 2026-11-18); their task text is in the section "M4 early: Çizim tahtası temeli" above. M4 continues here with B11.

### Batch B11: T130–T132 (properties and corner tools)

Rider in this batch: T254 with T130 (review #3; text in "Review #3 riders" in the M3 section). T130 builds the inspector from the shared rows of T249 (D-040).

### T130 Properties panel   [status: done]
Spec: §4.4 · Depends: T127
Acceptance:
- [ ] part: name, qty, W/H/R (parametric), grain (GrainDial), operation summary; segment: length, angle, radius; vertex: X/Y
- [ ] the panel is the right inspector of `WorkspaceLayout` (T197) in compact density (32 px controls, label left / value right rows, collapsible groups)
- [ ] `setSegmentLength` rule: end vertex moves along the segment, the neighbour follows (§4.4), no solver; `moveVertex`
- [ ] edits are commands, one undo step each; invalid values rejected with Turkish errors
Tester focus: segment-length rule on 3 shapes (hand-checked coordinates); undo granularity; keyboard use of the panel.

### T131 Fillet, inner-corner rule, convert to freeform   [status: done]
Spec: §4.3, §4.4 · Depends: T130
Acceptance:
- [ ] `filletCorners(part, corners, r)` in core: radius clamped to neighbour lengths with a warning
- [ ] concave corners below tool radius: warning with "otomatik düzelt" (fillet to tool radius)
- [ ] `convertToFreeform` for parametric parts
- [ ] property tests: fillet keeps the contour closed, orientation kept, area decreases
Tester focus: property tests; clamp warning visible; auto-fix result checked against the tool radius of the selected machine.

### T132 Dogbone / T-bone   [status: done]
Spec: §4.4 · Depends: T131
Acceptance:
- [ ] `addDogbone(part, corner, style)` in core: overcut circle of tool radius at concave corners (dogbone along the bisector, T-bone along a chosen edge)
- [ ] editor action on selected corners; tests: the tool can reach the corner point (toolpath reaches within EPS)
Tester focus: toolpath test that the corner point is cut; visual check of both styles.

### Batch B12: T133–T135 (dimensions, cutouts, sync)

Rider in this batch: T261 with T135 (CTO review #4; text in "CTO review #4 riders" in the M3 section).

### T133 Dimension labels and annotations   [status: done]
Spec: §4.2, §4.4 · Depends: T130
Acceptance:
- [ ] on-canvas length labels for selected segments and parts (always readable size); dimension tool for persistent linear dimensions (stored as non-cut annotations, ignored by nesting/toolpath)
Tester focus: annotations never reach the toolpath (core test); labels readable at all zoom levels (screenshots).

### T134 Inner contours (cutouts)   [status: done]
Spec: §4.3, §6.1 · Depends: T128
Acceptance:
- [ ] drawing a closed shape inside a part asks "iç kesim olarak ekle?" → added to `inners` (CW normalised)
- [ ] validation: inner inside outer, inners not overlapping, inner larger than tool diameter
Tester focus: validation cases; the inner contour survives nesting rotation (moves with the part).

### T135 Cut list ↔ editor sync   [status: done]
Spec: §3.6, §4.1 · Depends: T127, T118
Acceptance:
- [ ] parts sidebar in the editor (search, select); selection syncs between Liste and Çizim; freeform parts show "Serbest" with bbox W/H read-only in the grid
- [ ] drawing arranges parts in a non-overlapping drawing area (drawing positions are not nesting positions)
Tester focus: e2e create in grid → visible in editor and back; freeform W/H not editable in grid.

### Batch B12a: T264–T266 (CTO review #5 must-fixes; runs right after B12, before B13)

Source: `docs/reviews/2026-11-19-cto-design-review-5.md`. Rules: D-047 (max 3 must-fix tasks, each at most half a day), D-045, D-046. Desktop-first (D-043): checks at 1440 and 1024; 390 is a smoke check.

### T264 "Kesim ayarı ekle" always returns to the same project   [status: done]
Spec: §3.7 · Depends: T258 · Decision: D-045
Acceptance:
- [ ] on a new project whose first edit is the material, clicking "Kesim ayarı ekle" at any moment (also within 1 s, before the first autosave has finished) opens the machine form with a return path to that project's id; "Projeye dön" lands on the same project with the same name, material and thickness (today: `donus=/projeler/yeni`, the return opens a new empty MDF project that says "Sorun yok" and the first project is orphaned)
- [ ] the address bar on the machine form is the `/makineler?...` URL (today the late autosave rewrites it to the project URL while the form is shown)
- [ ] no extra project is created by the round trip (project count +1 at most)
Tester focus: e2e with the click right after the pick (no wait) and after 4 s; project id, name and material before and after; Projeler count; the existing b11a spec picks the material first and must now assert the material after the return.

### T265 A parameter set added by the fix flow is never saved blind   [status: done]
Spec: §2.4, §3.7 · Depends: T258, T257 · Decision: D-046, D-045
Acceptance:
- [ ] the row that "Kesim ayarı ekle" prefills (feed 5.000, rpm 18.000, step-down 6, first tool; the form's generic starting values) carries a visible note under it, in the same place and style as the copied-set note: "Başlangıç değerleri; bu malzeme için doğrulanmadı. Kendi makinenizde doğrulayın." The mark is stored with the set and is dropped when the user edits a value of that row (same behaviour as `copiedFrom`)
- [ ] the prefilled step-down is never larger than the sheet thickness (Akrilik 5 mm starts at 5, not 6)
- [ ] the first value field of that row has focus and the row is scrolled into view with the "Paso" and "Takım no" columns visible at 1440 (today they are behind the table's horizontal scroll)
- [ ] golden G-code files unchanged; the seeded sets and D-046 notes unchanged
Tester focus: Akrilik 5, PVC and Masif ahşap through the fix flow; the note survives save and reload and disappears after an edit; step-down clamp; golden files byte-identical.

### T266 Corner tools fit the properties panel and stay reachable   [status: done]
Spec: §4.4, §3.6 · Depends: T130, T131, T132
Acceptance:
- [ ] the properties panel never scrolls sideways: content width = panel width at 1440 and 1024 (today 294 px in a 264 px panel; the "Yuvarlama yarıçapı" field ends at x = 1446 on a 1440 px screen and at x = 1030 on 1024, its unit is off screen)
- [ ] when a corner is picked (on the canvas or in the list) the "Köşe" group is scrolled into view, so radius, "Köşeyi yuvarla" and "Taşma aç" are visible without scrolling at 1440 × 900 and 1024 × 768 (today the group starts at y = 863 under the footer at 1440 and at y = 752 at 1024)
- [ ] a toast never covers the "Köşe" group fields while a corner is picked (today "İç köşeye 4 mm yarıçaplı taşma açıldı." sits on X / Y / radius)
Tester focus: scrollWidth = clientWidth of the panel scroller at both widths; bounding boxes of the radius field and both buttons after a canvas corner click; toast box against the group box; axe.

### Batch B13: T136–T137 (editor polish and tests)

Riders in this batch: T262 and T263 with T137 (CTO review #4; text in "CTO review #4 riders" in the M3 section). **Update 2026-11-19:** T262 and T263 shipped early as B13r (#71). B13 is now T136, T137, T267 (must-fix: wrong output) + rider T268.

### T136 First-use tour and hints   [status: done]
Spec: §4.2 · Depends: T135
Acceptance:
- [ ] short tour (5 steps, skippable, remembered) for the editor; contextual hint bar per tool ("Uzunluk yazıp Enter'a bas")
- [ ] shortcut sheet for editor tools (from the T104 registry)
Tester focus: tour once only; keyboard-only completion; reduced motion.

### T137 Editor e2e suite and performance budget   [status: done]
Spec: §11 · Depends: T136
Acceptance:
- [ ] e2e: draw L-shape with arc and fillet → nest → simulate → NC download passes checks (= M4 exit)
- [ ] perf: 500 entities, pan/zoom ≥ 50 fps, selection < 50 ms (trace in CI artefact)
Tester focus: run suite; review perf numbers; G-code safety review of the drawn part's NC.

### T267 Cut list CSV export → import keeps small sizes (must-fix, D-047: wrong output)   [status: done]
Spec: §4.1 · Depends: T118
Found by: B12a full CI run 44536903810, fast-check property `export → import = same parts` in `packages/core/src/cutlist/export.test.ts` (seed -1727248701): a part with w = 0.001 comes back as w = 1.
Acceptance:
- [ ] export writes every size with enough decimals (decimal comma) that import gives back the same value within EPS; no rounding to whole millimetres and no value read as a thousands separator
- [ ] import of a value that is not a valid size (0, negative, below the minimum part size) is refused with a row error instead of being changed silently
- [ ] the property test runs with the failing seed pinned as an example, plus the default random runs; green 20 times in a row locally (`--repeat`)
Tester focus: export a list with 0.5 mm and 1234.25 mm parts and re-import it; open the CSV in a spreadsheet: values readable in Turkish locale.

### T268 Rider: flaky core test under load (`b11-corners.tester`)   [status: done]
Spec: §11 · Depends: none
Found by: B13r dev, 2026-11-19: `packages/core/src/commands/b11-corners.tester.test.ts` timed out once while the whole suite ran in parallel; passes alone 5/5.
Acceptance:
- [ ] find the slow case (profile it); make it fast (smaller fast-check size, shared fixture) or give that one test an explicit timeout with a comment; no blanket timeout increase
- [ ] `pnpm test` green 5 times in a row under full parallel load
Tester focus: none beyond CI (test-only change).

### Batch B13a: T269–T270 + rider T271 (CTO review #6 must-fixes, D-047)

Runs in parallel with B13 (different screens). Review: `docs/reviews/2026-11-19-cto-design-review-6.md`.

### T269 Simülasyon and step 1 show the profile version the file is made with (must-fix: wrong output)   [status: done]
Spec: §3.7, §9, §2.4 · Depends: T258, T262 · Decision: D-045
Found: the project is bound to a profile version and the export uses it, but step 1 and Simülasyon use the machine's latest version (`apps/web/components/wizard/project-wizard.tsx`, `details[machineId]`). MDF step-down 6 → 9 on the machine: Simülasyon shows "surum 4", `G1 Z-6.1666`, 24 passes; the downloaded file is "surum 1", `G1 Z-4.6250`, 32 passes.
Acceptance:
- [ ] project bound to version N, machine at N+1 with a changed MDF 18 step-down: the Simülasyon G-code panel's first 12 lines, pass count and estimated time equal the downloaded file
- [ ] the machine row and "Kesim ayarı: …" sentence in step 1 show the values of the project's version; the "Takım Ø" chip on Dizilim comes from the same version
- [ ] with a version gap the step 1 box "Makine profili güncellendi … [Son sürüme geç]" also shows on Simülasyon and Dışa aktar (same button, one undo step); after it all three steps show the latest version and the file uses it
- [ ] if this exceeds half a day, smallest fix: with a version gap Simülasyon makes no preview and shows the box with "Son sürüme geç"
- [ ] golden files and "the file is made with the project's version" stay unchanged
Tester focus: create a project, change MDF step-down on the machine, reopen the project; panel text vs first 12 lines and pass count of the downloaded file, before and after "Son sürüme geç"; `?profil=son` return still works.

### T270 An inner cut with no room for 2 tabs is caught where it is drawn (must-fix: late, blocking flow)   [status: done]
Spec: §4.3, §6.3, §3.7 · Depends: T134, T258 · Decision: D-049, D-045
Found: with an 8 mm tool a Ø24 circle is added without warning; cut list "Sorun yok", Dizilim "Sorun bulunmadı", four ticks; only Simülasyon says "Bu dosya indirilemez … 2 köprü sığmıyor" without part name, linking to "Makineler", with "Uyarılar: Sorun bulunmadı" below. The block itself is right (D-049).
Acceptance:
- [ ] an inner cut whose slug has no room for 2 tabs shows an error on Parçalar: on that inner cut's row in the properties panel and in the cut list issue chip; the text names part and inner cut ("Kapak · İç kesim 3: …"); the rule comes from the same core function as `SMALL_SLUG_UNSECURED` in the toolpath
- [ ] the step indicator puts the red dot on Parçalar and keeps it visible on Dizilim, Simülasyon, Dışa aktar (same as the unverified cutting set)
- [ ] the red box on Simülasyon and Dışa aktar names part and inner cut; its link opens Parçalar → Çizim with that part selected; the "Uyarılar" card on the same screen never says "Sorun bulunmadı." while it is shown
- [ ] no solution that does not exist yet is offered (remove "cep boşaltma yakında"; the hole tool from B14 may be named once it is on main)
- [ ] D-049, thresholds and golden files unchanged; Ø35 and 80 × 80 pass with tabs as today
Tester focus: Ø24 and Ø35 circle, 80 × 80 square; dot and text on every step; the view the link opens and the selected part; deleting the inner cut clears the error everywhere; 1440 and 1024; axe.

### T271 Rider: a new project never defaults to an unverified cutting set   [status: done]
Spec: §2.4 · Depends: T265
Found by the B12a tester: `apps/web/lib/draft-project.ts:60` `newProject` falls back to `profile.materials[0]` without skipping `unverified` sets (G-code stays blocked, but the T265 rule does not hold in this edge case).
Acceptance:
- [ ] the fallback picks the first verified set; if none is verified, the project starts without a set and step 1 shows the existing "Kesim ayarını doğrula" box
- [ ] unit test for both cases
Tester focus: machine whose only set came from the fix flow (unverified) → new project.

---

## M5: Çizim tahtası II: delik, cep, şablon, DXF (exit: a hinge-door project built with a template and a DXF sign job both give checked G-code)

### Batch B14: T138–T140 (hole object and its toolpaths)

### T138 Hole object, commands and hole tool   [status: done]
Spec: §4.5, §5.1 · Depends: T130
Acceptance:
- [ ] `addHole`, `updateHole`, `removeHole` (type pocket / through / groove, d, cx, cy, depth, groove width, tool); holes move/rotate with the part
- [ ] hole tool in the editor: click centre, diameter grows live, properties with the "İçini boşalt" / "Sadece çember (kanal)" toggle
- [ ] validation: d ≥ tool diameter, blind depth < thickness, groove width ≥ tool diameter, hole inside the part
Tester focus: each validation case; a rotated part keeps holes in the right place (core test + screenshot).

### T139 Toolpath: drilling and through holes   [status: done]
Spec: §4.5, §6.3, §6.4 · Depends: T138 · **Human gate: new golden files (`needs-human`)**
Acceptance:
- [ ] d = tool → single plunge or drill cycle (G81/G83 when the profile supports it, else explicit moves); d > tool → helical/spiral entry + circular path; through depth = thickness + spoilboard allowance
- [ ] cut order holes → inner → outer kept; tabs considered for big through holes
- [ ] reader supports G81/G83 for checks; new golden fixtures for both posts
Tester focus: **G-code safety** (§7.2 rules incl. drill cycle retract plane); failing-input test for a drill below Z limit; golden review list for the owner.

### T140 Toolpath: blind pocket and ring groove   [status: done]
Spec: §4.5, §6.3 · Depends: T139
Acceptance:
- [ ] circular pocket clearing (spiral, stepover from the tool) to depth in passes; groove single/multi pass by width
- [ ] validation "cep derinliği kalınlığa çok yakın" (warning, < 1 mm skin by default)
- [ ] properties: no move below target depth; pocket wall at d/2 ± EPS
Tester focus: safety review; pocket depth vs Z reference both modes (table / material top).

### Batch B14a: T274–T276 + rider T277 (CTO review #7 must-fixes, D-047)

Runs before B18. Review and full evidence: `docs/reviews/2026-11-19-cto-design-review-7.md` ("Şimdi düzelt" A, B, C).

### T274 Multi-tool program: checklist asks for every tool, manual change reminds to re-zero Z (must-fix: safety)   [status: done]
Spec: §7.2, §3.7, §6.4 · Depends: T139, T021 · Decision: D-050, D-051
Found: door panel NC runs T2 → T3 → T2 (two manual changes); the profile has no tool length offset, yet neither the pause message nor the export checklist says to re-zero Z; the checklist asks only "Takım doğru mu? (T2 Ø8 mm)" (`apps/web/lib/server/exports.ts`, `checklistOf`).
Acceptance:
- [ ] "Takım doğru mu?" lists every tool of the program in order of use (T2 Ø8 → T3 Ø5 → T2 Ø8); the list comes from the toolpath
- [ ] with a manual change, a separate confirmation line: "Program içinde N kez durup takım ister. Her değişimden sonra Z'yi yeniden sıfırlayacağım."; İndir stays disabled without it; the same information is in the Simülasyon summary
- [ ] manual change + no length offset: the comment reads "(TAKIM DEGISTIR: T3 D5.000 - Z SIFIRLA - SONRA CYCLE START)"; automatic-change and offset profiles keep their text
- [ ] Simülasyon "Takım değişimi" counts in-program changes (door panel: 2; today 3)
- [ ] golden diff is that comment line only (`mach3/v1/golden/holes-through_S1.tap`); reader checks pass; PR label `needs-human`, approval per D-051
- [ ] if over half a day: checklist now, comment + golden as a follow-up task
Tester focus: safety review; a 1-tool and a 3-tool program; profile with and without manual change.

### T275 Hole errors are caught where the hole is drawn (must-fix: late, unnamed block)   [status: done]
Spec: §4.5, §3.7 · Depends: T138, T270 · Decision: D-045, D-050
Found: a Ø5 hole with the Ø8 tool, a tool number the machine does not have (T9) and blind depth 18 / 30 are accepted silently on the board; Simülasyon blocks with "Tüm program · Delik çapı takım çapından küçük." four times, linking only to "Makineler"; Parçalar shows as complete.
Acceptance:
- [ ] error under the faulty hole's panel row (d < tool, tool missing, blind depth ≥ thickness, groove < tool); same core rule as the toolpath
- [ ] red dot on Parçalar, visible on every step (T270 pattern)
- [ ] cut list, Dizilim, Simülasyon and Dışa aktar say "Kapak · Delik 3: …", one line per hole; button "Çizimde aç"; "Makineler sayfası" only as a second link when the fix is on the machine
- [ ] "Takım no" shows the diameter ("3 · Ø5"); a missing number looks invalid
- [ ] D-050, thresholds and golden files unchanged
Tester focus: each of the four errors; link target and selected part; deleting/fixing the hole clears the error everywhere; 1440 and 1024; axe.

### T276 A hole lands where it is clicked: a centre near the edge is not refused (must-fix: dead-end flow)   [status: done]
Spec: §4.2, §4.5 · Depends: T138, T126
Found: at %18 the grid is 100 mm; every centre closer than 50 mm to an edge snaps onto the edge and is refused with "Delik buraya eklenemedi"; a hinge cup (22,5 mm from the edge) cannot be placed with the mouse.
Acceptance:
- [ ] when snapping would move the centre onto or outside the edge but the clicked point is inside, the clicked point (whole mm) is used
- [ ] a hole that really does not fit is refused with the reason; the toast does not cover the panel
- [ ] after the centre, typing a number + Enter finishes the hole with that diameter; the hint fits the status bar; snap to the centre is off while sizing (B14 tester note)
- [ ] no second hole on the same centre
- [ ] if over half a day: the first two items
Tester focus: hinge cup at 22,5 mm at %18 and %100; typed diameter; refusal texts.

### T277 Rider: open lines stay inside their part; DXF on-line layers connect to T142   [status: done]
Spec: §4.6, §6.3, §7.2 · Depends: T142, T145
Found by the B15 tester: an open line (`part.lines`) from (100,100) to (600,100) on a 300 mm wide part exports without error and engraves 5 mm into the neighbour part. Only reachable through project JSON today; DXF on-line layers (pending in B16) will make it reachable.
Acceptance:
- [ ] validation error + toolpath backstop when any point of an open line (tool radius included) leaves its part outline; named like T270 ("Kapak · Çizgi 2: …")
- [ ] DXF layer operation "Çizgi üzerinden" is offered and imports open and closed contours as on-line operations with a depth (default 1 mm, < thickness); a line outside every part is reported, not imported
- [ ] on-line default depth on stock ≤ 1 mm: half the thickness, never a silent refusal; picker wide enough for "Çizgi üzerinden"; "Tabaka kalınlığı" shows mm
Tester focus: line crossing the outline by 0.1 mm; DXF sign with an engraved line; NC read-back depth.

### Batch B15: T141–T143 (more operations)

### T141 Toolpath: inner contours   [status: done]
Spec: §6.3, D-013 · Depends: T134, T139
Acceptance:
- [ ] inside offset for inners (SPLIT → export-blocking error, ARC_COLLAPSED warning), lead-in inside the waste side, multi-pass, tabs optional
- [ ] cut order verified with drawn parts having holes + inners
Tester focus: safety review; SPLIT case blocks the export in the UI; cut-order property test with inners.

### T142 On-line operation and per-contour operations   [status: done]
Spec: §4.6, §6.3 · Depends: T141
Acceptance:
- [ ] `setOperation(contour, 'outside' | 'inside' | 'online' | 'none', depth)`; on-line = tool centre on the line at depth (open contours allowed)
- [ ] properties panel shows the operation per contour; layer mapping (T145) feeds the same field
Tester focus: on-line open path G-code passes checks; depth never below thickness + allowance.

### T143 Thin-skin option for small parts   [status: done]
Spec: §2.4, §6.3 · Depends: T141
Acceptance:
- [ ] option "son pasoda ince tabaka bırak" (skin thickness): small parts keep a skin, a final cleanup pass after all parts removes it; tabs and skin are alternatives per project
Tester focus: safety review of the cleanup pass order (last); depth properties.

### Batch B16: T144–T146 (DXF import)

### T144 DXF reader wrapper and entity conversion   [status: done]
Spec: §4.6, §8.3 · Depends: T128
Acceptance:
- [ ] `dxf-parser` (licence verified, MIT) wrapped in core-compatible pure conversion: LINE, ARC, CIRCLE, LWPOLYLINE (bulge), POLYLINE, one-level INSERT; SPLINE/ELLIPSE approximated within tolerance; TEXT/MTEXT/DIMENSION/HATCH counted and ignored
- [ ] units from `$INSUNITS`; suspicious size → `UNIT_UNCERTAIN`
- [ ] fixtures incl. real messy files (`dxf-io` skill)
Tester focus: fixture report counts; arc direction preserved (bulge sign); spline deviation within tolerance.

### T145 DXF join, part recognition and layer mapping   [status: done]
Spec: §4.6 · Depends: T144
Acceptance:
- [ ] join ends within 0.05 mm into closed contours; unclosed ones flagged; outermost closed = part, inside = inner or hole (circles → hole object optional)
- [ ] layer → operation mapping, saved as a company setting; `importDxf` command (one undo step)
Tester focus: property test (random segment soup of a known shape rejoins); mapping persists per company.

### T146 DXF import dialog   [status: done]
Spec: §4.6 · Depends: T145
Acceptance:
- [ ] upload → preview canvas + report (supported / converted / ignored counts, open contours) → unit question when needed → layer mapping table → confirm
- [ ] DWG file → Turkish message "DXF olarak kaydedin"
- [ ] e2e: sign-letter DXF → nest → NC passes checks (half of the M5 exit)
Tester focus: e2e; size/type limits; visual + axe of the dialog.

### Batch B17: T147–T149 (templates core)

### T147 Template model and "save as template"   [status: done]
Spec: §4.7, §9.1 · Depends: T138
Acceptance:
- [ ] `templates` / `template_versions` tables (company-scoped, immutable versions); template = parametric group of holes/lines/grooves with params (diameter, edge distance, count, spacing)
- [ ] `saveAsTemplate` from the selection (admin role later; single user now)
Tester focus: tenancy test; version immutability; params validation.

### T148 Place template: ghost, snap, mirror, repeat   [status: done]
Spec: §4.7 · Depends: T147
Acceptance:
- [ ] "Şablon ekle" → ghost preview, snaps to edges/corners, typed edge distance, mirror (left/right door), rotate, equal-spaced repeat; `addTemplate`, `updateTemplateInstance`; the project stores a copy + version + overrides
Tester focus: e2e hinge on a door at 22.5 mm from the edge; mirrored door; undo.

### T149 Template update flow   [status: done]
Spec: §4.7 · Depends: T148
Acceptance:
- [ ] opening a project whose template has a newer version asks "Kullanılan … şablonu değişti. Güncellensin mi?"; yes = update (undoable), no = keep; overridden fields show a conflict warning
Tester focus: both answers; override conflict case; undo after update.

### Batch B18: T150–T151 + T272, rider T273 (template library; tabs on arcs)

### T150 Ready template library   [status: done]
Spec: §4.7, §14.2 · Depends: T148
Acceptance:
- [ ] seed: hinge cup Ø35 (2 and 3 hinges by door height), handle holes (96/128/160 mm), drawer rail holes; values marked "üretici verisiyle doğrulanacak" (open item §14.2)
- [ ] e2e: hinge-door project with template → nest → NC passes checks (other half of the M5 exit)
Tester focus: e2e; G-code safety review of pockets near the edge.

### T151 Şablonlar page   [status: done]
Spec: §3.4 · Depends: T150
Acceptance:
- [ ] list (company + ready library), preview thumbnail, edit params, version history, duplicate, archive
Tester focus: visual + axe; edit creates a new version; old projects unchanged.

### T272 Small all-arc parts can be secured with tabs (sign letters "O", discs)   [status: done]
Spec: §2.4, §6.3 · Depends: T015, T143 · Decision: D-049
Found by B16 (#80): a small part whose outline is only arcs (letter O, disc) gets no tabs, because outer-contour tabs are placed only on straight edges, so the export is blocked with `SMALL_PART_UNSECURED`. Sign shops hit this with DXF letters.
Acceptance:
- [ ] outer-contour tabs may sit on arcs (centre of the tab on the arc, tab length measured along the arc, clear of corners and joins); straight edges stay preferred when they exist
- [ ] a Ø60 disc and the letters of `sign-letters.dxf` at 1× size export with tabs and pass the checks; thin skin (T143) stays the alternative
- [ ] property test: every tab lies on the contour, its length within ± EPS, never on a corner; existing golden files byte-identical (or a new golden approved per D-051)
Tester focus: safety review of a tabbed disc NC (tab height, no gouge at tab edges); letters O, e, a.

### T273 Rider: tab placement edge case found by fast-check   [status: done]
Spec: §6.3 · Depends: T015
Found by the B16 tester: `packages/core/src/toolpath/tabs.test.ts:309` failed once in CI: two 20 × 20 parts, p1 `h = 20.00000000000001`, `r = 1e-6`, seed 858170589 → "tab not on a straight edge clear of the corners".
Acceptance:
- [ ] counter-example pinned as a regression test; root cause found (real placement bug at tiny corner radius vs. too aggressive generator) and fixed at the cause, explained in the PR
- [ ] the property passes 20 runs in a row with random seeds
Tester focus: none beyond CI.

---

### T280 Offset kernel precision at near-straight arcs   [status: done]
Spec: §6.1 · Depends: T013
Found 2026-11-19: `packages/core/src/geometry/offset.property.test.ts` fails with `FC_SEED=-536624909`: a near-straight arc (bulge −5e-8) gives a deviation of 0.00208 > EPS.
Acceptance:
- [ ] counter-example pinned as a regression test; root cause fixed in the kernel (treat |bulge| below a threshold as a line, or compute the sagitta stably), explained in the PR
- [ ] the property passes 20 runs in a row with random seeds; existing goldens byte-identical
Tester focus: none beyond CI.

## M6: 3D önizleme (exit: 360° preview with cutting playback; 300 parts within the perf budget; 2D fallback on weak devices)

three + @react-three/fiber + @react-three/drei (MIT), lazy-loaded, in `apps/web` only (core stays pure). Decision D-033.

### Batch B19: T152–T154 (3D foundation)

### T152 3D foundation, controls and fallback   [status: done]
Spec: §3.8 · Depends: T110
Acceptance:
- [ ] `Preview3D` lazy chunk (not in the initial bundle); WebGL2 capability check → fallback to the 2D view with a Turkish note
- [ ] orbit 360°, zoom, pan; view presets (Üst, İzometrik, Ön), reset; damping off with reduced motion; render on demand (no idle GPU use)
- [ ] table + sheet with real dimensions and thickness, shadows/lighting tasteful, works in light and dark UI
- [ ] studio look (Fable review #1): soft vertical gradient background from tokens (never pure black/white), ground grid that fades with distance, contact shadow under the sheet, neutral tone mapping, thin edge lines on parts for a technical-drawing feel; a **view cube** (Üst/Ön/Sağ + corners) in the top-right corner drives the presets; the first open eases from top view to isometric (≤ 400 ms, off with reduced motion)
- [ ] rendered inside the `canvas` slot of `WorkspaceLayout` (T197) with the same floating toolbar positions as the 2D views; a 2D/3D segmented switch in the canvas toolbar
Tester focus: fallback with WebGL disabled (Chromium flag); bundle analysis shows the 3D chunk is lazy; controls with mouse/touch.

### T153 Part geometry: extrusion, cutouts, holes, pockets   [status: done]
Spec: §3.8, §4.5 · Depends: T152
Acceptance:
- [ ] pure builder (web) from the project + layout: outlines extruded to thickness (arcs tessellated), inners and through holes as shape holes, blind pockets/grooves as recessed geometry (no CSG), cached per part shape
- [ ] identical parts share geometry (instancing); 300 parts ≤ 300 draw calls
- [ ] unit tests: vertex counts, hole count, bounding box = part bbox × thickness
Tester focus: compare 3D top view screenshot with the 2D layout (positions/rotations match); a 30°-rotated part.

### T154 Materials and grain texture   [status: done]
Spec: §3.6, §3.8 · Depends: T153
Acceptance:
- [ ] procedural textures generated in code (MDF, plywood, melamine colours, acrylic): no image downloads; grain stripes oriented by the sheet grain angle and each part's effective grain angle; edge bands coloured on banded edges
- [ ] "Basit mod": flat colours, no shadows
- [ ] materials are matte and slightly desaturated (no glossy "game" look); the tool and toolpath use the `sim-tool` / `sim-rapid` tokens so 2D and 3D share one colour language
Tester focus: screenshots at grain 0/30/90°; edge band visible; simple mode visibly cheaper (draw calls/fps).

### Batch B20: T155–T157 (interaction and playback)

### T155 Interaction: move sheet, select, explode, camera transition   [status: done]
Spec: §3.6, §3.8 · Depends: T154
Acceptance:
- [ ] drag the sheet on the table plane (view-only; never changes the layout or machine offset), snap back button
- [ ] hover/click a part → highlight + info card (number, name, size, grain); "ayır/kaldır" slider lifts parts from the sheet; hide waste toggle
- [ ] wizard "İleri" → smooth camera transition to top view (§3.6), skipped with reduced motion
Tester focus: moving the sheet does not change project JSON (assert); selection matches 2D numbering; reduced motion.

### T156 Toolpath overlay in 3D   [status: done]
Spec: §6.5, §3.8 · Depends: T153
Acceptance:
- [ ] overlay from the **read G-code** (same data as 2D simulation): rapids dashed above the sheet, cuts coloured by depth; toggle; 50k-segment program renders within budget
Tester focus: overlay comes from the reader (not the toolpath model) — code review; visual match with 2D simulation.

### T157 Cutting playback synced with simulation   [status: done]
Spec: §6.5, §3.8 · Depends: T156
Acceptance:
- [ ] shared player store (time, speed, line) drives both 2D simulation and 3D: tool + spindle model moves along the read path, cut kerf revealed progressively, parts lift slightly when their outer contour ends
- [ ] banner "Simülasyon air cut'ın yerine geçmez" also in 3D
Tester focus: scrubbing in 2D moves 3D to the same line; play to the end; perf during playback.

### Batch B21: T158–T161 (cabinet view, perf, integration)

### T158 Assembled cabinet preview   [status: done]
Spec: §3.8 (v3) · Depends: T122, T154
Acceptance:
- [ ] for parts generated by the cabinet generator: "Montaj görünümü" places them in box positions (sides, top, bottom, shelves, back, doors) using the generator's own layout data; non-cabinet parts are not shown
Tester focus: screenshot review of 2 cabinets; dimensions match the generator.

### T159 Performance budget and simple mode   [status: done]
Spec: §3.6, §3.8 · Depends: T157
Acceptance:
- [ ] budget on the CI reference (mid laptop profile): 300 parts ≥ 45 fps orbiting, first frame ≤ 1.5 s after chunk load, GPU memory stable over 2 min
- [ ] automatic simple mode when fps < 30 for 3 s or no WebGL2; manual setting; DPR capped at 2
Tester focus: perf run with 300 and 600 parts; forced low-fps triggers simple mode; memory over time.

### T160 3D in the wizard and PNG export   [status: done]
PO note (B21 #105, 2026-11-20): no 3D on the Parçalar step (it has no right preview panel since T246/T253); 3D is on Plaka, Dizilim and Önizleme. 45 fps orbit budget asserted only with `PERF_BUDGET=1` (headless CI renders on the CPU, ~20–24 fps at 300 parts).
Spec: §3.6 · Depends: T155
Acceptance:
- [ ] wizard right panel: 2D / 3D toggle in sheet, parts and layout steps (live update after commands); "Görüntü kaydet" PNG
Tester focus: switching steps keeps camera; live update after an edit; visual both themes.

### T161 3D test suite   [status: done]
Spec: §11 · Depends: T159, T160
Acceptance:
- [ ] Playwright with SwiftShader: 3D screenshots of fixtures (top + iso), fallback path, playback to end; axe on the 3D controls
Tester focus: run suite twice → stable screenshots; review all images.

---


### Batch B20a: T282, T283 + rider T281 (CTO review #8 must-fixes, D-047)
Review: `docs/reviews/2026-11-20-cto-design-review-8.md` §"Şimdi düzelt" A and B (full acceptance text there; the lines below are the contract).

### T282 Unverified ready-template values reach the checklist, summary, panel and G-code (must-fix: wrong output risk)   [status: done]
Spec: §4.7, §7.2, §14.2 · Depends: T150, T151 · Decision: K2 in review #8
Acceptance:
- [ ] a project with an instance of an unverified ready template gets its own Dışa aktar checklist line ("Hazır şablon ölçüleri doğrulanmadı: … Ölçüleri kendi menteşe / kulp verinizle karşılaştırdım."); İndir stays closed until it is ticked. Company templates (or ready ones copied and edited) add no line
- [ ] the Simülasyon summary shows the same as one yellow line (Z-sıfırla pattern); the properties panel shows a "Doğrulanacak" badge on the instance header
- [ ] the G-code header gets one ASCII comment `(SABLON DOGRULANMADI: ...)` only when such an instance exists; every other file and all goldens byte-identical (a new golden needs PO + tester approval, D-051)
- [ ] if over half a day: checklist + summary now, badge + comment as a follow-up task
Tester focus: ready-template door (line, İndir closed), company-template door (no line), cabinet without templates (unchanged); comment in the downloaded file; 1440 light/dark; axe.

### T283 Project name: typing replaces the default name, never appends (must-fix: wrong file name on every job)   [status: done]
Spec: §3.6, §6.4 · Depends: none
Acceptance:
- [ ] while the name is the default ("Adsız proje"), click / focus / pencil selects the whole text; the first typed character replaces it. A user-set name keeps today's caret behaviour
- [ ] walkthrough 1 path (Yeni proje → click name → "Mutfak alt dolap 60") gives `Mutfak_alt_dolap_60_S1.tap` with no extra click
- [ ] e2e: click and type; Esc keeps the old name; undo
Tester focus: new project, renaming an existing one, undo; 1440 + 390 smoke.

### T285 Assembled cabinet preview shows holes, pockets and template instances on the parts   [status: done]
Spec: §3.8 · Depends: T158, T153
Found by the owner (2026-11-20): a generated cabinet with hinge holes drawn on the doors; the holes do not show in "Montaj görünümü" (the flat 3D preview of T153 does show cutouts/holes/pockets).
Acceptance:
- [ ] assembly boxes use the same part geometry as T153 (outline extrusion with inner cutouts, through holes, blind holes and pockets at depth, template instances), placed on the correct face after the assembly transform (door inside face for hinge cups, mirrored doors correct)
- [ ] the see-through door (B21) stays readable: holes visible through the door outline (see the B21b polish note on door opacity)
- [ ] perf: 300-part budget of T159 still met; unit test on the transform of a hole onto the assembled face
Tester focus: hinge door with a ready template (left and right door), shelf with drilled rows; 1440 light/dark.
## M7: Dizilim yükseltmeleri (exit: 3 modes, true-shape nesting with rotation, offcuts, edge-band deduction)

### Batch B22: T162–T164 (modes and options)

### T162 Nesting modes and objective weights   [status: done]
Spec: §6.2 · Depends: T114
Acceptance:
- [ ] `setNestingMode`: minWaste / fastest (cut length λ) / minToolChanges (μ); one objective function with weights per mode; cut length estimated from the toolpath model
- [ ] benchmarks per mode in `__bench__`; deterministic
Tester focus: each mode wins its own metric on the benchmark set; property tests unchanged.

### T163 Nesting options UI, worker progress and cancel   [status: done]
Spec: §3.6, §6.2 · Depends: T162
Acceptance:
- [ ] layout step panel: mode cards, gap, margin, offcut use, rotation policy; run in worker with progress and "İptal"; results kept per option set
Tester focus: cancel leaves the old layout intact; UI never freezes (long task < 50 ms) with 500 parts.

### T164 Multiple stock sheet sizes   [status: done]
Spec: §6.2 · Depends: T121, T162
Acceptance:
- [ ] stock = list of sheet sizes with quantity limits (from the material library); placer picks sizes to minimise the objective; report per size
Tester focus: quantity limit respected; property tests across mixed sizes.

### Batch B23: T165–T167 (true-shape nesting)

### T165 True-shape engine I: footprints and collision   [status: done]
Spec: §6.2 (v3) · Depends: T113 · Decision: D-034
Acceptance:
- [ ] footprint = outline offset by tool radius + gap/2 (own offset), arcs discretised for collision only (cutting geometry stays exact)
- [ ] deterministic bottom-left placement over candidate positions with exact polygon overlap tests (spatial index); inside sheet minus margin
- [ ] fast-check: no overlap of footprints, inside the sheet, deterministic
Tester focus: property tests; exact overlap re-check with a different algorithm in the test.

### T166 True-shape engine II: rotations and part-in-hole   [status: done]
Spec: §6.2 · Depends: T165
Acceptance:
- [ ] rotation candidates from `allowedRotations` (grain) plus a free-part step policy (90° default, 45°/15° options); optional small parts inside large inner cutouts
- [ ] grain rule property: fixed parts only at grain-aligned angles
Tester focus: grain property tests; part-in-hole never overlaps the hole's toolpath zone.

### T167 Engine selection and utilisation benchmark   [status: done]
Spec: §6.2 · Depends: T166
Acceptance:
- [ ] rectangles at axis angles → MaxRects; freeform or non-axis grain parts → true-shape (mixed jobs: true-shape for all); time budget 300 parts ≤ 10 s in the worker
- [ ] benchmark: utilisation gain vs the rotated-bbox fallback reported in the PR
Tester focus: time budget; utilisation numbers; deterministic re-run.

### Batch B24: T168–T171 (offcuts, edge band, layout editing)

### T168 Offcut stock   [status: done]
Spec: §2.4, §3.4, §6.2, §9.1 · Depends: T164
Acceptance:
- [ ] after nesting, rectangular leftovers ≥ 300×300 (setting) proposed; user confirms → `offcuts` row (material, thickness, size, grain, source project); next nesting of the same material/thickness tries offcuts first; "Artık parçalar" tab under Projeler
Tester focus: offcut used first in the next project; status changes to used; tenancy test.

### T169 Edge band deduction   [status: done]
Spec: §4.8 · Depends: T119
Acceptance:
- [ ] project setting "girilen ölçü bitmiş ölçü": cut size = finish − band thickness per edge; shown in the grid (finish and cut size) and used by nesting/toolpath
Tester focus: dimensions hand-checked for all edge combinations; toggle is undoable.

### T170 Layout editing upgrades   [status: done]
Spec: §6.2 · Depends: T166
Acceptance:
- [ ] rotate a dragged part through its allowed angles (R key), snap to neighbours at gap distance, multi-select lock/unlock, "kilitsizleri yeniden diz"
- [ ] invalid drops still never committed (`LOCKED_PLACEMENT_INVALID`)
Tester focus: a fixed-grain part cannot be rotated off-grain by the UI; drag e2e.

### T171 Layout view polish: numbers, stats, legend   [status: done]
Spec: §2.4, §6.5 · Depends: T170
Acceptance:
- [ ] part numbers consistent with PDF/labels, per-sheet stats (parts, utilisation, cut length), legend, minimap for many sheets (labels, dimensions and the utilisation bar already come from T196; this task adds the rest)
Tester focus: numbering consistent across layout, simulation, 3D; visual.

---



### T284 Tabs on the corner arcs of a rounded rectangle: decide and align product + safety oracle (must-fix: G-code safety, flaky on main)   [status: done]
Spec: §6.3 · Depends: T272 · Decision: D-058
Found 2026-11-20 in integration/7 CI (main code from B18): `packages/core/src/toolpath/toolpath.tabs.safety.test.ts:377` fails with `seed: 721042798`, counter-example 20 × 20 part, corner radius 7.5 (rFrac 0.75), tool Ø3, tab width 2, 1 tab: the tab sits on a corner arc ("tab top move kind arc", "tab chord crosses a corner zone").
D-058 says a tab may sit on one arc only when no straight edge fits and "never on a corner". A corner arc of a rounded rectangle is ambiguous: decide (PO; owner if unclear) whether it counts as a corner. Conservative default: no tab on a corner arc whose sweep is ≤ 90° between two straight edges; such a small part then gets `SMALL_PART_UNSECURED` (thin skin T143 stays the alternative), as before T272.
Acceptance:
- [ ] the counter-example pinned as a regression test; product and the independent safety oracle agree on the rule (no weakened oracle)
- [ ] Ø60 disc and `sign-letters.dxf` still export with tabs (T272 unchanged for all-arc parts); goldens byte-identical
- [ ] the property passes 20 runs with random seeds
Tester focus: gcode-safety review of the rule; rounded rectangles of several radii.
### T281 Nesting run/cancel with 1500 copies stays under 50 ms per main-thread task   [status: done]
Spec: §11 · Depends: T163
Found in integration/3 (2026-11-20): CI saw long tasks of 50–68 ms on run/cancel with 1500 copies (T163's own bar is < 50 ms with 500 parts, met). The spec `b22-nesting-options.spec.ts` allows 100 ms for now.
Progress (B20a #103, 2026-11-20): canvas onDrop identity fixed, 0 long tasks at 2× CPU throttle; at 3× the whole wizard tree re-renders (setRunning, autosave after a mode click) → 52–104 ms. Remaining: memo boundaries on the wizard/step subtrees, then restore the 50 ms bar.
Acceptance:
- [ ] profile run/cancel at 1500 copies (CPU-throttled), split or defer the main-thread work; restore the 50 ms bar in the spec
Tester focus: none beyond CI.

### T286 Handle template is not placed on the hinge edge (must-fix: wrong output; CTO review #9 A)   [status: done]
Spec: §4.7 · Depends: T148, T150 · Review: `docs/reviews/2026-11-20-cto-design-review-9.md` §"Şimdi düzelt" A
Found: "Yerleştir" from the panel puts both a hinge and a handle template on the left edge; the handle holes land on the hinge side (X 30), every check passes, the door is scrap.
Acceptance:
- [ ] by default a handle template goes to the edge opposite the door's hinge edge (left hinges → right handle; mirrored door mirrored)
- [ ] placing a handle on the hinge edge by hand shows a non-blocking warning at the instance ("Kulp menteşe kenarında") and a line in the Dışa aktar checklist; no silent pass
- [ ] unit test for the default edge; e2e: hinge + handle via the panel → handle on the opposite edge; G-code goldens byte-identical
Tester focus: left/right doors, mirrored placement, manual move onto the hinge edge.
## M8: Export, etiket, proje yönetimi (exit: NC, DXF, PDF and labels from the server; projects, home and settings complete)   [status: closed 2026-11-21]

### Batch B25: T172–T174 (PDF)

### T172 PDF engine and layout pages   [status: done]
Spec: §6.6, §8.3 · Depends: T171
Acceptance:
- [ ] pdf-lib + embedded Turkish-capable font (OFL); A4/A3 landscape sheet pages with numbered parts, grain arrows, dimensions; generated on the server from the saved revision; deterministic bytes (fixed metadata dates)
Tester focus: Turkish characters (ğüşıöç İ) render; same input → same hash; page count = sheets.

### T173 PDF part list, edge bands, waste report   [status: done]
Spec: §6.6, §4.8 · Depends: T172
Acceptance:
- [ ] numbered part list (name, finish/cut size, qty, grain, banded edges marked), waste % and area, sheet count, estimated cut time
Tester focus: numbers vs layout data; banded edge marks for all 4 edges.

### T174 Part labels   [status: done]
Spec: §2.4, §6.6 · Depends: T172
Acceptance:
- [ ] label sheet presets (A4 3×8, 2×7, custom mm grid); label: project, part number, name, size, grain arrow, edge band glyph, sheet number; print offset calibration setting
Tester focus: label count = total pieces; print preview screenshot; long names truncated, not overflowing.

### Batch B26: T175–T177 (DXF export, export step, report)

### T175 DXF writer   [status: done]
Spec: §6.6, §4.6 · Depends: T145
Acceptance:
- [x] own writer: layout (sheets side by side) and single parts; layers per operation (DIS_KESIM, IC_KESIM, CEP, DELIK, CIZGI); arcs as bulges; round-trip test with our importer (= same contours within EPS)
Tester focus: round trip; opens in a free viewer (LibreCAD) without errors (manual screenshot).

### T176 Export step: all formats, records, history   [status: done]
Spec: §6.6 · Depends: T173, T174, T175
> Note from CTO review #4 (2026-11-19): at 1440 the left column is half empty while the right one scrolls and the history table is below the fold; when this step is rebuilt, balance the two columns so the history is visible without scrolling.
Acceptance:
- [x] export step offers NC, DXF, PDF, labels; each regenerated on the server and stored in `exports` with type, hash, revision; history shows all types; NC rules unchanged (checks, acceptance)
- [x] (CTO #10 E4) more than one file: "Tümünü indir (.zip)" in one click (same names and bytes as single downloads), `OKU.txt` maps sheet → file; single downloads stay
Tester focus: NC gate cannot be bypassed by the new UI; hashes stable; history entries per type.

### T177 Project report card   [status: done]
Spec: §6.6 · Depends: T176
Acceptance:
- [x] report summary (waste %, area, sheets, estimated time, part count) on the project page and as data for the home page
Tester focus: values equal the PDF report values.

### Batch B27: T178–T180 (projects and home)

### T178 Projeler page: search, filter, copy, delete   [status: done]
Owner (2026-11-20): looked for delete on Projeler and found none; **pull the delete part forward** (next free batch), copy/search/filter can stay in M8.
Progress (B24 #113, 2026-11-20): soft delete + Geri al done (migration 0007 `projects.deleted_at`, tenant-scoped PATCH). Left for M8: copy, search, filter, sort, pagination, a "Silinenler" list, and blocking a deleted project's direct link. Rest landed in B35 (#127).
Spec: §3.4 · Depends: T111
Acceptance:
- [x] table with name, status, machine, material, date; search (Turkish folding), filters (status, machine, material), sort, pagination; copy project (new id, revision 1, exports not copied); soft delete with undo toast
Tester focus: e2e search/filter/copy; deleted project hidden but restorable; tenancy unchanged.

### T179 Project status flow and re-export   [status: done]
Spec: §3.4, §6.6 · Depends: T176, T178
Acceptance:
- [x] taslak → üretildi (after a successful NC export) → tamamlandı (manual); re-export from history regenerates from that revision
- [x] (CTO #10 E6, D-060) the export record stores the machine verification state; re-export with the same state gives the same bytes; if the state changed, a new record "doğrulama durumu değişti" is added instead of overwriting
Tester focus: status transitions; re-export of an old revision gives the same hash as before.

### T180 Ana sayfa with real data   [status: done]
Spec: §3.4 · Depends: T177, T178 · Decision: D-070 (B39)
Acceptance:
- [x] recent projects, machines needing verification, waste summary chart (last 30 days, accessible colours), quick actions
- [x] project cards use a larger layout thumbnail (16:10, sheet with material tint and part outlines, plate count as stacked sheets) or the 3D PNG from T160 when one exists (no stored PNG exists, D-070)
Tester focus: numbers match seeded data; chart readable in dark mode; axe.

### Batch B28: T181–T183 (machines and settings)

### T181 Machine maintenance and controller library   [status: done]
Spec: §3.4, §7.1 · Depends: T107
Acceptance:
- [ ] manual maintenance log (last date, interval days, note) with reminder badge on Makineler and Ana sayfa; controller-family library pre-fills a new profile (generic, Mach3)
Tester focus: reminder appears when overdue (fixed clock in test); pre-fill values match the post configs.

### T182 Ayarlar: company, defaults, layer mapping   [status: done]
Spec: §3.4 · Depends: T121, T145
Acceptance:
- [ ] company name + logo upload (size/type limits), defaults (gap, margin, tabs, lead-in, edge-band mode), DXF layer mapping editor, material defaults link
Tester focus: defaults used by a new project; upload limits; axe.

### T183 Ayarlar: appearance and preferences   [status: done]
Spec: §3.7 · Depends: T182
Acceptance:
- [ ] theme, density (comfortable/compact; the compact tokens exist since T195, this adds the user setting), 3D simple mode, reduced motion override, shortcuts list
Tester focus: preferences persist and apply on reload; compact density screenshots.

---

## CTO review #10 follow-ups (2026-11-20, D-047; review `docs/reviews/2026-11-20-cto-design-review-10.md`)

### Batch B33: T287–T289 (must-fix A + gaps E1, E2; runs now on Dev 2, parallel with B32)

### T287 Unplaced part: no green check on Simülasyon, named lock on Dışa aktar   [status: done]
Must-fix A (CTO #10). Spec: §3.6, §6.5, §7.2
Acceptance:
- [ ] a part that is not in the layout (does not fit, or added after nesting) means the Simülasyon summary never shows "Tüm kontroller geçti"; it shows "1 kontrol geçmedi" with the part name, open; same result source as Dışa aktar (K2)
- [ ] Dışa aktar "Geçmeyen kontroller" names the part ("Satır 2 · Tezgah: plakaya sığmıyor") and "Parçalara git" focuses that row
- [ ] Dizilim shows the unplaced count above the canvas without scrolling (chip next to the sheet tabs); "İleri" not blocked
- [ ] goldens unchanged; NC lock never relaxed
Tester focus: oversize part, part added after nesting, deleting it turns all three steps green; 1440 light/dark; axe.

### T288 Cutting settings UI: tabs, lead-in, direction   [status: done]
Gap E1 (CTO #10). Spec: §6.3, §7.2 · gcode-safety review
Acceptance:
- [ ] Simülasyon left panel "Kesim ayarları": tabs (all parts / small parts only / off), count, width, height; lead-in (arc / line); direction (climb / conventional)
- [ ] every change is a command (undoable); preview and tab count update at once; the server export uses the same values; the file header shows them
- [ ] with tabs off, the small-part safety rule (§6.3, §7.2) still forces tabs or thin skin
- [ ] goldens unchanged for default values; any new golden verified per D-051
Tester focus: gcode-safety checklist on each option; undo; export equals preview.

### T289 Machine archive   [status: done]
Gap E2 (CTO #10). Spec: §3.4 · Depends: T107
Acceptance:
- [ ] archive a machine (soft delete, "Geri al" toast), also the sample machine; tenant-scoped API
- [ ] archived machine cannot be picked for a new project; old projects using it still open, old exports stay
- [ ] Ana sayfa counts ignore archived machines
Tester focus: archive/undo, new-project picker, old project opens; tenancy.

### Batch B34: T290–T292 (project flow follow-ups; after B27)

### T290 Project opens at the step where work stopped   [status: done]
Gap E5 (CTO #10). Spec: §3.4
Acceptance:
- [x] "Aç" opens the step after the last completed one (layout → Dizilim, export → Dışa aktar); `?adim=` in the URL wins; Çizim / Liste view remembered

### T291 Offcut stock: manual add, edit, delete   [status: done]
Gap E3 (CTO #10); owner 2026-11-20: manual add in scope (Q011). Spec: §6.2
Acceptance:
- [ ] "Artık parça ekle" (material, thickness, width, length, grain); edit and delete a stock offcut (with "Geri al"); tab kept in the URL (`?sekme=artik`)

### T292 Other-thickness parts to a new project   [status: done]
Gap E7 (CTO #10); owner 2026-11-20: before the field test (Q011).
Acceptance:
- [ ] cabinet dialog / cut list: "Ayrı plaka parçalarını yeni projeye aktar" → new project with the same machine, the chosen material/thickness, parts filled in; the source project links to it; multi-material inside one project stays out of scope
Tester focus: parts and sizes equal the excluded ones; both projects nest and export.

## CTO review #11 follow-ups (2026-11-20, D-047; review `docs/reviews/2026-11-20-cto-design-review-11.md`)

### Batch B40: T293 + T294 (must-fix A + gap E1; Dev 2, before the rest of B38)

### T293 Tab size lower bounds   [status: done]
Must-fix A (CTO #11), safety. Spec: §6.3, §7.2 · Depends: T288 · gcode-safety review
Acceptance: as in review #11 section A: `setTabs` refuses width < 3 mm and height < 1 mm or > thickness − 1 mm (numbers in DECISIONS, tuned in the field test); the validator flags a small part held only by under-size tabs (old or hand-edited projects too) on Simülasyon and Dışa aktar, NC blocked; a tab that does not fit names the reason and links to Kesim ayarları; goldens unchanged for defaults. T182 company defaults use the same bounds.

### T294 Cutting settings: no hidden state, clear wording   [status: done]
Gap E1 (CTO #11). Spec: §6.3
Acceptance: as in review #11 section E1: "Kapalı → Her parçada" returns to the start state or the panel shows the thin skin the panel switched on; "Adet" says per part and the header matches the real count on small parts; the card is reachable at 1440 × 900 without scrolling the page (or a link from the summary); a one-line hint for climb / conventional.

### T295 One file-name pattern for all exports   [status: done]
CTO #11 (T176 gap). Rides with the next Dev 1 batch after B39.
Acceptance: NC, DXF, PDF and labels share one pattern (project, revision, kind, sheet), ASCII; history and zip use it.

### T296 Old-revision file is marked   [status: done]
CTO #11 (T179 gap). Rides with T295.
Acceptance: Projeler "İndir" and the history show an "eski revizyon" badge when the last file is from an older revision than the project; one click to regenerate.

### T297 Main NC export needs the checklist confirmation on the server   [status: done]
PO decision D-072 (tester note on B37, model D-071). Spec: §7.2 · gcode-safety review
Acceptance: `POST /api/projects/:id/export` without `checklistConfirmed: true` answers 428 `checklist_required` with the checklist data and stores nothing; a non-boolean is 400; the acceptance stays a separate 428; the export step sends the confirmation only after the checklist is done; tests that call the API directly send it; goldens unchanged.

## CTO review #12 follow-ups (2026-11-20, D-047; review `docs/reviews/2026-11-20-cto-design-review-12.md`)

M8 exit (CTO #12): closes when B41 (#139) lands and T298 + T301 are done.

**M8 closed 2026-11-21:** B41 landed in #144, T298 in #154, T301 in B48 (#148, integration/22).

### Batch B47: T298–T300 (must-fix A, B + gap E1; Dev 2, before polish P3)

### T298 Thin-skin thickness bounds   [status: done]
Must-fix A (CTO #12), safety; the other arm of T293. Spec: §6.3, §7.2 · gcode-safety review
Acceptance: as review #12 section A: the step-1 field, the command and the validator refuse a skin below a minimum (PO proposal: ≥ 0,2 mm and ≤ thickness − 1 mm; numbers in DECISIONS, tuned in the field test); old / hand-edited projects are caught (NC blocked, finding named, link to the field); goldens unchanged for defaults.

### T299 Simülasyon scrolls when checks fail; "Kesim ayarlarına git" keeps the layout   [status: done]
Must-fix B (CTO #12). Acceptance: as review #12 section B: the step content scrolls (no `overflow: hidden` trap) with 4+ findings at 1440 × 900 and 1024; the link scrolls the card into view without moving the footer over the fields.

### T300 Too-small edge margin is caught at Dizilim, not as a machine error   [status: done]
Gap E1 (CTO #12), D-045. Acceptance: as review #12 E1: Dizilim warns when margin + lead-in does not fit the tool, before Simülasyon; the Simülasyon finding points to the margin setting, not to Makineler.

### Batch B48: T301–T303 (M8 exit gap E2, gap E3, export follow-ups; Dev 1 after B42)

### T301 Company name and logo are used   [status: done]
Gap E2 (CTO #12); needed to close M8. Acceptance: the sidebar shows the company name (not "Atölyem"); PDF pages and labels carry name and logo (deterministic bytes kept: same logo, same hash).

### T302 Tab default in the material parameters   [status: done]
Gap E3 (CTO #12). Acceptance: the material parameter set has tab count / width / height fields with the T293 bounds; the three screens that point there land on them.

### T303 Export follow-ups   [status: done]
CTO #12 on T295 / T296. Acceptance: the NC file name respects the machine file-name length limit (post config; shorten the project part, keep revision and sheet); a project changed after "üretildi" shows that the last file is older (status or badge), not a silent "üretildi".

### T304 2 000-row paste without a frozen page (rider)   [status: done]
B42 perf budget (D-079): pasting / applying 2 000 cut-list rows blocks the main thread ~8–9 s, while core import + validation take < 50 ms, so the cost is in the React render path. Acceptance: batch / defer / virtualise so that no single main-thread task exceeds 200 ms and the whole apply takes < 2 s locally; the 20 s guard in the perf spec is tightened to these numbers.

### T306 Nesting positions without nudge residue   [status: todo]
Spec: §6.2 · From: CTO #8, B51 (D-091)
The true-shape placer starts candidates 1e-4 mm off a neighbour (`nesting/trueshape.ts`, `NUDGE`), so positions such as 522.0001 reach the 4-decimal Mach3 output (`X522.0001`, `Y117.9999`). Acceptance:
- [ ] placements carry no residue near the 0.001 mm grid (e.g. a clean candidate grid, or a final tidy pass over finished sheets that never creates an overlap)
- [ ] interlock results (sheet counts) and determinism unchanged; real 4th decimals of rotated shapes untouched
- [ ] goldens regenerated with the per-file reason; no post-side rounding change
Tester focus: true-shape and arc-tabs goldens read back clean; nesting property tests.

## Mobile UI pass (D-043; one or two batches, scheduled by the PO before the field test, at the latest in M9)

Until then the product is **desktop-first**: at phone widths screens only must not break (no page-level horizontal scroll, no hidden primary action, no crash, axe clean). Phone-specific polish collects here.


### T307 Spindle speed (devir) editable per project   [status: done, B54]
Spec: §4.x / §7 "Malzeme = parametre seti", "Kesim parametreleri … varsayılanlar malzeme parametre setinden" · From: owner request 2026-11-21, before the field test (M9) · D-098
Acceptance:
- [x] default = the material set rpm of the job; per-tool override as an undoable command stored in the project; "Önerilene dön"
- [x] S word + "DEVİR" header line use the override; server export the same; out-of-range refused by command, validation, toolpath, post
- [x] Simülasyon "Kesim ayarları": slider + typed field, recommended tick, ±20 % band, warning line, chip load, keyboard + screen reader
- [x] goldens unchanged without an override
Tester focus: gcode-safety (S within range, M3 + dwell before cutting), keyboard on the slider, undo, old project with an out-of-range value.

### T308 Cutting tool per operation, per job   [status: done, B54]
From: PO 2026-11-21 (after T307) · D-099
Today the outer/inner contour tool comes from the material set (`set.tool`), hole/pocket tools from the operation; the user cannot change them per job. Acceptance:
- [x] in "Kesim ayarları" next to the T307 rows: one tool picker per operation (dış kontur, iç kontur, cep, delik); only suitable types (contour/pocket: flat end mill + compression; hole: drill + flat end mill) and diameters that pass the existing rules (inner corner / slot width)
- [x] default = today's choice; "Önerilene dön"; an undoable command; the server export uses it; goldens unchanged by default
- [x] a changed tool takes its spindle recommendation (T307) from that tool's set

### T248 Phone cut list: compact cards, one-row toolbar (moved here; text above in B8a)   [status: done]

### T255 Phone Simülasyon transport visible, short header label   [status: done]
Spec: §3.7 · Depends: T249 · Decision: D-043
Acceptance:
- [ ] the T249 phone bullet: below 640 px the whole transport (scrubber, time, speed chips, position line) is visible above the "Ayarlar / G-code" button bar; the wizard header shows the short label "Simülasyon" below 640 px
Tester focus: bounding boxes at 390 × 844 and 360 × 740; play/pause e2e green.

### Notes for the mobile pass from CTO review #4 (2026-11-19; no task numbers yet, the PO writes them when the pass is scheduled)
- "Dolap ekle" dialog at 390: the "Çift kapak" radio label runs under the "Kapak boşluğu" field; labels wrap to two and three lines. Stack the door row and the gap field.
- Ayarlar → Malzemeler cards at 390: the "Kesim ayarı" chip is cut after the machine name ("Örnek router (Mach3):…"); the status itself is not readable (T257 shortens the chip text; check it here).
- Smoke result at 390 × 844: no page-level horizontal scroll on home, Malzemeler, steps 1–5 and the cabinet dialog; "İleri" / "İndir" reachable on every step.
- CTO review #5 (2026-11-19) smoke at 390 × 844: no page-level horizontal scroll on home, step 1, the board, the cut list, the cabinet dialog, Malzemeler and the machine form; "İleri" reachable. For the pass: the machine form's "Malzeme parametreleri" table needs a card layout on phones (7 columns behind a horizontal scroll).

## Polish queue (M9; D-047)

Cleaned up 2026-11-20 (owner): duplicates merged, done items removed, grouped by screen. Source in brackets (#5 = CTO review 5, T = tester). The M9 polish phase takes **one group per batch** (P1–P5), not item by item; inside a group the dev may skip an item that costs more than an hour and note it. Items marked ★ were seen in 2+ reviews: do them first.

### P1 Çizim tahtası   [status: partial, B50 #153, B52 #156]
Done in B50 (#153, D-090), B52 (#156, D-096) or already on main; the rest stays open.
- Add a corner / split an edge on a shape (L or notch without redrawing) [#5] (done in B50)
- Zoom to selection; picked corner shown on canvas [#5] (done in B50; picked corner already on main)
- Corner X/Y part-relative or whole mm; stable corner numbers (needs a decision) [#5] (done in B52)
- Line tool: take the direction from arrow keys / mouse when only a length is typed; "keep right angles" when editing an edge of an orthogonal shape [#5] (done in B52)
- ★ Labels: part label inside the shape (L parts), edge-length labels do not overlap on small parts [#5, #6] (done in B50)
- Selection keeps the wood tone (outline only); small part: corner handle wins over the edge handle [#5, #7] (done in B50)
- Tool rail keeps a canvas inset at 1024 (not reproduced in B50) [#5, #7]
- "İç kesim olarak ekle?" dialog fits, Enter works [#6] (done in B50)
- Inner cut: select, move, resize after it is added; asked once (needs a product rule) [#6] (done in B52)
- Holes: number on the canvas; blind vs through look different; hole tool takes a diameter like the circle (one convention) [#7] (done in B50; typed diameter already on main)
- Holes: select and drag on the canvas; "continue with the same values" [#7] (done in B52)
- Hole snapping: finer snap near hinge positions (22,5 mm) [T B14a] (already on main, B14a)
- Hole snapping: no centre snap when zoomed out [T B14] (done in B52)
- ★ Properties panel: holes and template instances as collapsed summary rows (panel is 1.500–2.500 px today) [#7, #8] (done in B50)
- Right-click menu: duplicate, delete, rotate, add template [#10] (done in B52)
- Hints and tour: hint texts not cut (Delik, Seç, Kaydır), shortcut sheet lists Alt, tour explains hole properties and does not cover the board/toolbar [#7, T B13] (done in B50; tour position already on main)
- Contour pocket (T325): a hole placed on the pocket floor gives a misleading `HOLE_OUTSIDE_PART` message [T325 tester]
- Contour pocket (T325): a pocket the tool would split in two is reported as too narrow (`POCKET_TOO_SMALL`) instead of split [T325 tester]

### P2 Dizilim, Simülasyon, 3D   [status: partial, B44 #145]
Done in B44 (#145) except the two items left open below.
- ★ "Fit to job" as the default view on small jobs (2D and 3D), sheet on "Tümünü göster" [#5, #8, #9, #10] (done in B44)
- ★ Inner cuts read as holes (not part fill), labels not over openings or other parts; mirrored left/right doors distinguishable, template instances drawn [#6, #8, #9] (done in B44)
- ★ Feedback when an option gains nothing (true shape 45°/15°, part-in-hole: "iç boşluğa 0 parça"); mode cards show path and tool-change count [#8, #9, #10] (done in B44)
- Mode cards: "En hızlı" card shows the time [#8, #9, #10]
- Dizilim Ayarlar panel: compact so "Diz" does not move; no half row at the top; "Diz" progress shows "Diziliyor… %40 · İptal" [#8, #9] (done in B44)
- Simülasyon: toolbar not clipped (3D at 1440) and not over the table frame; "Köprü sayısı azaltıldı" names the part [#6, #7, #8] (done in B44)
- Simülasyon: hole operations note the tool's rpm/plunge [#10]
- ★ Assembly 3D: first camera fits the whole cabinet; door opacity / outline so it reads closed; hinge cups visible [T B21b, #9, #10] (done in B44)
- Console: THREE.Clock deprecated warning on every 3D open (use THREE.Timer) [#10] (done in B44)
- Kesim ayarları card: tab options as one segmented row, three fields in one row; a field with a refused value shows the value in use ("kullanılan: 4") [#11] (done in B44)
- Özet cutting-settings line wraps to two lines at 232 px and also names the thin skin; Özet warning count equals the Uyarılar panel; Dizilim says the part gap is added to the tool diameter [#12] (done in B44)
- Phone: Simülasyon 3rd sheet tab cut at 390 (scrollable) [T B43] (done in B44)
- Dizilim canvas: a rotated part's label shows the part's own En × Boy, like the right panel (PO decision, usta 2 test 2026-11-21) [usta] (done in B53)

### P3 Kesim listesi, adım 1, makine formu, DXF   [status: done, B46 #150, B53 #160]
Done in B46 (#150) and B53 (#160), except the flaky-e2e note (watch item).
- Cut list: edge band unit "mm"; a name-only row is not counted in the part total; cabinet toast and button use the same unit [#9, #10] (done in B46)
- Cut list: "Uyarılar" panel does not cover cells, clicking an issue focuses its row; row marker for parts with inner cuts [#5, #6] (done in B53)
- Paste: skipped rows (e.g. size 0) are named with the reason in the preview [#10] (done in B46)
- Step 1: thickness row only when there is a choice [#5] (done in B46)
- Step 1: red "kesim ayarı yok" box does not push "Plaka ölçüsü" under the footer [#5] (done in B53)
- ★ Machine form and Ayarlar → Malzemeler: parameter table fits 1440 and 1024 without horizontal scroll; copied-set note spans the row; from the fix flow the section nav and breadcrumb are right and "Değerleri doğruladım" is not under the sticky bar; "Projeye dön" back to the project [#5, #6, #7] (done in B53)
- Wizard header stays one row down to ~1095 px container width [#6] (done in B53)
- DXF dialog: focus returns to "DXF içe aktar"; duplicate `data-testid="dxf-open"` [T B16] (done in B46)
- DXF dialog: first focus visible; a LINE over a closed polyline edge counts as duplicate; report shows holes separately [T B16] (done in B53)
- Step 1 "ince tabaka" switch and Simülasyon "Köprü: Kapalı" use the same word and link to each other [#11] (done in B46)
- Server accepts a grain value on a grainless offcut PATCH [T B36] (done in B46)
- T292 rows get a stray thickness note when the target thickness differs [T B36] (done in B53)
- Out-of-range fields say the limit (Ayarlar defaults, offcut dialog) instead of a silent disabled Kaydet [#12] (done in B46)
- ★ One vocabulary across Ayarlar / Simülasyon / step 1: Köprü, Kapalı, ince tabaka, Climb (tırmanma) [#11, #12] (done in B46)
- "Ayrı plaka parçalarını yeni projeye aktar" also on an unsaved new project (saves first); a project on an archived machine shows "bu makine arşivlendi" on step 1 and Dışa aktar [#12] (done in B46)
- Machine form park fields: the unit sits against the number ("0mm"), needs a space like the other fields [T B55 tester] (done in B53)
- Flaky e2e seen in CI round 24 (green on rerun): `b07-cutlist-tester-r3.spec.ts:247` 390 touch tap after scroll (scrollIntoViewIfNeeded timeout), `b21-preview3d-perf.spec.ts:69` fps read 0 on the CPU runner [T CI]
- Parçalar header: after a quantity change "1 sorun" and "Hatalı satırlar" stay yellow; they should be neutral (usta test 2026-11-21) [usta] (done in B53)

### P4 Kabuk, bildirimler, ana sayfa   [status: done, B39]
Done in B39 (#134). The Dışa aktar profile-version item was dropped: T269 is already the box.
- ★ Toasts close on step change and never cover the panel / scale bar [#8, #9, #10]
- Command palette: Şablonlar, Ayarlar / Malzemeler, Makine doğrulama and in-project step commands [#10]
- Empty 0-part drafts do not fill "Son projeler"; home card date not truncated [#10]
- Offcuts: proposals not pre-ticked; "Stoğa kaydet" gives a toast; the list shows the source project name [#9, #10]
- Şablonlar thumbnails to scale [#8]
- Projeler: search / filter / sort kept in the URL; rows ≈ 100 px high, "Son dışa aktarma" one line + icon button; small layout thumbnail or sheet count to tell same-name projects apart [#11]
- Dışa aktar: "PDF aç" plus a download option; history rows visible at 1440 × 900 without scrolling (CTO #4 not fully met) [#11, T B37]
- ★ Projeler row 205 px on a 3-sheet project: one line + "3 dosya" / zip button, no mid-word breaks; search / filter / sort in the URL [#11, #12]
- Ana sayfa: "Bu hafta dışa aktarma" counts NC only (or relabel), deleted projects not counted; "Makine yok" when no active machine [#12]
- Dışa aktar: the footer hint jumps to the checklist (or the list sits above Dosyalar); file names break at _ / - or are middle-truncated; report card time rounds like Simülasyon [#12]
- Small server fixes: maintenance day in local time; client-log limit in bytes [T B38, T B43] (done in B46 #150, D-086)

### P5 Output (golden impact: tester gcode-safety review, D-051)   [status: done, B51 #155; float residue → T306]
Done in B51 (#155, D-091); goldens approved per D-051.
- Tool order makes one manual change too many (T2 → T3 → T2, also in "En az takım değişimi") [#7] (done in B51)
- Float residue in G-code (`Y117.9999`): clean before rounding [#8] → T306 (nesting side, open)
- Lead-in arc / ramp on inner contours, plunge mark off the visible edge (check what T288 already covers) [#6] (checked in B51: already covered by T141/T288, no change)
- Passes above tab height do not lift over tab gaps [#6] (checked in B51: already so, no change)
- PDF sheet page: mark the origin corner (X0 / Y0, front left); grain arrow not over the name on small parts [#11] (done in B51)
- Labels: "first free label" start position for a half-used sheet [#11] (done in B51)
- Consider writing the `KESIM` header line in every file before the field test (golden impact) [#11] (done in B51)
- Thin-skin cleanup pass enters with a straight plunge; consider a ramp (golden impact) [T B43] (checked in B51: straight plunge kept)

### Not polish (moved)
- Mode-card click long task 225–375 ms → T186 performance sweep.
- Flaky `geometry/offset.property.test.ts` and `t249-panels.spec.ts:55`, missing browser test for DXF "Çizgi üzerinden" mapping → T190 regression scenarios (task only if seen again).
- Flaky `b21-preview3d-perf.spec.ts:69` (300 parts, first frame ≤ 1.5 s) failed once on a loaded CI runner (integration/13, green on retry) → T186 performance sweep (task only if seen again).
- Manual tool change 20 mm above the material, no park position → field-test list.
- Removed as done or covered: project name appending (T283), holes in Dizilim (B24), multi-file "İndir" label (T176 zip), Çizim view remembered (T290).

## M9: Cila ve saha hazırlığı (exit = ~90 % line: field-test ready, owner sign-off)

### Batch B29: T184–T186 (onboarding, accessibility, performance)

### T184 Onboarding and sample project   [status: done]
Spec: §4.2 · Depends: T180
Acceptance:
- [ ] first run: welcome dialog, sample project (cabinet + hinge doors), guided tour of the 5 wizard steps; can be reopened from Ayarlar
Tester focus: first-run only; sample project exports a valid NC.

### T185 Accessibility sweep   [status: done]
Spec: §3.7, §11 · Depends: T184
Acceptance:
- [ ] keyboard-only completion of the whole flow (cut list → nest → 3D/simulation → export); AA contrast in both themes; landmarks, labels; zero serious/critical axe violations on all routes
Tester focus: keyboard-only e2e; axe report for every route; screen-reader spot check of the GrainDial and cut list.

### T186 Performance sweep   [status: done]
Spec: §8.2 · Depends: T184
Acceptance:
- [ ] budgets: initial JS ≤ 250 kB gzip per route (3D/editor lazy), LCP ≤ 2.5 s on the local prod build, 2 000-row cut list usable, nesting 300 parts ≤ 10 s without UI freeze
Tester focus: bundle report; Lighthouse CI numbers; long-task count during nesting.

### Batch B30: T187–T189 (resilience, responsive, G-code regression)

### T187 Error handling and resilience   [status: done]
Spec: §8.2 · Depends: T105
Acceptance:
- [ ] offline/save-failure banner with the unsent queue count, retry; revision conflict dialog (reload / keep mine as copy); client errors logged to a local server log
Tester focus: kill the server mid-edit → queue → recover without loss; conflict dialog e2e.

### T188 Responsive and touch pass   [status: done]
Spec: §3.7 · Depends: T185
Acceptance:
- [ ] 390 / 768 / 1024 / 1440 layouts for every route; touch for editor pan/zoom/select and 3D orbit; tablet workshop use (large hit targets ≥ 40 px). The canvas-first rule for steps 3–4 is already done in T198; this pass covers the remaining routes and the editor
Tester focus: screenshot matrix of all routes at 4 widths; touch emulation e2e.

### T189 G-code regression set for the new operations   [status: done]
Spec: §7.2, §11 · Depends: T143, T167 · **Human gate: golden files (`needs-human`)**
Acceptance:
- [ ] golden fixtures for both posts: holes + pockets + grooves, inner contours, arcs, rotated grain parts, true-shape layout, thin skin
- [ ] one broken-G-code test per §7.2 rule for each new operation type
Tester focus: full safety review; golden list prepared for the owner's approval.

### Batch B31: T190–T193 (final e2e and field-test readiness)

### T190 Full regression e2e scenarios   [status: done]
Spec: §11 · Depends: T189
Acceptance:
- [ ] 5 scenarios in CI: cabinet + hinge doors, DXF sign letters, grain-rotated panels, mixed holes/pockets, offcut reuse; each: input → nest → 3D → simulation → NC + PDF + DXF + labels; all checks pass
Tester focus: run the suite; review every NC with the safety checklist.

### T191 Field-test kit   [status: done]
Spec: §7.3, §12.3 · Depends: T190
Acceptance:
- [ ] extended test program (holes, pocket, groove, arcs, inner contour) + measurement form fields; printable field checklist PDF (origin, Z zero, tool, air cut first); `docs/machines/_template/` for the info collection; air-cut/test exports recorded
Tester focus: safety review of the extended test program; air-cut floor (D-031) holds for the new operations.

### T192 In-app help and "Yenilikler"   [status: done]
> CTO #12: add a search in the help.
Spec: §8.2 · Depends: T190
Acceptance:
- [ ] Turkish help pages (getting started, cut list, drawing, grain, 3D, export, air cut) linked from the palette; "Yenilikler" dialog per release
Tester focus: links work; text in `tr.json`; axe.

### T305 A new project never receives another project's parts (unsent queue per draft)   [status: done]
Must-fix (data loss / wrong project), found in the T190 offcut scenario; rider in B49. Spec: §8.2 · D-094
Cause: the unsent queue of a project not created yet lived under one shared `sessionStorage` key `nittcam.unsent.new`. Leaving a new project before its first save came back (e.g. Projeler → + Yeni proje) left that key, and the next new project replayed it: the first project's parts **and its client id**, so the repeated create returned the first project and later saves went into it.
Acceptance:
- [ ] the queue key is per draft (`nittcam.unsent.new.<draft id>`); the address of a project not saved yet carries `?taslak=<draft id>`; a new project replays only the queue of its own draft (and only when this tab holds it); the old shared key is dropped, never replayed
- [ ] "+ Yeni proje" (menu, list, home) while a draft is not saved yet opens an empty project with a new draft id
- [ ] a reload (or the way back from the machine form) before the first save still restores the draft's own edits (§8.2, T187, T264)
- [ ] unit tests (`autosave.test.ts`) + e2e `t305-new-project-queue.spec.ts` (leave without waiting for the save; menu Yeni proje; reload)
Tester focus: try to get one project's parts into another (leave fast, offline, two tabs, Back/forward, machine form round trip).

### T193 Field-test readiness review   [status: todo]
Spec: §12.1 · Depends: T191, T192 · Owner: PO + tester · **Human gate: owner sign-off**
Acceptance:
- [ ] checklist: all M2–M9 exits met, known issues list, open spec items (§14.2) that affect the test, machine info (§12.3) collected; question to the owner via the dashboard
Tester focus: final full run (unit, property, golden, e2e, visual, axe, perf) with one summary report.

---

### Batch B54: T307–T308 (owner requests 2026-11-21, before the field test; Dev 1, PR #161)

### T307 Spindle speed per project (slider)   [status: done, B54 #161; details above]
Owner 2026-11-21. Default = rpm of the job material set; per-tool override in Simülasyon "Kesim ayarları" (slider + field, recommended tick, ±20 % band, chip load), within the machine min/max (command + validator), NC `S` and header show it; no override = same bytes.

### T308 Per-job tool choice per operation   [status: done, B54 #161; details above]
Owner 2026-11-21. Outer / inner contour, pocket, hole: pick a compatible tool from the machine profile (default = today), "Önerilene dön", rpm suggestion follows the tool.

### Batch B55: T309 (owner request 2026-11-21; Dev 2, PR #162)

### T309 Park position for manual tool change   [status: done]
Owner 2026-11-21 (D-097). Machine profile option `toolChanger.park` (X/Y in machine coordinates, written as `G53 G0 X.. Y..`, on/off, within the machine travel); every manual pause (tool change and first-tool check) goes safe Z → park → message + M0; only for posts with G53 (`motion.machineCoordinates`), otherwise forced off with a form note; the independent reader accepts the G53 move only at the profile's point; field-kit note names the point; park off = same bytes (goldens unchanged).

### T310 Assembly view: door holes where the drawing has them   [status: done]
Owner test 2026-11-21 (before the field test, D-101; Dev 2). A single door with asymmetric handle holes showed them upside down in "Montaj görünümü" (T285 turned every left/single door over about its horizontal axis). Fix: a door with only through work faces the drawing to the front (looks exactly like the drawing); a door with face-only work (hinge cups, pockets, blind holes, grooves, lines) keeps the drawing's top on top and shows the inside face (left/right turned, physically true); two through-only doors of one row both keep the drawn height (the right one turned about its vertical axis, handles meet in the middle); two doors with hinge cups stay as T285 (hinges at the outer edges; one door is turned 180°, unavoidable for identical boards). Unit tests on the part → assembly transform, e2e screenshots `t310-assembly-holes.spec.ts`. G-code untouched (web preview only).

### T311 Manual tool change stops with M0 only (G-code safety)   [status: done]
Tester finding 2026-11-21 (before the field test, D-100; Dev 2). The independent check accepted M1 (optional stop) as the pause of a manual tool change; with optional stop off on the controller the machine runs on with the old tool. Fix: in manual mode every pause (tool change and first-tool check) must be M0, M1/M01 is an error `TOOL_CHANGE_OPTIONAL_STOP` (rule TOOLS); the post config allows only `manualStop: "M0"` (shipped posts already write M0). Rejection tests in `gcode-check/manual-stop.t311.test.ts`; goldens byte-identical.

### T314 AI chat shell with a fixed "yakında" reply   [status: done]
Owner request 2026-11-21 (before the field test, D-102; Dev 2). "AI botu ekle ama AI olarak ekleme": the chat UI is visible, the answer is always one fixed Turkish text (`wizard.assistant.reply`). "Asistan" button in the wizard step bar (bottom right, spec §5.2), panel floating above it bottom right (non-modal dialog, "Yakında" badge, message list, input, Enter sends, focus to the input on open, Esc / ✕ closes and returns focus, reply in a polite live region, reduced motion via tokens); the panel is lazy-loaded (T186 budget, wizard 436 kB ≤ 450). Session-only history (component state; nothing stored, nothing sent, no project change, `packages/core` untouched). One `AssistantResponder` slot (`apps/web/lib/assistant/chat.ts`) for the real M11 responder; dragging the panel, per-project history and the warning badge come with M11 (real AI still behind Q001). Unit `lib/assistant/chat.test.ts`, e2e `t314-assistant.spec.ts` (open, type, Enter, reply, Esc; axe + captures 1440/390 light/dark).

### Batch B56: T312, T313 (owner requests 2026-11-21, before the field test; Dev 1)

### T312 Cabinet doors on the sheet that has room   [status: done]
Owner 2026-11-21 (D-103): "Dolap eklediğimde 2 kapağı da plakada görmüyorum ... fire vermeden diğer kapakları sıkıştırsak?" Root cause: with several stock sizes (library seed 2800 × 2070 + 2440 × 1220) every candidate chose each new sheet's size greedily (smallest waste share of that sheet), so the 800 mm two-door cabinet went onto two 2440 × 1220 sheets with one door alone on the second (91 % waste) although one 2800 × 2070 sheet takes it all (5.80 m² < 5.95 m²). Fix: size policies per candidate (greedy, smallest size that takes every remaining part, each stock size first); the rank picks: fewer unplaced, then total sheet area when it differs by 2 % or more, else fewer sheets, then area, then the objective (PO, round 1: 13 more sheets for 0.7 % less board is a bad trade). With several sizes guillotine heuristics also ask an exact MaxRects shadow of each open sheet before opening a new one. One size: byte-identical to before (regression test: 300 seeded jobs fingerprinted on main). Unit tests with the cabinet case, the ranking rule + property "no part on a later sheet fits the free space of an earlier one" (several sizes). Help text shows mm with up to 2 decimals (0,15 stays 0,15).

### T313 Clear distance between parts = tool Ø + clearance (default 0.1 mm)   [status: done]
Owner 2026-11-21 (D-104): "8'lik takım kullanıyorsak arada offset 8 değil 8,1 mm olmamalı mı?" The rule was already tool Ø + `nesting.gap` (D-019) but the built-in gap was 8, so neighbours stood 16 mm apart. New projects start with gap 0.1 (Ø8 → 8.1 mm clear); per project in step 3, company default in Ayarlar. UI says "Parça arası pay" and "Parça arası boşluk: takım Ø8 + pay 0,1 = 8,1 mm". Rectangle and true-shape placers share `partSpacing`; leads keep their neighbour check (shortened / removed with a warning), tabs stay on the contour. Unit tests: measured clear distance ≥ Ø + clearance for both engines.

### Batch B57: T316–T318 (usta 1 user test, before the field test; Dev 2)

### T316 Dolap ekle keeps finished sizes in cut mode (edge band)   [status: done]
Usta 1 (Kemal) 2026-11-21, D-105. With "Bitmiş ölçü" off (cut mode) the "Dolap ekle" rows were entered at the generator's finished sizes, so the band was added on top (door 395,5 × 714 cut, 397,1 × 715,6 finished; a 3 mm door gap became 1,4 mm). Fix: the generator's sizes are finished sizes; in cut mode each row is entered minus its band (`enteredSize`, door 393,9 × 712,4), in finished mode as generated, so both modes cut the same parts. The assembly view reads finished sizes (`finishedSize`), so the box and the door gap stay as designed. Cut list, PDF, labels and G-code all read `toCutSizes` (unchanged). Help text states both rules. Unit: `cut-size.test.ts` (+ property), `cabinet-rows.test.ts`; cabinet e2e expectations updated (cut rows).

### T317 "Aynala" gives a real left / right door pair   [status: done]
Usta 1 (Kemal) 2026-11-21, D-106. The template option "Aynala (sol / sağ kapak)" only flipped the template along its edge; a door row of 2 stayed two identical boards (two left doors in nesting and G-code), and the assembly view turned one door 180° (handles at different heights). Fix: the drawing-board inspector shows "Sol / sağ kapak" for a part with qty ≥ 2; "Sol / sağ kapak yap" runs the new command `splitMirrorPair` (one undo step): the part keeps ⌈qty/2⌉, a left ↔ right mirrored copy (holes, pockets, templates, lines, band, grain) gets ⌊qty/2⌋ as its own row right after it (note "Aynalı eş"). Nesting, toolpath, G-code and labels need no special case (two real parts; goldens unchanged). The assembly view places two door rows of one door each side by side (`cabinetAssembly` door slots), marks them `pair`, mounts both with the drawing's top on top and puts the row whose handle faces the middle on the left (`doorSide`). The template checkbox is renamed "Kenar boyunca ters çevir" (what it does). Unit: core `split-mirror-pair.test.ts` (incl. nesting → toolpath), web `assembly-pair.test.ts`; e2e `b57-usta1.spec.ts`.

### T318 Pasted grain "Var" runs along Boy; bulk edit grain directions   [status: done]
Usta 1 (Kemal) 2026-11-21, D-107. A pasted "Damar: Var / evet" row became fixed at the sheet grain angle (0° = along En), so doors and sides lay across the grain and Baza 2400 × 100 did not fit. Fix: a yes/no grain column without an angle column gives fixed 90° in the part frame (along Boy = h), the same as "Dolap ekle"; an angle column still wins. Bulk edit grain choices: Değiştirme, Serbest, Boy boyunca (90°), En boyunca (0°), Açı seç… (dial, starts at 90°). Unit: core `parse.test.ts`, `part.commands.test.ts`; web `cut-list-grid.test.ts`; e2e `b57-usta1.spec.ts`.

### Batch B58: T319–T322 (usta reports 2026-11-21, must-fix before the field test; Dev 1)

### T319 Canvas part label shows the part size, not the label room   [status: done]
Usta 2 (Elif): a 600 × 400 panel (R20 corners, cut-out, circle, holes) read "276 × 172,5" on the Dizilim and Simülasyon canvases while the inspector said 600 × 400. Root cause: since B44 the label sits at a spot inside the material and both canvases passed that spot's free room as the part's W × H to `partLabel()`. Fix: `spotLabel()` (`apps/web/lib/label-spot.ts`) prints the footprint W × H and uses the spot only as room (the drawing board already did). Unit test with Elif's panel.

### T320 Hole tool: a drill must match the hole; default the best compatible tool   [status: done]
Usta 1 (Kemal): a Ø35 hinge cup with a Ø5 drill was accepted silently; template holes always came with T1 (Ø6 mill). Rule (D-099, D-108): a drill only drills a hole of its own Ø (through or blind); a bigger hole needs a mill (helical / pocket) and is rejected with a clear message in validation and the export checklist. New holes default to the best compatible tool (a drill of the hole's Ø if the machine has one, else the mill). Unit tests.

### T321 One warning state across the summary, the checks box and the cut list   [status: done]
Usta 1 + 2: (a) leads removed ("yer yok") on 7 parts while the summary said green "Tüm kontroller geçti" → the summary shows a warning state with the count; (b) "1 uyarı" next to "Sorun bulunmadı" → one source of truth; (c) after a quantity change every row showed red "Hata" → neutral "Yeniden diz" state; (d) a manual tool changer with park off → checklist warning "takım değişiminde takım plakanın üstünde kalır; park noktası ayarlayın", mentioned in the field kit too.

### T322 NC file name respects the machine's length limit   [status: done]
Usta 1: `Kemal_Mutfak_alt_dolap_800_r19_S1.tap` (37 chars) on a machine with a 32-char limit. The file name is shortened deterministically to the profile limit (the sheet suffix, revision and extension stay, the project part is cut; names stay unique) and Turkish characters follow the profile; the checker/checklist warns if a name still exceeds. Unit tests.

### Batch B59: T323, T324 (usta 2 / Elif findings, owner-approved before the field test; Dev 1)

### T323 Per-tool cutting feed and plunge feed   [status: done]
From: `.team/usta2-rapor.md` #4 (Ø6 and Ø8 both at 6 000 mm/min) · D-111
- [x] each job tool has its own cutting and plunge feed: recommended from the tool's material set (the job set; a tool chosen per operation (T308) takes its own set, like the T307 rpm); per-tool override in Kesim ayarları (`setToolFeed`, undoable, "İlerlemede önerilene dön")
- [x] validation: feed/plunge > 0 and inside the machine limits (`machineFeedLimits`: the profile-wide bounds 100–60 000 / 50–30 000 mm/min; the profile has no own max yet) in command, validation (`FEED_OUT_OF_RANGE`), toolpath and post; chip load uses the tool's own feed; plunge > feed warns
- [x] G-code: F per tool, plunges at the tool's plunge feed; "İLERLEME T..: ..." header line only with an override; checker R5 `FEED_ABOVE_MACHINE`
- [x] goldens byte-identical with defaults

### T324 Ramp entry for contours   [status: done]
From: `.team/usta2-rapor.md` #3 (dik dalma uç yakar) · D-111 · Spec §6.3 "Dalma düz veya rampalı"
- [x] per job "Dalma (konturda): Dik dalma | Rampa" with angle (default 3°, 0,5–45°) and shortest leg (default tool Ø, 1–1 000 mm); `setEntry`; default stays straight (goldens identical)
- [x] zig-zag along the contour (outer and inner) down to each pass depth at the plunge feed; tabs keep clear of the ramp; the ramp stays on the contour line, so never outside the part's allowed region or into a neighbour; "GİRİŞ: rampa ..." header line
- [x] checker R3 `RAMP_OUTSIDE_KERF`: a ramp is accepted only on a level cut of the same block (independent of the generator); property test over random contours, depths, passes, tabs, inner cut-outs
- [ ] per-operation ramp setting (not done: one job setting covers outer and inner contours)

### T325 Rectangular (closed-shape) blind pocket   [status: done]
Owner 2026-11-21, before the field test (D-112; usta raporu 2 "Elif": "depth exists only for round holes, while the help says 'cep ekleyin'"). An inner contour drawn inside a part (rectangle, rounded rectangle, any closed shape whose clearing stays one connected area) gets the operation "Cep (kör)" with a depth in the part inspector (`setOperation` kind `pocket`, one undo step; depth > 0 and < thickness, a pocket as deep as the stock is an inner cut). Toolpath `contour-pocket.ts`: offset rings (step-over 40 % Ø, ≤ 50 %), wall ring last at tool radius (finishing), step-down per pass from the cutting set, ramp entry along the innermost ring (≤ 3°, more laps when needed; straight plunge only when the ring is shorter than Ø, warning `POCKET_PLUNGE_ENTRY`), between passes up to safe Z and back down to the cleared floor; climb = CCW like hole pockets; tool = T308 `pocket` choice, else the set's tool. Refused (toolpath + validation where drawn): too narrow for the tool (`POCKET_TOO_SMALL`), rings splitting into islands (`POCKET_SPLIT`), depth ≥ thickness; < 1 mm skin = warning. Concave corners keep the tool radius: the inspector says "Köşeler R3 kalır". Independent check (LAYOUT, own geometry): every cutting move inside a pocket keeps the tool inside the boundary minus its radius and above the declared depth, and every pocket is cleared (`POCKET_OUTSIDE_BOUNDARY`, `POCKET_TOO_DEEP`, `POCKET_NOT_CUT`). Part-in-hole nesting uses only through cut-outs (a pocket, an engraved or uncut inner contour keeps its material). Shown in the editor canvas (light recess, dashed), 3D preview (recess + floor), layout/simulation (not an opening), PDF layout (dashed, "Cep 6"), labels ("Cep ×1, 6 mm derin"), DXF export on layer CEP; help text updated. Goldens byte-identical. Tests: `toolpath/contour-pocket.test.ts` (unit + property: random rectangles, depths, rotations through the export check), `gcode-check/pocket.test.ts`, 3D mesh, e2e `t325-rect-pocket.spec.ts` (draw → Cep → depth → simulate → download passes `verifyDownloaded`; 1440/390 captures + axe). Not in scope: DXF import of non-circular pocket layers (still "yakında"), islands inside a pocket, zigzag clearing.

### Batch B61: T327–T329 (owner request 2026-11-23: built-in starting cutting values per material; Dev 2)

Source for every number: `docs/materials/kesim-degerleri-arastirma.md` (PR #190; section d "starting values" and the consolidated table c). PO decisions: (1) values are **starting points, always unverified**: they never mark a set or a profile as verified; (2) MDF 18 / Ø8 stays exactly as today (6000 / 1500 / 18 000 / 6): goldens and the frozen default profile do not change; (3) the kinds stay as they are: `solidWood` starts from the **hardwood** row and `pvc` from the **rigid PVC** row (the safe side), with a note naming the softer variant; splitting the kinds is not part of this batch; (4) no metal here (M-Metal).

### T327 Starting-value table in core   [status: todo]
Spec: §3.6, §7.1 · Depends: – · From: owner 2026-11-23
- [ ] `packages/core` gets a pure data table: material kind × tool type × flute count × diameter band → chip load (min / typ / max), rpm (typ, within the usual 6 000–24 000), step-down rule, plunge share, entry (straight / ramp), notes key; each row carries the source id from the research doc
- [ ] `suggestCuttingSet(kind, thickness, tool, spindleRange)` returns feed, plunge feed, rpm, step-down (feed = chip load × flutes × rpm, rounded to 100 mm/min; rpm clamped to the machine range and the feed recomputed; step-down never above the tool's flute length and reduced by the research rule when the cut is deeper than 1 × Ø) or `undefined` when the table has no row (never a guess)
- [ ] for MDF 18 with the Ø8 two-flute end mill the result equals today's built-in set exactly (test); property test: every suggestion is inside its row's chip-load band and the machine limits
- [ ] no change to existing profiles, projects or goldens
Tester focus: table rows against the research doc for 6 spot checks; clamping at 6 000 and 24 000 rpm; missing row → no suggestion.

### T328 "Kesim ayarı ekle" starts from the material's values   [status: todo]
Spec: §3.6 · Depends: T327 · From: owner 2026-11-23, CTO metal analysis (a new set starts at 5 000 mm/min, 18 000 rpm for every material today)
- [ ] a new cutting set in the machine form, Ayarlar → Malzemeler and the "kesim ayarı yok" fix flow is prefilled from `suggestCuttingSet` for the chosen kind, thickness and tool; changing kind or tool before the first manual edit refreshes the values; a manual edit is never overwritten
- [ ] the set shows "Başlangıç değeri: <kaynak kısa adı> · doğrulanmadı, önce deneme kesimi" and stays unverified; the existing "Değerleri doğruladım" gate (T265) is unchanged
- [ ] a material note where the research has one: melamine (alt yüz / üst yüz kırılması, compression takım), acrylic and PVC (tek ağız, rampa, hava üfleme), plywood (yüz kırılması); a tool that does not fit the material (e.g. two-flute in acrylic) gives a hint, not a block
- [ ] no table row → the fields start empty with "Bu malzeme için hazır değer yok", never the old fixed numbers
Tester focus: every kind × Ø6 / Ø8; edit-then-change-kind keeps the edit; unverified export warning still shown.

### T329 Example machine: real melamine and plywood sets   [status: todo]
Spec: §7.1 · Depends: T327 · From: D-046 (the two sets are copies of MDF 18)
- [ ] `exampleMachineProfile()` (new companies only) takes its Melamin 18 and Kontrplak 18 sets from the table for its own tools instead of the MDF copy; `copiedFrom` is dropped for them; MDF 18 unchanged
- [ ] existing companies' machines are not touched (no migration); the frozen `defaultMachineProfile()` and every golden stay byte-identical; e2e that export from the example machine with melamine or plywood are checked for stale expectations
Tester focus: fresh company gets the three sets; an old company's machine is unchanged; goldens identical.

### Batch B62: T330–T332 (field rehearsal 2026-11-23, blockers before the machine; Dev 2)

Source: `docs/reviews/2026-11-23-field-rehearsal.md` (tester, branch `test/field-rehearsal`), findings B1, B2, S1–S3.

### T330 Feed limits come from the machine (B1, blocker)   [status: done]
Spec: §7.1, §7.2 rule 5 · Depends: T323 · From: field rehearsal B1 · Decision: D-121
- [x] profile: optional `maxFeed` / `maxPlungeFeed` (form fields with units); without them the ceiling is the rapid rate (feed) and half of it (plunge), never below the machine's own set feeds; never the old fixed 60 000 / 30 000
- [x] command, validation, toolpath, post and checker R5 (`FEED_ABOVE_MACHINE`, derived from the profile on its own) use that ceiling as a hard error
- [x] warning `FEED_ABOVE_RECOMMENDED` when a job feed or plunge is > 1,5 × the recommendation or the chip load > 2 × the set's: Kesim ayarları line, Uyarılar count, export checklist line to tick
- [x] goldens byte-identical; unit tests with the tester's numbers (59 000 / 29 000) and checker rejection tests

### T331 The cutter never leaves the sheet (B2, blocker)   [status: done]
Spec: §6.3, §7.2 rule 6 · Depends: – · From: field rehearsal B2 · Decision: D-123
- [x] every cutting and lead move keeps the whole cutter (centre ± radius) on the sheet, for all tool diameters, leads, ramps and pocket entries; a lead that does not fit is shortened or removed with the existing lead warning
- [x] validation says so before export; the independent checker judges the cutter edge on the read path with its own geometry (new error code) with rejection tests; the tester's `lead-sheet-edge.field.tester.test.ts` passes
- [x] changed goldens listed with the reason (label `needs-human`, D-051)

### T332 Field-kit and checklist truth (S1, S2, S3; rider)   [status: done]
Spec: §6.6, §7.3, §12.3 · Depends: – · From: field rehearsal S1–S3 · Decision: D-124
- [x] (S1) park on (G53): checklist and field kit say the machine must be homed; a short ASCII note in the pause comment before the park move; goldens with park off identical
- [x] (S2) a project on an older machine profile version: a warning counted in Uyarılar and a checklist line naming what changed, with "Güncel makine sürümüne geç"; the binding model (§7.3) unchanged
- [x] (S3) the air-cut Z-zero step of the field kit is unambiguous (zero on the spoilboard / table plus the stated safe offset); the other kit steps checked for the same ambiguity
- [x] (rider, PO) "Mach3 ön kontrol" block in the field kit for the `mach3` post: 7 settings from `docs/machines/controllers/mach3-saha-kontrol.md` with their menu paths; every manual change after the first writes `M5` before `M0` (checked over all goldens)

## Field test 1 (owner)   [status: todo]
Spec: §12.1, §12.3 · Depends: T193 (old "Saha 1" and "Saha 2" merged)
- [ ] machine info (§12.3) in `docs/machines/<machine>/` with 2–3 working NC files per machine
- [ ] post config adapted to the real controller (new post version + golden files, owner approval)
- [ ] air cut, then test cut on scrap: outer contour, holes, pocket, groove, arcs, rotated grain part; measurements in tolerance; "NittCam test etti" record
- [ ] every field bug first becomes a failing test (§11)

---

## After the field test (outline; detailed tasks written before each milestone starts)

### M10: Hesap ve çok şirket (T200+)
Better Auth verification (with the organization plugin); login screen with the intro animation (§3.2); companies, users, **memberships** (one person in several companies, role per company, D-113: `company_members`, `company_invitations`; M10 ships with one membership per person enforced in the app and no company switcher, D-116; model in `docs/backoffice/veri-modeli.md` §6.3), **brands inside one company** (D-114: `company_brands` + `projects.brand_id`, brand name/logo on PDFs and labels, project list filter; machines, stock and subscription stay shared; model §6.2), roles (Yönetici / Operatör) checked on the server; replace the default company/user; Postgres RLS on company_id and triggers on version tables; quick user switch for shared workshop PCs; hosting decision (§8.5).

### M11: AI sohbet (T220+), behind Q001
Chat panel, command proposals with Uygula/İptal, warning badge, template update question, messy order reading, quota (§5). Not part of the ~90 % line (D-035).

### M12–M14: Pilot, Ticari, Büyüme
As spec §12.1.

---

## M-Metal: Metal ve kompozit (exit: an ACM tray part with V-grooves and an aluminium test part are cut on a real machine within tolerance; goldens of every existing material byte-identical)   [status: todo, proposal 2026-11-23]

Owner decision 2026-11-23: metal is added to the product (D-xxx, text in `docs/metal/metal-analizi.md` §11). Analysis, scope tiers, setting table, screens and safety rules: `docs/metal/metal-analizi.md`. Scope: tier A1 ACM cut, A2 ACM V-groove, B aluminium sheet/plate, C brass (outline); steel and stainless are permanently out.

**Rules for every task in this milestone**
- Golden files of the existing materials stay byte-identical (acceptance of every task, not repeated below). Metal fixtures get new golden files with the PR label `needs-human`.
- New kinds are `release: 'flagged'`: invisible without the flag `NITTCAM_METAL`. NC for a tier is released to users only after that tier's machine test (human gate tasks T357, T369, T372).
- No `if metal` branches: behaviour comes from `MaterialTraits` (T341). Numbers in the table are aligned with `docs/materials/kesim-degerleri-arastirma.md` before they are coded.
- Batches are named MB1…MB11 here; the PO maps them onto the running B numbers.

**When may it start?**

| Mark | Meaning | Tasks |
| --- | --- | --- |
| pre-FT | may start before field test 1: docs, or a pure refactor with identical output and no visible change | T340, T341, T342 |
| post-FT | touches toolpath, post, checker, schema or visible UI: waits for field test 1 | T343–T356, T358–T368, T370, T371 |
| gate | owner's machine test; nothing of that tier ships before it | T357, T369, T372 |

| Batch | Tasks | Tier | Ships |
| --- | --- | --- | --- |
| MB1 | T340–T342 | foundation (pre-FT) | spec and decision updated; traits table; consumers read it; no visible change |
| MB2 | T343–T345 | foundation | tab/skin/tool-type limits from traits; profile can declare coolant and metal cutting |
| MB3 | T346–T348 | A1 | ACM kind behind the flag with its direction and machined face |
| MB4 | T349–T351 | A1 | material rules in validation, library props, machine parameter table per family: ACM cut jobs end to end (flag) |
| MB5 | T352–T354 | A2 | V-groove operation, toolpath and checker rule |
| MB6 | T355–T357 | A2 | ACM labels/PDF/DXF, field kit and verification per family, **ACM machine test** |
| MB7 | T358–T360 | B | ramp-only entry, step-down and chip-load limits, coolant in toolpath and post |
| MB8 | T364, T365, T361 | B | finishing pass, metal tabs and hold-down, checker rule R11 |
| MB9 | T362, T363, T366 | B | checker rules R12–R16 and R18, aluminium screens (flag) |
| MB10 | T367–T369 | B | look, labels/PDF, aluminium field kit, **aluminium machine test** |
| MB11 | T370–T372 | C (outline) | brass kind, V-engrave, machine test |

### T340 Spec and decision update for metal   [status: todo]   (pre-FT, docs only)
Spec: §2.2, §2.5, §3.6, §4.1, §4.8, §6.2, §6.3, §6.4, §7.1, §7.2, §7.3, §9.1, §9.2, §11, §12.1, §14  ·  Depends: owner approval of the tier scope  ·  Owner: PO
Acceptance:
- [ ] spec edited with the texts of `docs/metal/metal-analizi.md` §10; steel/stainless listed as permanently out
- [ ] decision entry written from §11 with a real number; BACKLOG summary table has the M-Metal row
- [ ] the numbers of the setting table (§4.2) and the safety rules (§7) are compared with `docs/materials/kesim-degerleri-arastirma.md`; every difference is settled in the analysis and marked "doğrulanacak" where no source agrees
- [ ] `docs/machines/_template/README.md` asks: vacuum M code as wired, coolant output and code, clamp height, spindle collet
Tester focus: none (docs).

### T341 Material traits table for the six existing kinds   [status: todo]   (pre-FT)
Spec: §3.6 "Malzeme davranışı" (new)  ·  Depends: –  ·  Owner: dev
Acceptance:
- [ ] `packages/core/src/machine/material-traits.ts`: `MaterialFamily`, `MaterialTraits`, `MATERIAL_TRAITS` for `mdf`, `plywood`, `melamine`, `solidWood`, `acrylic`, `pvc`, and `traitsOf(kind | null)` (null = today's behaviour); pure data, no zod
- [ ] the rows carry today's constants (`TAB_DEFAULTS`, `TAB_BOUNDS`, `SKIN_BOUNDS`, `OPERATION_TOOL_TYPES`, grain yes/no, look); a test asserts equality with those constants, and a snapshot test locks the six rows
- [ ] `materialHasGrain` delegates to `traitsOf(kind).direction.kind !== 'none'`; nothing else in core changes behaviour
- [ ] full core test suite and goldens unchanged
Tester focus: the equality test really compares against the live constants (change one constant locally and the test fails).

### T342 Screens and API read the traits (no visible change)   [status: todo]   (pre-FT)
Spec: §3.6  ·  Depends: T341  ·  Owner: dev
Acceptance:
- [ ] the 11 `materialHasGrain` call sites and the kind switches in `lib/preview3d/textures.ts`, `components/wizard/machine-step.tsx` (groups, sheet presets), `lib/material-form.ts`, `lib/offcut-form.ts`, `app/api/offcuts/[id]/route.ts`, `lib/server/pdf/project-pdf.ts` read `traitsOf` (direction, look, group, presets)
- [ ] the material picker builds its groups from the families present in the table (today: Ahşap, Plastik); the "yakında" row stays
- [ ] no visual baseline changes; e2e of steps 1–5 unchanged
Tester focus: visual diff of step 1, Parçalar, Dizilim, Ayarlar → Malzemeler, offcut dialog is empty.

### T343 Tab, skin and small-part limits come from the traits   [status: todo]   (post-FT)
Spec: §6.3  ·  Depends: T341  ·  Owner: dev
Acceptance:
- [ ] `tabSizeProblem`, `maxTabHeight`, `defaultTabHeight`, `skinThicknessOk`, the small-part thresholds, `materialTabIssues` and the tab help texts of the machine form take the stock's traits instead of module constants
- [ ] wood and plastic rows give exactly today's results (property test: old function = new function over random thickness/kind for the six kinds)
- [ ] a traits row with other bounds (test-only kind) changes the limits end to end: profile save, validation, toolpath, Kesim ayarları texts
Tester focus: 1,5 mm stock with a test-only metal row accepts a 0,5 mm tab; MDF 18 behaves as before.

### T344 Tool types per material; V-bit geometry   [status: todo]   (post-FT)
Spec: §7.1 "Takım profili", §6.3  ·  Depends: T341  ·  Owner: dev
Acceptance:
- [ ] `OPERATION_TOOL_TYPES` becomes a function of the material traits; the six kinds return today's lists
- [ ] tool schema: optional `angleDeg` (10–179) and `tipDiameter` (≥ 0, < diameter), only for `vBit`; machine form shows "Uç açısı (°)" and "Uç düzlüğü (mm)" for a V-bit; older profiles stay valid
- [ ] `OPERATION_TOOL_UNSUITABLE` names the material when the type is not allowed for it
Tester focus: saving a profile with a V-bit without angle still works; an existing profile round-trips unchanged.

### T345 Machine profile: coolant, metal declaration, M-code conflict   [status: todo]   (post-FT)
Spec: §7.1 (new rows "Soğutma", "Metal kesim")  ·  Depends: –  ·  Owner: dev
Acceptance:
- [ ] optional `coolant { type: none|mist|flood|air, control: program|manual, on, off }`, `metal { enabled, rigidity: light|standard|heavy }`, `holdDown.clampHeight`; schema version stays 1; absent = today
- [ ] cross-field rules (only when coolant is program-controlled): coolant and vacuum share no code (`mCodeConflict`); vacuum must not use M7/M8/M9 (`vacuumUsesCoolantCode`); `safeZ ≥ clampHeight + 5` for clamp/T-slot (`safeZBelowClamps`)
- [ ] machine form section "Metal kesim" (behind the flag) with the Turkish error texts of the analysis §5.7; profile versioning and "yeniden doğrulama gerekli" behave as for any profile edit
- [ ] the example profiles and their goldens are untouched
Tester focus: example profile (vacuum M7) + coolant M8/M9 is refused with the fix text; without coolant it saves as today.

### T346 Kinds `acm` and `aluminium` behind the flag   [status: todo]   (post-FT)
Spec: §3.6  ·  Depends: T342, T343, T344  ·  Owner: dev
Acceptance:
- [ ] `MATERIAL_KIND_IDS` gains `acm` and `aluminium` with aliases (kompozit, alüminyum kompozit, dibond, alucobond; aluminyum, alüminyum, alu) and traits rows (`release: 'flagged'`); families `composite`, `nonFerrous`
- [ ] flag `NITTCAM_METAL` off: the kinds appear in no menu, API validation refuses them for new library entries, an old project that names them opens read-only with a notice
- [ ] flag on: picker groups "Kompozit" and "Metal", thickness and sheet presets from the traits, canvas tone tokens and 3D look (ACM flat colour; aluminium metallic), names in `tr.json`; "Çelik (desteklenmez)" row disabled
- [ ] aluminium stays without NC: validation `MATERIAL_NOT_RELEASED` until T366
Tester focus: flag off = no visual diff anywhere; flag on = step 1 with ACM 4 mm 1500×3200 fits or warns against the table.

### T347 Direction: axial or directed, labelled per material   [status: todo]   (post-FT)
Spec: §3.6 "Yön", §6.2  ·  Depends: T346  ·  Owner: dev
Acceptance:
- [ ] labels from the traits: "Damar yönü" / "Yüzey yönü" / "Film oku yönü" on the dial, the cut-list header, bulk edit, layout legend, label arrow; aluminium default off, ACM on when the library entry is metallic
- [ ] directed material: optional part `grain.flip`; a fixed part is placed only at g (not g + 180°) in MaxRects and true-shape; `PLACEMENT_GRAIN` / `LOCKED_PLACEMENT_GRAIN` judge directed placements
- [ ] axial materials: nesting results identical to today (existing nesting tests and benches unchanged)
- [ ] property test: with a directed sheet no fixed part is ever placed 180° off
Tester focus: ACM metallic job with an asymmetric part: all copies point the same way; the same job on MDF still uses both rotations.

### T348 Machined face: "Arka yüzden işle"   [status: todo]   (post-FT)
Spec: §3.6 "İşlenen yüz"  ·  Depends: T346  ·  Owner: dev
Acceptance:
- [ ] optional `stock.machinedFace` (absent = front); command `setMachinedFace`, undoable; default from the traits (ACM back)
- [ ] back: parts are mirrored once, in the layout stage, so toolpath, G-code, simulation, DXF and PDF agree; the drawing board keeps the front view with the badge "Ön yüzden çiziyorsunuz · makinede aynalanır"
- [ ] Dizilim and Simülasyon show "Arka yüz görünümü"; labels and PDF say which face was up
- [ ] checker LAYOUT compares against the mirrored expectation built independently from the project
Tester focus: an "L" part on ACM: G-code path is the mirror image; on MDF nothing changes; mirrored + rotated grain part still passes the checker.

### T349 Material rules in validation and the parts screens   [status: todo]   (post-FT)
Spec: §4.1, §4.8, §7.1  ·  Depends: T346  ·  Owner: dev
Acceptance:
- [ ] `TOOL_TYPE_UNSUITABLE_FOR_MATERIAL` (compression or ball-nose on ACM/aluminium), `MATERIAL_NOT_ALLOWED_ON_MACHINE` (non-ferrous without `metal.enabled`), each with a fix link, shown at step 1
- [ ] edge band columns, band deduction, "Dolap ekle" follow `traits.edgeBand` / `traits.cabinet`; existing band values are kept but ignored with the notice of the analysis §5.2 (`EDGE_BAND_IGNORED`, info)
- [ ] "Kesim ayarı ekle" starts a set from the family's cautious values, always `unverified`; never the wood values for a non-wood family
- [ ] wood and plastic screens unchanged
Tester focus: switch a banded MDF job to ACM and back: sizes return exactly; no band value is lost.

### T350 Library and offcut properties for ACM and aluminium   [status: todo]   (post-FT)
Spec: §3.4, §9.1  ·  Depends: T346  ·  Owner: dev
Acceptance:
- [ ] migration: `materials.props jsonb not null default '{}'`, `offcuts.props jsonb not null default '{}'`; core schema per family (aluminium: alloy, temper, finish, film; ACM: colorCode, metallic, skin)
- [ ] Ayarlar → Malzemeler dialog shows the fields of the chosen kind, direction label per kind, tones `aluminium`, `silver`, `brass`; no metal entry in the new-company seed
- [ ] offcuts match on kind + thickness + alloy or colour code when both sides have one; offcut dialog shows them
- [ ] PDF header and project cards print "Alüminyum 5754, 3 mm" / "Kompozit panel, 4 mm"
Tester focus: tenant isolation of the new columns; an MDF entry saves with empty props as before.

### T351 Machine parameter table per material family   [status: todo]   (post-FT)
Spec: §3.6 "Malzeme = parametre seti", §7.1  ·  Depends: T345, T346  ·  Owner: dev
Acceptance:
- [ ] optional set fields `coolant`, `finishAllowance`, `rampDeg`; shown only for families whose traits use them
- [ ] the row shows the chip load (feed / rpm × flutes) and marks it against the traits band; outside the band the profile cannot be saved for that row
- [ ] step-down above the traits ceiling × rigidity is refused with the limit in the text
- [ ] example ACM 3 and 4 mm sets can be added with one action, marked `unverified`
Tester focus: wood rows have no new cells and save unchanged; an aluminium row at 5 000 mm/min, 18 000 rpm, 2 flutes is refused.

### T352 V-groove operation in the model and on the board   [status: todo]   (post-FT)
Spec: §6.3 "V-kanal", §4.6  ·  Depends: T344, T348  ·  Owner: dev
Acceptance:
- [ ] operation kind `vgroove { remaining? }` on open lines and inner contours, only where `traits.vGroove` exists; `setOperation` accepts it; `cutting.tools.vgroove`
- [ ] inspector "V-kanal (büküm)": tool (V-bits only), "Kalan kalınlık" (default and bounds from traits), computed groove width; canvas draws the groove width and a dashed centre line
- [ ] DXF import: layer mapping offers "V-kanal"; DXF export writes layer `VKANAL`
- [ ] validation where drawn: `VGROOVE_TOOL_MISSING`, `VGROOVE_DEPTH_INVALID`, groove outside the part
Tester focus: the operation is not offered on MDF or aluminium; undo restores the previous operation.

### T353 V-groove toolpath and simulation   [status: todo]   (post-FT)
Spec: §6.3  ·  Depends: T352  ·  Owner: dev
Acceptance:
- [ ] centre-line path at depth = thickness − remaining, corrected for the tip flat; one pass (two when deeper than the traits step); grooves run before any contour of the same part; plunge at the plunge feed, never a rapid into material
- [ ] the toolpath refuses a groove whose depth would leave less than `traits.vGroove.minRemaining`, whatever the user typed
- [ ] simulation and 3D draw a V section; time estimate includes the grooves
- [ ] new fixture "ACM tray 200×200, 25 mm folds" with golden files (`needs-human`)
Tester focus: remaining 0,8 on 3 mm and 4 mm; groove crossing another groove; groove to the sheet edge.

### T354 Checker rule R17: V-groove   [status: todo]   (post-FT)
Spec: §7.2 (R17)  ·  Depends: T353  ·  Owner: dev
Acceptance:
- [ ] `VGROOVE_TOO_DEEP`: with a V-bit active no move goes below −(thickness − traits minimum), derived from stock and traits in the check context, not from the toolpath
- [ ] `VGROOVE_WRONG_TOOL`: a through cut with a V-bit, or a groove path cut with another tool type; `VGROOVE_MISSING`: every expected groove line (sampled from the project) is covered by a cut within tolerance
- [ ] mutation tests: deepen one groove by 0,4 mm, drop one groove, swap the tool; each is caught
- [ ] rules are silent for jobs without `traits.vGroove`
Tester focus: G-code safety review of the tray golden; hand-edited NC with a deeper Z is refused for download.

### T355 ACM on labels, PDF and export checklist   [status: todo]   (post-FT)
Spec: §6.6  ·  Depends: T353  ·  Owner: dev
Acceptance:
- [ ] label: film arrow, "YÜZ AŞAĞI KESİLDİ", "Büküm: n"; no band marks
- [ ] PDF layout pages: grooves dashed with a legend; header material text; face-up note
- [ ] step 5 checklist items for ACM (analysis §5.6); G-code header line `MALZEME: ...`
Tester focus: PDF of the tray fixture at A4 and A3; wood PDFs byte-identical.

### T356 Verification per material family; ACM field kit   [status: todo]   (post-FT)
Spec: §7.3  ·  Depends: T353  ·  Owner: dev
Acceptance:
- [ ] migration `validations.material_family` (null = wood board); verification page shows a state per family; a family without a test cut gives the "DOĞRULANMADI" header and the extra acceptance at download (R10)
- [ ] field kit offers the family's test part; ACM: tray part, measurements: remaining thickness, folded outer size
- [ ] `docs/machines/_template/saha-testi-acm.md` with the protocol
- [ ] existing verifications keep their state for wood jobs
Tester focus: a machine verified with MDF downloads MDF NC as before and ACM NC only with the warning.

### T357 Machine test: ACM (owner)   [status: todo]   (gate)
Spec: §7.3, §12.1  ·  Depends: T355, T356, Field test 1  ·  Owner: owner
Acceptance:
- [ ] air cut, then 3 and 4 mm panel: square, disc, inner cut, small tabbed part; sizes within ±0,2 mm
- [ ] V-groove on scrap: remaining thickness 0,8 ± 0,1 mm measured; 90° fold without a mark on the face; the tray part folds to size
- [ ] every field bug first becomes a failing test; values in the traits table corrected from the measurements
- [ ] owner releases tier A to users (flag per company)
Tester focus: none (human gate).

### T358 Entry rule from the traits: ramp or helix only in metal   [status: todo]   (post-FT)
Spec: §6.3 "Giriş/çıkış"  ·  Depends: T346  ·  Owner: dev
Acceptance:
- [ ] `traits.entry.straightPlunge = false`: contours always ramp (default and maximum angle from traits); "Dalma (konturda)" shows "Rampa" locked with the reason; `ENTRY_RAMP_REQUIRED` when a ramp does not fit (part too short) instead of falling back to a plunge
- [ ] hole pockets, grooves and contour pockets use the traits helix angle; a ring too small for a helix is refused (`HOLE_SMALLER_THAN_ENTRY`), never plunged
- [ ] drilling with a drill tool: peck ≤ 1 × Ø with a retract that clears chips
- [ ] wood and plastic: unchanged entries
Tester focus: property test over random aluminium jobs: no descent into material steeper than the limit except drill moves.

### T359 Step-down and chip-load limits as errors   [status: todo]   (post-FT)
Spec: §7.2 (R13, R14), §6.3  ·  Depends: T345, T346  ·  Owner: dev
Acceptance:
- [ ] validation and toolpath: `STEP_DOWN_ABOVE_MATERIAL_LIMIT` (traits × rigidity × tool Ø) and `CHIP_LOAD_OUT_OF_RANGE` (upper and lower bound per tool Ø band) for every job tool, with the allowed range in the message
- [ ] Kesim ayarları: the chip-load line leads for metal, with the band and the fix ("İlerlemeyi 900 mm/dk yapın"); `setToolFeed` and `setSpindleRpm` refuse values that leave the band
- [ ] `SLOT_TOO_DEEP` warning (depth > 3 × Ø)
- [ ] materials whose traits have no limit are untouched
Tester focus: boundary values exactly on the limits; per-operation tool choice (T308) is judged with its own diameter and flutes.

### T360 Coolant in the toolpath model and the post   [status: todo]   (post-FT)
Spec: §6.3 "Soğutma", §6.4  ·  Depends: T345  ·  Owner: dev
Acceptance:
- [ ] toolpath events coolant on/off; job setting `cutting.coolant` (default from set, then traits); required and none available: `COOLANT_REQUIRED`
- [ ] post config optional `coolant { enabled }`; new versions `mach3` 1.1.0 and `generic` 1.1 with it enabled and their own goldens; order: spindle on, dwell, coolant on, first plunge; off before every tool change, pause and at the end before vacuum off
- [ ] manual control: `M0` + "SOGUTMAYI ACIN" before the first cut, message at the end
- [ ] the 1.0.0 post files and their golden sets are not edited; machines bound to them produce identical files
Tester focus: G-code safety review of the new goldens; a profile on post 1.0.0 with an aluminium job is refused with "post sürümünü yükseltin".

### T361 Checker rule R11: coolant   [status: todo]   (post-FT)
Spec: §7.2 (R11)  ·  Depends: T360  ·  Owner: dev
Acceptance:
- [ ] `COOLANT_NOT_ON` (required and program-controlled: on after each spindle start and before the first cutting move), `COOLANT_ON_AT_PAUSE`, `END_COOLANT_ON`, `COOLANT_PROMPT_MISSING` (manual)
- [ ] `VACUUM_OFF_MID_PROGRAM` for every material (no current golden violates it)
- [ ] the requirement is derived from stock, traits and profile in the check context; mutation tests remove or move each M code
Tester focus: multi-tool and split-file programs; coolant state across a manual tool change.

### T362 Checker rules R12–R14: plunge, step-down, chip load   [status: todo]   (post-FT)
Spec: §7.2 (R12–R14)  ·  Depends: T358, T359  ·  Owner: dev
Acceptance:
- [ ] `STRAIGHT_PLUNGE_IN_METAL`: descent angle of every feed move that enters material, measured on the read path against already-cut levels; drill tools excepted; `PECK_MISSING`
- [ ] `STEP_DOWN_ABOVE_LIMIT`: level differences per operation from the read path; `CHIP_LOAD_ABOVE_LIMIT` / `CHIP_LOAD_BELOW_LIMIT` from read F, S and the profile's flute count
- [ ] R4 extended: dwell after every spindle start and every S change in metal (≥ 3 s)
- [ ] mutation tests per rule; all silent for wood and plastic goldens
Tester focus: the rules do not import toolpath code; a hand-edited F or Z in the NC is caught.

### T363 Checker rules R15, R16, R18: hold-down, tool type, clamps   [status: todo]   (post-FT)
Spec: §7.2 (R15, R16, R18)  ·  Depends: T365  ·  Owner: dev
Acceptance:
- [ ] `PART_NOT_HELD`: every through-cut outer contour and inner slug of a non-ferrous job shows tab lifts on its last level (≥ 2; ≥ 3 above 600 mm perimeter) or stops at the skin level; `PART_TOO_SMALL`
- [ ] `TOOL_TYPE_FORBIDDEN` from the traits and the profile tool table
- [ ] `SAFE_Z_BELOW_CLAMPS` (XY rapids ≥ clamp height + 5 mm); `CUT_IN_CLAMP_ZONE` as a warning
- [ ] mutation tests: remove the tabs of one part, swap in a compression tool, lower safe Z
Tester focus: skin jobs with the cleanup pass; part-in-hole placements.

### T364 Finishing pass   [status: todo]   (post-FT)
Spec: §6.3 "Finiş pasosu"  ·  Depends: T358  ·  Owner: dev
Acceptance:
- [ ] optional `cutting.finish { allowance, feedFactor? }`; default from the traits (aluminium 0,2 mm on, others off); `setFinishPass`, undoable
- [ ] rough passes run `allowance` away from the line, the last pass takes it at full depth (tabs kept), climb; inner contours and pocket walls included; nesting spacing accounts for the allowance
- [ ] Kesim ayarları section "Finiş pasosu"; header line `FINIS: 0.2`; simulation shows it in its own colour
- [ ] absent field = identical toolpath for every existing job
Tester focus: finished size of the fixture part equals the drawn size within tolerance; tabs survive the finishing pass.

### T365 Tabs, skin, spacing and order for metal   [status: todo]   (post-FT)
Spec: §6.2, §6.3  ·  Depends: T343, T346  ·  Owner: dev
Acceptance:
- [ ] `traits.tabs.everyPart`: "Köprü: her parçada" locked; defaults and bounds from the traits; skin as the alternative with its own bounds; inner slugs are held too
- [ ] parts with a side below `traits.minPartSide`: `PART_TOO_SMALL_FOR_HOLD_DOWN` at the row and on the board
- [ ] Dizilim defaults: gap from `traits.spacing`, margin 25 mm with clamp hold-down (warning below); cutting order inside-out, the small-first rule off
- [ ] wood and plastic defaults and order unchanged
Tester focus: 1,5 mm sheet job gets valid tabs; a 15 mm part is refused with a clear text.

### T366 Aluminium screens and release behind the flag   [status: todo]   (post-FT)
Spec: §3.6, §6.5  ·  Depends: T358–T365  ·  Owner: dev
Acceptance:
- [ ] `MATERIAL_NOT_RELEASED` removed for aluminium when the flag is on; step 1 hints and the error box "Bu makine alüminyum için tanımlı değil" with the fix link
- [ ] Kesim ayarları sections "Soğutma", locked "Dalma", "Finiş pasosu", pass summary with the ceiling
- [ ] step 5 checklist items for aluminium (analysis §5.6), all required; header lines `MALZEME`, `SOGUTMA`, `GIRIS`, `FINIS`
- [ ] new fixture "aluminium 3 mm test part" end to end with golden files (`needs-human`)
Tester focus: full G-code safety review of the aluminium golden; the flow from an unprepared machine to a downloadable file has no dead end.

### T367 Look, labels and PDF for aluminium   [status: todo]   (post-FT)
Spec: §3.8, §6.6  ·  Depends: T366  ·  Owner: dev
Acceptance:
- [ ] 3D: metallic material (roughness, metalness from traits), brushed lines along the direction when it is on; simple mode flat grey; perf budget kept
- [ ] label: direction arrow when on, "Çapak alınacak"; PDF cut summary rows "Soğutma", "Giriş", "Finiş" and the safety box
- [ ] help page "Metal kesimi" (which machine, tools, coolant, clamping, what to watch, why no steel)
Tester focus: light and dark; wood PDFs and labels byte-identical.

### T368 Aluminium field kit and release gate   [status: todo]   (post-FT)
Spec: §7.3  ·  Depends: T356, T366  ·  Owner: dev
Acceptance:
- [ ] field kit test part for the non-ferrous family: 80×80, Ø20 hole, 2 mm blind pocket, tabs; air cut first; tolerance ±0,1 mm; measurement form
- [ ] without a recorded test cut for the family: "DOĞRULANMADI" header and the extra acceptance; without `metal.enabled`: no NC
- [ ] `docs/machines/_template/saha-testi-aluminyum.md`: protocol, what to stop for (sound, chip colour, built-up edge), coolant code check
- [ ] company-level switch replaces the env flag for released tiers
Tester focus: the gate cannot be bypassed by a direct API call.

### T369 Machine test: aluminium (owner)   [status: todo]   (gate)
Spec: §7.3, §12.1  ·  Depends: T367, T368, T357  ·  Owner: owner
Acceptance:
- [ ] machine declared for metal with real coolant and clamp data; air cut; coolant and vacuum outputs switch as written
- [ ] test part in 3 mm 5754 and 6 mm 6082: ramp, pocket, hole, tabs, finishing pass; sizes within ±0,1 mm; no built-up edge, no broken tool
- [ ] traits numbers (chip-load band, step-down ceilings, tab sizes) corrected from the test; every field bug first becomes a failing test
- [ ] owner releases tier B to users
Tester focus: none (human gate).

### T370 Brass kind (outline)   [status: todo]   (post-FT, after T369)
Spec: §14.3  ·  Depends: T369  ·  Owner: dev
Acceptance:
- [ ] kind `brass` in the non-ferrous family with its own numbers (dry cutting allowed); copper listed as "yakında"
- [ ] detailed tasks written before the tier starts
Tester focus: to be written.

### T371 V-engraving on the line operation (outline)   [status: todo]   (post-FT, after T354)
Spec: §14.3  ·  Depends: T354  ·  Owner: dev
Acceptance:
- [ ] "Oyma" with a V-bit: line width from depth and angle shown on the board and in the simulation; depth bound per material
- [ ] text tool stays out of scope
Tester focus: to be written.

### T372 Machine test: brass (owner, outline)   [status: todo]   (gate)
Spec: §7.3  ·  Depends: T370, T371  ·  Owner: owner
Acceptance:
- [ ] test cut and engraving on brass sheet; release decision
Tester focus: none (human gate).
