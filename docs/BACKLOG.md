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
| M3 Kesim listesi, malzeme, damar kadranı | T112–T123 (12) | B5–B8 | free-angle grain respected from cut list to G-code; cut list editable without Excel |
| M4 Çizim tahtası I: editör | T124–T137 (14) | B9–B13 | a drawn freeform part with fillets is nested and gives checked G-code |
| M5 Çizim tahtası II: delik, cep, şablon, DXF | T138–T151 (14) | B14–B18 | hinge-door project via template and a DXF sign job both give checked G-code |
| M6 3D önizleme | T152–T161 (10) | B19–B21 | 360° preview + cutting playback, 300 parts within the perf budget, 2D fallback |
| M7 Dizilim yükseltmeleri | T162–T171 (10) | B22–B24 | 3 modes, true-shape with rotation, offcuts, edge-band deduction |
| M8 Export, etiket, proje yönetimi | T172–T183 (12) | B25–B28 | NC + DXF + PDF + labels from the server; projects/home/settings complete |
| M9 Cila ve saha hazırlığı | T184–T193 (10) | B29–B31 | **~90 % line: field-test ready** (owner sign-off) |
| Saha 1 (owner) | – | – | air cut + test cut incl. holes, pockets, arcs on both machines |
| M10 Hesap ve çok şirket | T200+ (outline) | – | after field test |
| M11 AI sohbet | T220+ (outline) | – | after M10; Q001 |
| M12–M14 Pilot, Ticari, Büyüme | – | – | spec §12.1 |

**Before the field test: 102 tasks in 33 batches** (94 + 7 from Fable design review #1 + T194b, `docs/reviews/2026-11-18-fable-design-review-1.md`). The "~90 % / field-test ready" line is the end of M9 (T193).

**Order note (2026-11-18, D-035 amendment):** after B4b come B9–B10 (drawing board foundation, T124–T129), then M3 B5–B8, then B11+.

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

### T194 Brand identity: mark, wordmark, favicon, shell placement   [status: todo]
Spec: §3.7 · Depends: T103 · Decision: D-032 · Owner: FQ1, FQ2
Acceptance:
- [ ] `Logo` component in `packages/ui` (inline SVG, `currentColor` + accent token, no image download): **mark** (monogram "N" drawn as a toolpath: lead-in, two plunges, one diagonal pass, a tool dot at the end) and **wordmark** "NittCam" (Inter 600, tight tracking, "Cam" in `accent-text`); sizes 20/24/32 px; mark-only variant for the collapsed sidebar
- [ ] sidebar header shows the NittCam logo (top-left, links to Ana sayfa); the company tile ("Atölyem / Operatör") moves to the **bottom** of the sidebar as the account/workspace row (above "Menüyü daralt"); mobile drawer and the 390 px top bar show the mark
- [ ] favicon + app icons (`app/icon.svg`, `apple-icon`, 32/180/512 px, light and dark variants), `theme-color` meta for both themes, page titles "<Sayfa> · NittCam"
- [ ] brand section in `/dev/ui` (mark, wordmark, clear space, on light/dark/accent backgrounds); `ui-conventions` skill gains a short "Brand" paragraph (where the logo may appear, never recoloured outside tokens)
Tester focus: logo crisp at 1× and 2× in both themes; collapsed sidebar shows the mark only; favicon visible in the tab; axe (logo link has an accessible name "NittCam, ana sayfa"); shell baselines updated on purpose.

### T194a Shell and home declutter, domain icons   [status: todo]
Spec: §3.4, §3.7 · Depends: T194 · Owner: FQ4 ("Oluştur" removal only)
Acceptance:
- [ ] one primary "Yeni proje" per screen: the sidebar button stays; the Ana sayfa header button is removed while the sidebar is visible (kept below 768 px, where the sidebar is a drawer); the empty state keeps its own CTA
- [ ] nav: "Oluştur" is removed as a separate item (it opens the same wizard as "Yeni proje"; a new unsaved project highlights "Projeler"); items that are not built yet (Şablonlar, Ayarlar) move to a muted "Yakında" group at the bottom instead of sitting between live items with badges
- [ ] Ana sayfa: the placeholder KPI "Ortalama fire / Yakında" is hidden until it has data (3 KPI cards, or 4 once T180 lands); with zero projects the KPI row is replaced by a 3-step start strip ("1 Makine · 2 Kesim listesi · 3 G-code") with a line illustration built from canvas tokens
- [ ] 6 domain icons as SVG components in `packages/ui` (24 px grid, 1.5 px stroke, lucide-compatible): router/spindle (replaces the generic chip for machines), sheet/plaka, grain/damar, nesting/dizilim, toolpath/takım yolu, air cut; used in nav, machine rows, quick actions and wizard steps
- [ ] wording: "export" in UI text becomes "dışa aktarma" everywhere ("Bu hafta dışa aktarma", "Henüz dışa aktarma yok"); new projects are named "Adsız proje" + counter instead of a date-time string, and the name field is focused and selected on the first wizard step
Tester focus: exactly one accent-filled "Yeni proje" on Ana sayfa at 1440; nav item count and active state through a new-project flow; no "export" word left in `tr.json` values (grep); icons readable at 16/20/24 px in both themes.

### T195 Typography: mono numerics, type scale tune   [status: todo]
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
---

## M4 early: Çizim tahtası temeli, B9–B10 (moved before M3; D-035 amendment 2026-11-18)

The owner wants the drawing board early. B9 and B10 depend only on T110 (and on T197's `WorkspaceLayout`), so they run right after B4b and before M3 B5–B8. B11+ stay in M4 below. **Work order: B4b → B9 → B10 → B5 → B6 → B7 → B8 → B11 → …**

### Batch B9: T124–T126 (canvas foundation)

### T199b B4b follow-ups   [status: review]
Spec: §3.6, §3.7 · Depends: T196–T198 · Owner: B4b tester + PO review 2026-11-18
Acceptance:
- [ ] desktop plate tabs never cut off the last tab (e.g. "Plaka 3" at 1440): the strip scrolls with fade edges, or the overflow goes into a "+N" menu
- [ ] below 640 px the simulation step shows the plate tabs on their own row, the same as Dizilim
- [ ] tool-order markers in the simulation never cover part labels (markers offset to the part corner, or labels under markers hidden at low zoom)
Tester focus: 1440 with 3+ plates (last tab fully visible / reachable); 390 simulation with 2+ plates; simulation screenshot at fit zoom, labels readable.

### T124 Editor canvas foundation   [status: review]
Spec: §4.2 · Depends: T110
Acceptance:
- [ ] "Çizim" view in the Parts step (tabs: Liste / Çizim, same data, §3.6); Konva stage in mm, Y up, pan (space-drag, middle mouse, two-finger), zoom to cursor (wheel, pinch), fit-to-content
- [ ] built on `WorkspaceLayout` (T197): vertical tool rail on the left edge of the canvas (40 px buttons, tooltip + shortcut letter), compact inspector on the right, a status bar under the canvas (cursor X/Y in mono, snap toggles, zoom %, units); dot grid rather than lines at the finest level; canvas language from T196 (dimension labels in mono, accent selection, `info` colour for snap guides)
- [ ] adaptive mm grid (1/10/100), rulers, cursor coordinates, scale bar; theme colours
- [ ] editor store: tool, selection, hover, viewport; project data only through commands
Tester focus: pan/zoom with mouse + touch emulation; coordinates correct at 3 zoom levels; visual both themes.

### T125 Selection, move, clipboard, mirror, rotate   [status: review]
Spec: §4.2, §4.4 · Depends: T124
Acceptance:
- [ ] click / Shift-click / box select; move by drag and arrows (1 mm, Shift 10 mm); Delete; Ctrl+C/V/D; mirror H/V; rotate 90°
- [ ] all through commands (`movePart` in the drawing frame, `mirrorPart`, `rotatePart`) with undo; Ctrl+Z / Ctrl+Y
Tester focus: e2e select-move-undo; clipboard paste offsets; mirror keeps outline orientation rules (outer CCW).

### T126 Snap engine (core)   [status: review]
Spec: §4.4 · Depends: T124
Acceptance:
- [ ] pure `snap(point, context)`: endpoint, midpoint, centre, intersection, grid, perpendicular, 45°/90° angle lock; priority order and screen-space tolerance; returns kind + point
- [ ] snap glyphs in the editor; toggle per kind; hold Alt to disable
- [ ] fast-check: a snapped point equals the target within EPS; no snap outside tolerance
Tester focus: property tests; e2e drawing a line onto an endpoint ends exactly there (read from properties panel).

### Batch B10: T127–T129 (drawing tools)

### T127 Rectangle and circle tools   [status: todo]
Spec: §4.3, §4.4 · Depends: T125, T126
Acceptance:
- [ ] rectangle: drag or click + typed "W;H" → parametric rect part (corner radius in properties); circle: centre + radius → freeform round part (bulge arcs)
- [ ] live dimension labels while drawing; Esc cancels
Tester focus: typed sizes exact; new parts appear in the cut list; undo.

### T128 Line / polyline tool with typed length   [status: todo]
Spec: §4.4, §6.1 · Depends: T126
Acceptance:
- [ ] click-click polyline; type a length + Enter for the current segment, Tab to type the angle; 45°/90° lock with Shift
- [ ] ends within JOIN_TOL close the contour → freeform part (`addSegment`, CCW normalised); open shape shows "Kesilemez, kapalı değil"
Tester focus: e2e drawing an L-shape by typed lengths → exact outline; open shape blocked from nesting with the Turkish warning.

### T129 Arc tool and segment bulge   [status: todo]
Spec: §4.4, §6.1 · Depends: T128
Acceptance:
- [ ] 3-point arc and "drag segment middle to bend" (`setSegmentBulge`); typed radius
- [ ] arcs survive save/load and produce G2/G3 (checked through the pipeline)
Tester focus: arc radius from properties = typed radius; G-code contains G2/G3 for the arc; reader check passes.

---

## M3: Kesim listesi, malzeme kütüphanesi, damar kadranı (exit: a free-angle grain set on sheet and part is respected in nesting, preview and G-code; the cut list is fully editable in the app)

### Batch B5: T112–T114 (grain angle engine)

### T112 Grain angle model: schema v2, migration, commands   [status: todo]
Spec: §6.2, §9.2 · Depends: none · Decision: D-034
Acceptance:
- [ ] schema v2: `stock.sheet.grain` = angle in degrees [0, 180) (or `null` = no grain); part `grain: { mode: 'free' | 'fixed', angle }` (angle in the part frame, [0, 180)); placement `rot` = any degrees [0, 360) (number, 3 decimals)
- [ ] migration v1 → v2: sheet `grain` 0/90 kept; `grainLock: true` → `{ mode: 'fixed', angle: sheet grain }`, `false` → `{ mode: 'free', angle: 0 }`; placements unchanged; v1 fixtures migrate and validate
- [ ] commands `setGrain(angle|null)` (sheet), `setPartGrain(id, {mode, angle})`, undoable; `updatePart` keeps accepting `grainLock` as an alias for one release
- [ ] pure `allowedRotations(part, sheet, policy)`: fixed → {g, g+180} with g = sheetGrain − partGrain (mod 360); free → {0, 90, 180, 270} (+ policy steps later, T166)
- [ ] fast-check: for every fixed part and every rotation from `allowedRotations`, (partGrain + rot) ≡ sheetGrain (mod 180)
- [ ] D-038: `rotatePart` / `mirrorPart` turn `part.grain.angle` with the shape via `turnGrain` / `mirrorGrain` (core, B9); unit tests: 4 × rotate 90° = identity incl. grain, mirror twice = identity
Tester focus: migration on every existing fixture + saved projects in PGlite; undo round-trip; property test review.

### T113 Arbitrary-angle rotation through geometry, toolpath, post and checks   [status: todo]
Spec: §6.1, §6.3, §6.5, §7.2 · Depends: T112
Acceptance:
- [ ] geometry `transform` supports any angle (bulges unchanged, vertices rotated); arc-aware bbox of rotated outlines
- [ ] toolpath, cut order, tabs and the G-code checks (part positions vs layout) work for non-90° placements; post unchanged
- [ ] all existing golden files byte-identical
- [ ] properties: for random angles every cutting move stays at tool radius from the rotated part (± EPS); area invariant under rotation
Tester focus: **G-code safety**: a 30°-rotated part through post + reader + checks; §7.2 rule tests still pass; golden diff = none.

### T114 Placer: grain-aware rotations with rotated footprints   [status: todo]
Spec: §6.2 · Depends: T113
Acceptance:
- [ ] the min-waste placer takes rotations from `allowedRotations`; an axis-aligned angle uses the rectangle as today; a non-axis angle places the **axis-aligned bbox of the rotated outline** (interim until true-shape, T165–T167) and reports `GRAIN_ROTATED_BBOX` info with the extra waste
- [ ] `PART_LARGER_THAN_SHEET` respects the forced rotation
- [ ] fast-check: no overlap (exact rotated rectangles), inside margin, gap kept, grain rule holds, deterministic
- [ ] benchmark set gains a grain-30° case
Tester focus: property tests for the grain rule; a fixed 30° part never appears at another angle; deterministic re-run.

### Batch B6: T115–T117 (grain dial UI)

### T115 GrainDial component   [status: todo]
Spec: §3.6, §3.7 · Depends: T101
Acceptance:
- [ ] circular dial like an angle wheel: drag the handle around the circle, click on the ring to jump, numeric input next to it (°, decimal comma), quick buttons 0° / 45° / 90° / 135°
- [ ] look (Fable review #1): 120 px dial (72 px variant for popovers and table cells); outer ring with ticks every 15° and longer ticks + labels at 0/45/90/135; the **handle is a diameter line with a grip at both ends** (a grain has no direction, so both ends drag and "30° = 210°" is seen, not explained); the disc is filled with fine grain lines clipped to the circle; the angle read-out sits in the centre in mono ("30°"); the tick under a snap lights up in accent while snapped
- [ ] snaps to multiples of 45° within ±3° while dragging (hold Alt to disable); grain lines inside the dial rotate live
- [ ] keyboard: role `slider`, arrows ±1°, Shift+arrows ±15°, Home = 0°; aria-valuetext "30 derece"
- [ ] angle normalised to [0, 180) with a visible note that 30° and 210° are the same grain; `disabled` and "no grain" states
- [ ] in `/dev/ui` gallery; unit tests for angle maths (pointer → angle, snap, normalise)
Tester focus: drag interaction e2e (mouse + touch emulation), keyboard steps, snap behaviour, axe, screenshots both themes.

### T116 Grain in the UI: sheet, parts, layout and simulation   [status: todo]
Spec: §3.6, §4.1, §6.5 · Depends: T114, T115
Acceptance:
- [ ] wizard step 1: GrainDial for the sheet (only for wood/veneered materials; "damar yok" otherwise); the sheet preview (T196) redraws its grain texture live while the dial is dragged
- [ ] cut list: grain column shows a mini arrow + angle and fixed/free toggle; editing opens a popover with the GrainDial; bulk edit sets the same grain
- [ ] layout view + simulation: sheet grain texture lines at the sheet angle; each part shows a grain arrow at its effective angle (part grain + rot); rotated parts drawn rotated
Tester focus: visual check that arrows match angles (screenshot at 0/30/90°); editing grain is one undo step; free parts show no arrow.

### T117 Grain end-to-end test   [status: todo]
Spec: §11 · Depends: T116
Acceptance:
- [ ] e2e: sheet grain 0°, part A fixed 0°, part B fixed 90°, part C fixed 30° → nesting places A at 0/180, B at 90/270, C at −30/150; simulation and NC download pass every check
- [ ] core test: the read G-code of C's outer contour matches the 30°-rotated outline within tolerance
Tester focus: run the e2e; inspect the NC file contour direction for C; G-code safety review of the rotated case.

### Batch B7: T118–T120 (cut list UX)

### T118 Cut list grid v2   [status: todo]
Spec: §4.1 · Depends: T111
Acceptance:
- [ ] TanStack Table + virtual rows: name, W, H, qty, grain, edge Üst/Alt/Sol/Sağ, material note; sticky header; column resize
- [ ] spreadsheet-like inline editing: click/Enter to edit, Tab/Shift+Tab, arrows, Esc cancels, Enter commits and moves down; Turkish decimal comma; per-cell validation with tooltip
- [ ] "+ Satır ekle" and Enter on the last row add a part; each commit = one command, one undo step
- [ ] 1 000 rows: scroll ≥ 50 fps, edit commit < 50 ms
- [ ] 390 px: card list mode instead of the grid
- [ ] compact density (T195): 36 px rows, numbers right-aligned in tabular figures, the four edge-band columns collapsed into one "Bant" cell with a 4-side glyph (click opens the four inputs), so name/W/H/qty/grain fit without horizontal scroll at 1024 px
Tester focus: keyboard-only edit flow e2e; perf trace with 1 000 rows; undo/redo after a series of edits; visual both widths.

### T119 Row actions, multi-select and bulk edit   [status: todo]
Spec: §4.1, §5.1 · Depends: T118
Acceptance:
- [ ] row menu: duplicate, delete, move up/down; Ctrl/Shift multi-select; Ctrl+D duplicate, Delete removes (with undo toast)
- [ ] bulk edit Sheet for the selection: qty, grain, edge bands, name prefix; new command `updateParts` = one undo step
- [ ] footer summary: rows, total pieces, total area m², estimated sheets (area / usable sheet area)
Tester focus: bulk edit of 50 rows → one undo restores all; summary numbers checked against a hand calculation.

### T120 Import and export: CSV/XLSX file, paste dialog, CSV out   [status: todo]
Spec: §4.1 · Depends: T118
Acceptance:
- [ ] "İçe aktar" dialog: drop/select `.csv`, `.xlsx` (MIT/Apache reader, licence-checked), or paste; reuses the T011/T011b parser and mapping preview; size limit and type check (§8.6)
- [ ] "Dışa aktar" CSV (semicolon, Turkish decimal comma, UTF-8 BOM) that re-imports to the same parts
- [ ] round-trip property test (export → import = same parts)
Tester focus: real Excel files (merged header row, empty rows, Turkish chars); oversized file rejected; round trip.

### Batch B8: T121–T123 (materials, cabinets, organisation)

### T121 Material & stock library   [status: todo]
Spec: §3.4, §3.6, §9.1 · Depends: T111
Acceptance:
- [ ] Ayarlar → Malzemeler page: CRUD of materials (type, name, thickness list, colour/texture key, default grain angle, stock sheet sizes, linked parameter set per machine), company-scoped `materials` table + migration
- [ ] wizard step 1 picks material → thickness → sheet size from the library (custom size still possible); seed: MDF 18, Kontrplak 18, Melamin 18, Akrilik 5 with 2800×2070, 2440×1220
- [ ] tenancy test for the new table
Tester focus: CRUD e2e; wizard uses library values; company isolation test; visual + axe.

### T122 Parametric cabinet box generator   [status: todo]
Spec: §4.7 (v3 note) · Depends: T119
Acceptance:
- [ ] pure core `cabinetParts(params)`: W, H, D, thickness, back panel (none/inset/overlay, thickness), fixed shelves count, doors (0/1/2, gap), plinth height → named rect parts with grain (sides vertical) and edge band defaults; no joinery
- [ ] "Dolap ekle" dialog with live mini preview (2D front view) → `importCutList` as one undo step; parts tagged with a group name
- [ ] unit + property tests (dimensions add up, all parts positive, door gaps)
Tester focus: generated dimensions vs hand calculation for 3 cabinets; undo removes the whole cabinet; dialog keyboard flow.

### T123 Cut list organisation: groups, search, sort, filter   [status: todo]
Spec: §4.1 · Depends: T119
Acceptance:
- [ ] group column (cabinet/tag) with collapsible groups; search box (Turkish folding); sort by any column; filter "hatalı satırlar"
- [ ] sorting/filtering never changes part order in the project (view only)
Tester focus: e2e search + sort + group collapse; project JSON order unchanged after sorting.

---

## M4: Çizim tahtası I: editör (exit: a freeform part drawn with lines, arcs and fillets is nested and gives checked G-code)

Konva stays the 2D engine (§8.3). Every edit is a command (§5.1). Snap/geometry logic is pure core code with property tests.

B9–B10 (T124–T129) were moved up and run right after M2.5, before M3 (D-035 amendment, 2026-11-18); their task text is in the section "M4 early: Çizim tahtası temeli" above. M4 continues here with B11.

### Batch B11: T130–T132 (properties and corner tools)

### T130 Properties panel   [status: todo]
Spec: §4.4 · Depends: T127
Acceptance:
- [ ] part: name, qty, W/H/R (parametric), grain (GrainDial), operation summary; segment: length, angle, radius; vertex: X/Y
- [ ] the panel is the right inspector of `WorkspaceLayout` (T197) in compact density (32 px controls, label left / value right rows, collapsible groups)
- [ ] `setSegmentLength` rule: end vertex moves along the segment, the neighbour follows (§4.4), no solver; `moveVertex`
- [ ] edits are commands, one undo step each; invalid values rejected with Turkish errors
Tester focus: segment-length rule on 3 shapes (hand-checked coordinates); undo granularity; keyboard use of the panel.

### T131 Fillet, inner-corner rule, convert to freeform   [status: todo]
Spec: §4.3, §4.4 · Depends: T130
Acceptance:
- [ ] `filletCorners(part, corners, r)` in core: radius clamped to neighbour lengths with a warning
- [ ] concave corners below tool radius: warning with "otomatik düzelt" (fillet to tool radius)
- [ ] `convertToFreeform` for parametric parts
- [ ] property tests: fillet keeps the contour closed, orientation kept, area decreases
Tester focus: property tests; clamp warning visible; auto-fix result checked against the tool radius of the selected machine.

### T132 Dogbone / T-bone   [status: todo]
Spec: §4.4 · Depends: T131
Acceptance:
- [ ] `addDogbone(part, corner, style)` in core: overcut circle of tool radius at concave corners (dogbone along the bisector, T-bone along a chosen edge)
- [ ] editor action on selected corners; tests: the tool can reach the corner point (toolpath reaches within EPS)
Tester focus: toolpath test that the corner point is cut; visual check of both styles.

### Batch B12: T133–T135 (dimensions, cutouts, sync)

### T133 Dimension labels and annotations   [status: todo]
Spec: §4.2, §4.4 · Depends: T130
Acceptance:
- [ ] on-canvas length labels for selected segments and parts (always readable size); dimension tool for persistent linear dimensions (stored as non-cut annotations, ignored by nesting/toolpath)
Tester focus: annotations never reach the toolpath (core test); labels readable at all zoom levels (screenshots).

### T134 Inner contours (cutouts)   [status: todo]
Spec: §4.3, §6.1 · Depends: T128
Acceptance:
- [ ] drawing a closed shape inside a part asks "iç kesim olarak ekle?" → added to `inners` (CW normalised)
- [ ] validation: inner inside outer, inners not overlapping, inner larger than tool diameter
Tester focus: validation cases; the inner contour survives nesting rotation (moves with the part).

### T135 Cut list ↔ editor sync   [status: todo]
Spec: §3.6, §4.1 · Depends: T127, T118
Acceptance:
- [ ] parts sidebar in the editor (search, select); selection syncs between Liste and Çizim; freeform parts show "Serbest" with bbox W/H read-only in the grid
- [ ] drawing arranges parts in a non-overlapping drawing area (drawing positions are not nesting positions)
Tester focus: e2e create in grid → visible in editor and back; freeform W/H not editable in grid.

### Batch B13: T136–T137 (editor polish and tests)

### T136 First-use tour and hints   [status: todo]
Spec: §4.2 · Depends: T135
Acceptance:
- [ ] short tour (5 steps, skippable, remembered) for the editor; contextual hint bar per tool ("Uzunluk yazıp Enter'a bas")
- [ ] shortcut sheet for editor tools (from the T104 registry)
Tester focus: tour once only; keyboard-only completion; reduced motion.

### T137 Editor e2e suite and performance budget   [status: todo]
Spec: §11 · Depends: T136
Acceptance:
- [ ] e2e: draw L-shape with arc and fillet → nest → simulate → NC download passes checks (= M4 exit)
- [ ] perf: 500 entities, pan/zoom ≥ 50 fps, selection < 50 ms (trace in CI artefact)
Tester focus: run suite; review perf numbers; G-code safety review of the drawn part's NC.

---

## M5: Çizim tahtası II: delik, cep, şablon, DXF (exit: a hinge-door project built with a template and a DXF sign job both give checked G-code)

### Batch B14: T138–T140 (hole object and its toolpaths)

### T138 Hole object, commands and hole tool   [status: todo]
Spec: §4.5, §5.1 · Depends: T130
Acceptance:
- [ ] `addHole`, `updateHole`, `removeHole` (type pocket / through / groove, d, cx, cy, depth, groove width, tool); holes move/rotate with the part
- [ ] hole tool in the editor: click centre, diameter grows live, properties with the "İçini boşalt" / "Sadece çember (kanal)" toggle
- [ ] validation: d ≥ tool diameter, blind depth < thickness, groove width ≥ tool diameter, hole inside the part
Tester focus: each validation case; a rotated part keeps holes in the right place (core test + screenshot).

### T139 Toolpath: drilling and through holes   [status: todo]
Spec: §4.5, §6.3, §6.4 · Depends: T138 · **Human gate: new golden files (`needs-human`)**
Acceptance:
- [ ] d = tool → single plunge or drill cycle (G81/G83 when the profile supports it, else explicit moves); d > tool → helical/spiral entry + circular path; through depth = thickness + spoilboard allowance
- [ ] cut order holes → inner → outer kept; tabs considered for big through holes
- [ ] reader supports G81/G83 for checks; new golden fixtures for both posts
Tester focus: **G-code safety** (§7.2 rules incl. drill cycle retract plane); failing-input test for a drill below Z limit; golden review list for the owner.

### T140 Toolpath: blind pocket and ring groove   [status: todo]
Spec: §4.5, §6.3 · Depends: T139
Acceptance:
- [ ] circular pocket clearing (spiral, stepover from the tool) to depth in passes; groove single/multi pass by width
- [ ] validation "cep derinliği kalınlığa çok yakın" (warning, < 1 mm skin by default)
- [ ] properties: no move below target depth; pocket wall at d/2 ± EPS
Tester focus: safety review; pocket depth vs Z reference both modes (table / material top).

### Batch B15: T141–T143 (more operations)

### T141 Toolpath: inner contours   [status: todo]
Spec: §6.3, D-013 · Depends: T134, T139
Acceptance:
- [ ] inside offset for inners (SPLIT → export-blocking error, ARC_COLLAPSED warning), lead-in inside the waste side, multi-pass, tabs optional
- [ ] cut order verified with drawn parts having holes + inners
Tester focus: safety review; SPLIT case blocks the export in the UI; cut-order property test with inners.

### T142 On-line operation and per-contour operations   [status: todo]
Spec: §4.6, §6.3 · Depends: T141
Acceptance:
- [ ] `setOperation(contour, 'outside' | 'inside' | 'online' | 'none', depth)`; on-line = tool centre on the line at depth (open contours allowed)
- [ ] properties panel shows the operation per contour; layer mapping (T145) feeds the same field
Tester focus: on-line open path G-code passes checks; depth never below thickness + allowance.

### T143 Thin-skin option for small parts   [status: todo]
Spec: §2.4, §6.3 · Depends: T141
Acceptance:
- [ ] option "son pasoda ince tabaka bırak" (skin thickness): small parts keep a skin, a final cleanup pass after all parts removes it; tabs and skin are alternatives per project
Tester focus: safety review of the cleanup pass order (last); depth properties.

### Batch B16: T144–T146 (DXF import)

### T144 DXF reader wrapper and entity conversion   [status: todo]
Spec: §4.6, §8.3 · Depends: T128
Acceptance:
- [ ] `dxf-parser` (licence verified, MIT) wrapped in core-compatible pure conversion: LINE, ARC, CIRCLE, LWPOLYLINE (bulge), POLYLINE, one-level INSERT; SPLINE/ELLIPSE approximated within tolerance; TEXT/MTEXT/DIMENSION/HATCH counted and ignored
- [ ] units from `$INSUNITS`; suspicious size → `UNIT_UNCERTAIN`
- [ ] fixtures incl. real messy files (`dxf-io` skill)
Tester focus: fixture report counts; arc direction preserved (bulge sign); spline deviation within tolerance.

### T145 DXF join, part recognition and layer mapping   [status: todo]
Spec: §4.6 · Depends: T144
Acceptance:
- [ ] join ends within 0.05 mm into closed contours; unclosed ones flagged; outermost closed = part, inside = inner or hole (circles → hole object optional)
- [ ] layer → operation mapping, saved as a company setting; `importDxf` command (one undo step)
Tester focus: property test (random segment soup of a known shape rejoins); mapping persists per company.

### T146 DXF import dialog   [status: todo]
Spec: §4.6 · Depends: T145
Acceptance:
- [ ] upload → preview canvas + report (supported / converted / ignored counts, open contours) → unit question when needed → layer mapping table → confirm
- [ ] DWG file → Turkish message "DXF olarak kaydedin"
- [ ] e2e: sign-letter DXF → nest → NC passes checks (half of the M5 exit)
Tester focus: e2e; size/type limits; visual + axe of the dialog.

### Batch B17: T147–T149 (templates core)

### T147 Template model and "save as template"   [status: todo]
Spec: §4.7, §9.1 · Depends: T138
Acceptance:
- [ ] `templates` / `template_versions` tables (company-scoped, immutable versions); template = parametric group of holes/lines/grooves with params (diameter, edge distance, count, spacing)
- [ ] `saveAsTemplate` from the selection (admin role later; single user now)
Tester focus: tenancy test; version immutability; params validation.

### T148 Place template: ghost, snap, mirror, repeat   [status: todo]
Spec: §4.7 · Depends: T147
Acceptance:
- [ ] "Şablon ekle" → ghost preview, snaps to edges/corners, typed edge distance, mirror (left/right door), rotate, equal-spaced repeat; `addTemplate`, `updateTemplateInstance`; the project stores a copy + version + overrides
Tester focus: e2e hinge on a door at 22.5 mm from the edge; mirrored door; undo.

### T149 Template update flow   [status: todo]
Spec: §4.7 · Depends: T148
Acceptance:
- [ ] opening a project whose template has a newer version asks "Kullanılan … şablonu değişti. Güncellensin mi?"; yes = update (undoable), no = keep; overridden fields show a conflict warning
Tester focus: both answers; override conflict case; undo after update.

### Batch B18: T150–T151 (template library)

### T150 Ready template library   [status: todo]
Spec: §4.7, §14.2 · Depends: T148
Acceptance:
- [ ] seed: hinge cup Ø35 (2 and 3 hinges by door height), handle holes (96/128/160 mm), drawer rail holes; values marked "üretici verisiyle doğrulanacak" (open item §14.2)
- [ ] e2e: hinge-door project with template → nest → NC passes checks (other half of the M5 exit)
Tester focus: e2e; G-code safety review of pockets near the edge.

### T151 Şablonlar page   [status: todo]
Spec: §3.4 · Depends: T150
Acceptance:
- [ ] list (company + ready library), preview thumbnail, edit params, version history, duplicate, archive
Tester focus: visual + axe; edit creates a new version; old projects unchanged.

---

## M6: 3D önizleme (exit: 360° preview with cutting playback; 300 parts within the perf budget; 2D fallback on weak devices)

three + @react-three/fiber + @react-three/drei (MIT), lazy-loaded, in `apps/web` only (core stays pure). Decision D-033.

### Batch B19: T152–T154 (3D foundation)

### T152 3D foundation, controls and fallback   [status: todo]
Spec: §3.8 · Depends: T110
Acceptance:
- [ ] `Preview3D` lazy chunk (not in the initial bundle); WebGL2 capability check → fallback to the 2D view with a Turkish note
- [ ] orbit 360°, zoom, pan; view presets (Üst, İzometrik, Ön), reset; damping off with reduced motion; render on demand (no idle GPU use)
- [ ] table + sheet with real dimensions and thickness, shadows/lighting tasteful, works in light and dark UI
- [ ] studio look (Fable review #1): soft vertical gradient background from tokens (never pure black/white), ground grid that fades with distance, contact shadow under the sheet, neutral tone mapping, thin edge lines on parts for a technical-drawing feel; a **view cube** (Üst/Ön/Sağ + corners) in the top-right corner drives the presets; the first open eases from top view to isometric (≤ 400 ms, off with reduced motion)
- [ ] rendered inside the `canvas` slot of `WorkspaceLayout` (T197) with the same floating toolbar positions as the 2D views; a 2D/3D segmented switch in the canvas toolbar
Tester focus: fallback with WebGL disabled (Chromium flag); bundle analysis shows the 3D chunk is lazy; controls with mouse/touch.

### T153 Part geometry: extrusion, cutouts, holes, pockets   [status: todo]
Spec: §3.8, §4.5 · Depends: T152
Acceptance:
- [ ] pure builder (web) from the project + layout: outlines extruded to thickness (arcs tessellated), inners and through holes as shape holes, blind pockets/grooves as recessed geometry (no CSG), cached per part shape
- [ ] identical parts share geometry (instancing); 300 parts ≤ 300 draw calls
- [ ] unit tests: vertex counts, hole count, bounding box = part bbox × thickness
Tester focus: compare 3D top view screenshot with the 2D layout (positions/rotations match); a 30°-rotated part.

### T154 Materials and grain texture   [status: todo]
Spec: §3.6, §3.8 · Depends: T153
Acceptance:
- [ ] procedural textures generated in code (MDF, plywood, melamine colours, acrylic): no image downloads; grain stripes oriented by the sheet grain angle and each part's effective grain angle; edge bands coloured on banded edges
- [ ] "Basit mod": flat colours, no shadows
- [ ] materials are matte and slightly desaturated (no glossy "game" look); the tool and toolpath use the `sim-tool` / `sim-rapid` tokens so 2D and 3D share one colour language
Tester focus: screenshots at grain 0/30/90°; edge band visible; simple mode visibly cheaper (draw calls/fps).

### Batch B20: T155–T157 (interaction and playback)

### T155 Interaction: move sheet, select, explode, camera transition   [status: todo]
Spec: §3.6, §3.8 · Depends: T154
Acceptance:
- [ ] drag the sheet on the table plane (view-only; never changes the layout or machine offset), snap back button
- [ ] hover/click a part → highlight + info card (number, name, size, grain); "ayır/kaldır" slider lifts parts from the sheet; hide waste toggle
- [ ] wizard "İleri" → smooth camera transition to top view (§3.6), skipped with reduced motion
Tester focus: moving the sheet does not change project JSON (assert); selection matches 2D numbering; reduced motion.

### T156 Toolpath overlay in 3D   [status: todo]
Spec: §6.5, §3.8 · Depends: T153
Acceptance:
- [ ] overlay from the **read G-code** (same data as 2D simulation): rapids dashed above the sheet, cuts coloured by depth; toggle; 50k-segment program renders within budget
Tester focus: overlay comes from the reader (not the toolpath model) — code review; visual match with 2D simulation.

### T157 Cutting playback synced with simulation   [status: todo]
Spec: §6.5, §3.8 · Depends: T156
Acceptance:
- [ ] shared player store (time, speed, line) drives both 2D simulation and 3D: tool + spindle model moves along the read path, cut kerf revealed progressively, parts lift slightly when their outer contour ends
- [ ] banner "Simülasyon air cut'ın yerine geçmez" also in 3D
Tester focus: scrubbing in 2D moves 3D to the same line; play to the end; perf during playback.

### Batch B21: T158–T161 (cabinet view, perf, integration)

### T158 Assembled cabinet preview   [status: todo]
Spec: §3.8 (v3) · Depends: T122, T154
Acceptance:
- [ ] for parts generated by the cabinet generator: "Montaj görünümü" places them in box positions (sides, top, bottom, shelves, back, doors) using the generator's own layout data; non-cabinet parts are not shown
Tester focus: screenshot review of 2 cabinets; dimensions match the generator.

### T159 Performance budget and simple mode   [status: todo]
Spec: §3.6, §3.8 · Depends: T157
Acceptance:
- [ ] budget on the CI reference (mid laptop profile): 300 parts ≥ 45 fps orbiting, first frame ≤ 1.5 s after chunk load, GPU memory stable over 2 min
- [ ] automatic simple mode when fps < 30 for 3 s or no WebGL2; manual setting; DPR capped at 2
Tester focus: perf run with 300 and 600 parts; forced low-fps triggers simple mode; memory over time.

### T160 3D in the wizard and PNG export   [status: todo]
Spec: §3.6 · Depends: T155
Acceptance:
- [ ] wizard right panel: 2D / 3D toggle in sheet, parts and layout steps (live update after commands); "Görüntü kaydet" PNG
Tester focus: switching steps keeps camera; live update after an edit; visual both themes.

### T161 3D test suite   [status: todo]
Spec: §11 · Depends: T159, T160
Acceptance:
- [ ] Playwright with SwiftShader: 3D screenshots of fixtures (top + iso), fallback path, playback to end; axe on the 3D controls
Tester focus: run suite twice → stable screenshots; review all images.

---

## M7: Dizilim yükseltmeleri (exit: 3 modes, true-shape nesting with rotation, offcuts, edge-band deduction)

### Batch B22: T162–T164 (modes and options)

### T162 Nesting modes and objective weights   [status: todo]
Spec: §6.2 · Depends: T114
Acceptance:
- [ ] `setNestingMode`: minWaste / fastest (cut length λ) / minToolChanges (μ); one objective function with weights per mode; cut length estimated from the toolpath model
- [ ] benchmarks per mode in `__bench__`; deterministic
Tester focus: each mode wins its own metric on the benchmark set; property tests unchanged.

### T163 Nesting options UI, worker progress and cancel   [status: todo]
Spec: §3.6, §6.2 · Depends: T162
Acceptance:
- [ ] layout step panel: mode cards, gap, margin, offcut use, rotation policy; run in worker with progress and "İptal"; results kept per option set
Tester focus: cancel leaves the old layout intact; UI never freezes (long task < 50 ms) with 500 parts.

### T164 Multiple stock sheet sizes   [status: todo]
Spec: §6.2 · Depends: T121, T162
Acceptance:
- [ ] stock = list of sheet sizes with quantity limits (from the material library); placer picks sizes to minimise the objective; report per size
Tester focus: quantity limit respected; property tests across mixed sizes.

### Batch B23: T165–T167 (true-shape nesting)

### T165 True-shape engine I: footprints and collision   [status: todo]
Spec: §6.2 (v3) · Depends: T113 · Decision: D-034
Acceptance:
- [ ] footprint = outline offset by tool radius + gap/2 (own offset), arcs discretised for collision only (cutting geometry stays exact)
- [ ] deterministic bottom-left placement over candidate positions with exact polygon overlap tests (spatial index); inside sheet minus margin
- [ ] fast-check: no overlap of footprints, inside the sheet, deterministic
Tester focus: property tests; exact overlap re-check with a different algorithm in the test.

### T166 True-shape engine II: rotations and part-in-hole   [status: todo]
Spec: §6.2 · Depends: T165
Acceptance:
- [ ] rotation candidates from `allowedRotations` (grain) plus a free-part step policy (90° default, 45°/15° options); optional small parts inside large inner cutouts
- [ ] grain rule property: fixed parts only at grain-aligned angles
Tester focus: grain property tests; part-in-hole never overlaps the hole's toolpath zone.

### T167 Engine selection and utilisation benchmark   [status: todo]
Spec: §6.2 · Depends: T166
Acceptance:
- [ ] rectangles at axis angles → MaxRects; freeform or non-axis grain parts → true-shape (mixed jobs: true-shape for all); time budget 300 parts ≤ 10 s in the worker
- [ ] benchmark: utilisation gain vs the rotated-bbox fallback reported in the PR
Tester focus: time budget; utilisation numbers; deterministic re-run.

### Batch B24: T168–T171 (offcuts, edge band, layout editing)

### T168 Offcut stock   [status: todo]
Spec: §2.4, §3.4, §6.2, §9.1 · Depends: T164
Acceptance:
- [ ] after nesting, rectangular leftovers ≥ 300×300 (setting) proposed; user confirms → `offcuts` row (material, thickness, size, grain, source project); next nesting of the same material/thickness tries offcuts first; "Artık parçalar" tab under Projeler
Tester focus: offcut used first in the next project; status changes to used; tenancy test.

### T169 Edge band deduction   [status: todo]
Spec: §4.8 · Depends: T119
Acceptance:
- [ ] project setting "girilen ölçü bitmiş ölçü": cut size = finish − band thickness per edge; shown in the grid (finish and cut size) and used by nesting/toolpath
Tester focus: dimensions hand-checked for all edge combinations; toggle is undoable.

### T170 Layout editing upgrades   [status: todo]
Spec: §6.2 · Depends: T166
Acceptance:
- [ ] rotate a dragged part through its allowed angles (R key), snap to neighbours at gap distance, multi-select lock/unlock, "kilitsizleri yeniden diz"
- [ ] invalid drops still never committed (`LOCKED_PLACEMENT_INVALID`)
Tester focus: a fixed-grain part cannot be rotated off-grain by the UI; drag e2e.

### T171 Layout view polish: numbers, stats, legend   [status: todo]
Spec: §2.4, §6.5 · Depends: T170
Acceptance:
- [ ] part numbers consistent with PDF/labels, per-sheet stats (parts, utilisation, cut length), legend, minimap for many sheets (labels, dimensions and the utilisation bar already come from T196; this task adds the rest)
Tester focus: numbering consistent across layout, simulation, 3D; visual.

---

## M8: Export, etiket, proje yönetimi (exit: NC, DXF, PDF and labels from the server; projects, home and settings complete)

### Batch B25: T172–T174 (PDF)

### T172 PDF engine and layout pages   [status: todo]
Spec: §6.6, §8.3 · Depends: T171
Acceptance:
- [ ] pdf-lib + embedded Turkish-capable font (OFL); A4/A3 landscape sheet pages with numbered parts, grain arrows, dimensions; generated on the server from the saved revision; deterministic bytes (fixed metadata dates)
Tester focus: Turkish characters (ğüşıöç İ) render; same input → same hash; page count = sheets.

### T173 PDF part list, edge bands, waste report   [status: todo]
Spec: §6.6, §4.8 · Depends: T172
Acceptance:
- [ ] numbered part list (name, finish/cut size, qty, grain, banded edges marked), waste % and area, sheet count, estimated cut time
Tester focus: numbers vs layout data; banded edge marks for all 4 edges.

### T174 Part labels   [status: todo]
Spec: §2.4, §6.6 · Depends: T172
Acceptance:
- [ ] label sheet presets (A4 3×8, 2×7, custom mm grid); label: project, part number, name, size, grain arrow, edge band glyph, sheet number; print offset calibration setting
Tester focus: label count = total pieces; print preview screenshot; long names truncated, not overflowing.

### Batch B26: T175–T177 (DXF export, export step, report)

### T175 DXF writer   [status: todo]
Spec: §6.6, §4.6 · Depends: T145
Acceptance:
- [ ] own writer: layout (sheets side by side) and single parts; layers per operation (DIS_KESIM, IC_KESIM, CEP, DELIK, CIZGI); arcs as bulges; round-trip test with our importer (= same contours within EPS)
Tester focus: round trip; opens in a free viewer (LibreCAD) without errors (manual screenshot).

### T176 Export step: all formats, records, history   [status: todo]
Spec: §6.6 · Depends: T173, T174, T175
Acceptance:
- [ ] export step offers NC, DXF, PDF, labels; each regenerated on the server and stored in `exports` with type, hash, revision; history shows all types; NC rules unchanged (checks, acceptance)
Tester focus: NC gate cannot be bypassed by the new UI; hashes stable; history entries per type.

### T177 Project report card   [status: todo]
Spec: §6.6 · Depends: T176
Acceptance:
- [ ] report summary (waste %, area, sheets, estimated time, part count) on the project page and as data for the home page
Tester focus: values equal the PDF report values.

### Batch B27: T178–T180 (projects and home)

### T178 Projeler page: search, filter, copy, delete   [status: todo]
Spec: §3.4 · Depends: T111
Acceptance:
- [ ] table with name, status, machine, material, date; search (Turkish folding), filters (status, machine, material), sort, pagination; copy project (new id, revision 1, exports not copied); soft delete with undo toast
Tester focus: e2e search/filter/copy; deleted project hidden but restorable; tenancy unchanged.

### T179 Project status flow and re-export   [status: todo]
Spec: §3.4, §6.6 · Depends: T176, T178
Acceptance:
- [ ] taslak → üretildi (after a successful NC export) → tamamlandı (manual); re-export from history regenerates from that revision
Tester focus: status transitions; re-export of an old revision gives the same hash as before.

### T180 Ana sayfa with real data   [status: todo]
Spec: §3.4 · Depends: T177, T178
Acceptance:
- [ ] recent projects, machines needing verification, waste summary chart (last 30 days, accessible colours), quick actions
- [ ] project cards use a larger layout thumbnail (16:10, sheet with material tint and part outlines, plate count as stacked sheets) or the 3D PNG from T160 when one exists
Tester focus: numbers match seeded data; chart readable in dark mode; axe.

### Batch B28: T181–T183 (machines and settings)

### T181 Machine maintenance and controller library   [status: todo]
Spec: §3.4, §7.1 · Depends: T107
Acceptance:
- [ ] manual maintenance log (last date, interval days, note) with reminder badge on Makineler and Ana sayfa; controller-family library pre-fills a new profile (generic, Mach3)
Tester focus: reminder appears when overdue (fixed clock in test); pre-fill values match the post configs.

### T182 Ayarlar: company, defaults, layer mapping   [status: todo]
Spec: §3.4 · Depends: T121, T145
Acceptance:
- [ ] company name + logo upload (size/type limits), defaults (gap, margin, tabs, lead-in, edge-band mode), DXF layer mapping editor, material defaults link
Tester focus: defaults used by a new project; upload limits; axe.

### T183 Ayarlar: appearance and preferences   [status: todo]
Spec: §3.7 · Depends: T182
Acceptance:
- [ ] theme, density (comfortable/compact; the compact tokens exist since T195, this adds the user setting), 3D simple mode, reduced motion override, shortcuts list
Tester focus: preferences persist and apply on reload; compact density screenshots.

---

## M9: Cila ve saha hazırlığı (exit = ~90 % line: field-test ready, owner sign-off)

### Batch B29: T184–T186 (onboarding, accessibility, performance)

### T184 Onboarding and sample project   [status: todo]
Spec: §4.2 · Depends: T180
Acceptance:
- [ ] first run: welcome dialog, sample project (cabinet + hinge doors), guided tour of the 5 wizard steps; can be reopened from Ayarlar
Tester focus: first-run only; sample project exports a valid NC.

### T185 Accessibility sweep   [status: todo]
Spec: §3.7, §11 · Depends: T184
Acceptance:
- [ ] keyboard-only completion of the whole flow (cut list → nest → 3D/simulation → export); AA contrast in both themes; landmarks, labels; zero serious/critical axe violations on all routes
Tester focus: keyboard-only e2e; axe report for every route; screen-reader spot check of the GrainDial and cut list.

### T186 Performance sweep   [status: todo]
Spec: §8.2 · Depends: T184
Acceptance:
- [ ] budgets: initial JS ≤ 250 kB gzip per route (3D/editor lazy), LCP ≤ 2.5 s on the local prod build, 2 000-row cut list usable, nesting 300 parts ≤ 10 s without UI freeze
Tester focus: bundle report; Lighthouse CI numbers; long-task count during nesting.

### Batch B30: T187–T189 (resilience, responsive, G-code regression)

### T187 Error handling and resilience   [status: todo]
Spec: §8.2 · Depends: T105
Acceptance:
- [ ] offline/save-failure banner with the unsent queue count, retry; revision conflict dialog (reload / keep mine as copy); client errors logged to a local server log
Tester focus: kill the server mid-edit → queue → recover without loss; conflict dialog e2e.

### T188 Responsive and touch pass   [status: todo]
Spec: §3.7 · Depends: T185
Acceptance:
- [ ] 390 / 768 / 1024 / 1440 layouts for every route; touch for editor pan/zoom/select and 3D orbit; tablet workshop use (large hit targets ≥ 40 px). The canvas-first rule for steps 3–4 is already done in T198; this pass covers the remaining routes and the editor
Tester focus: screenshot matrix of all routes at 4 widths; touch emulation e2e.

### T189 G-code regression set for the new operations   [status: todo]
Spec: §7.2, §11 · Depends: T143, T167 · **Human gate: golden files (`needs-human`)**
Acceptance:
- [ ] golden fixtures for both posts: holes + pockets + grooves, inner contours, arcs, rotated grain parts, true-shape layout, thin skin
- [ ] one broken-G-code test per §7.2 rule for each new operation type
Tester focus: full safety review; golden list prepared for the owner's approval.

### Batch B31: T190–T193 (final e2e and field-test readiness)

### T190 Full regression e2e scenarios   [status: todo]
Spec: §11 · Depends: T189
Acceptance:
- [ ] 5 scenarios in CI: cabinet + hinge doors, DXF sign letters, grain-rotated panels, mixed holes/pockets, offcut reuse; each: input → nest → 3D → simulation → NC + PDF + DXF + labels; all checks pass
Tester focus: run the suite; review every NC with the safety checklist.

### T191 Field-test kit   [status: todo]
Spec: §7.3, §12.3 · Depends: T190
Acceptance:
- [ ] extended test program (holes, pocket, groove, arcs, inner contour) + measurement form fields; printable field checklist PDF (origin, Z zero, tool, air cut first); `docs/machines/_template/` for the info collection; air-cut/test exports recorded
Tester focus: safety review of the extended test program; air-cut floor (D-031) holds for the new operations.

### T192 In-app help and "Yenilikler"   [status: todo]
Spec: §8.2 · Depends: T190
Acceptance:
- [ ] Turkish help pages (getting started, cut list, drawing, grain, 3D, export, air cut) linked from the palette; "Yenilikler" dialog per release
Tester focus: links work; text in `tr.json`; axe.

### T193 Field-test readiness review   [status: todo]
Spec: §12.1 · Depends: T191, T192 · Owner: PO + tester · **Human gate: owner sign-off**
Acceptance:
- [ ] checklist: all M2–M9 exits met, known issues list, open spec items (§14.2) that affect the test, machine info (§12.3) collected; question to the owner via the dashboard
Tester focus: final full run (unit, property, golden, e2e, visual, axe, perf) with one summary report.

---

## Field test 1 (owner)   [status: todo]
Spec: §12.1, §12.3 · Depends: T193 (old "Saha 1" and "Saha 2" merged)
- [ ] machine info (§12.3) in `docs/machines/<machine>/` with 2–3 working NC files per machine
- [ ] post config adapted to the real controller (new post version + golden files, owner approval)
- [ ] air cut, then test cut on scrap: outer contour, holes, pocket, groove, arcs, rotated grain part; measurements in tolerance; "NittCam test etti" record
- [ ] every field bug first becomes a failing test (§11)

---

## After the field test (outline; detailed tasks written before each milestone starts)

### M10: Hesap ve çok şirket (T200+)
Better Auth verification; login screen with the intro animation (§3.2); companies, users, roles (Yönetici / Operatör) checked on the server; replace the default company/user; Postgres RLS on company_id and triggers on version tables; quick user switch for shared workshop PCs; hosting decision (§8.5).

### M11: AI sohbet (T220+), behind Q001
Chat panel, command proposals with Uygula/İptal, warning badge, template update question, messy order reading, quota (§5). Not part of the ~90 % line (D-035).

### M12–M14: Pilot, Ticari, Büyüme
As spec §12.1.
