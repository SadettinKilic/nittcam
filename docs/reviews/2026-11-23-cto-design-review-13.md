# CTO review #13 and T193 field-test readiness review (2026-11-23)

Scope: `origin/main` @ `42258a0` (B53, B62, B61 on main). **B63 (PR #200)** and **B60 (PR #192)** are
not on main; their PR bodies were read and they are counted as "landing". Conclusions that depend on
them are marked. Previous review: `2026-11-20-cto-design-review-12.md`.

The next step is the owner's first machine test: a Mach3 router with a manual tool change, MDF 18 mm,
air cut first, then a test cut on scrap. This review is the last gate before the PO tells the owner
"hazır" or "şu eksik".

Method:

- Production build of main in a separate worktree, fresh PGlite, port 3600, Playwright at 1440 × 900,
  light theme. The server was stopped afterwards.
- The field-test path was walked once as the operator: Makineler → machine form → verification (air
  cut, approve, test cut) → field kit (screen and print) → new project → "Dolap ekle" (MDF 18) → door
  with the hinge and handle templates → Dizilim → Simülasyon / Kesim ayarları → export checklist → NC,
  layout DXF, A4 PDF, labels. A second cabinet run used "Parça arası pay" 8 and "Kenar payı" 16.
- Six Mach3 files were read: `AIRCUT_S1`, `TESTPARCA_S1`, `AIRCUT_GENIS_S1`, `TESTPARCA_GENIS_S1`, the
  cabinet job (`Adsiz_proje_r3_S1.tap`, 539 lines, T1 Ø6 → T2 Ø8) and the second cabinet run. Each
  went through the repo's independent check (`verifyDownloaded`), my own line lint (a Node script that
  shares no code with the repo) and reading by eye. A second script looked at what each tab is
  attached to.
- 16 screenshots are in `2026-11-23-cto-13/`.

Not done: park on (G53) was not exercised (the tester did, and B63 changes the program end); the PDF
and labels were downloaded but not rendered (no PDF reader on this PC, and B63 changes the sheet
page); dark theme, 390 px, axe and the e2e suite were not run; no whole-app design sweep (Ayarlar,
Projeler, Ana sayfa were not revisited). Product code, DECISIONS and the goldens were not touched.

## Verdict

**Ready for the air cut. Ready for the test cut on scrap once two small fixes land, or today with the
two settings in the runbook. Not ready to cut a nested job at the default part clearance.**

The programs are clean: all six files pass the independent check and my lint with no finding, and the
rehearsal blockers B1 and B2 are really closed on main. Two things found in this review are not in
the tester's report, and both are about losing a part:

- **F1.** With the default part clearance (tool Ø + 0,1 mm) a tab on an edge that faces a neighbour
  is cut away by the neighbour's own pass. In the cabinet job 10 of 24 tabs hold nothing. The screen
  and the NC header still say 24 / "4 per part". No rule, checker or test looks at this.
- **F2.** The extended test part (300 × 200) is cut free: its outer contour has no tab.

Neither stops the air cut. Both have a workaround that needs no code, written into
`docs/machines/saha-gunu.md`.

## Scores

| Heading | #10 | #11 | #12 | #13 | Note |
| --- | --- | --- | --- | --- | --- |
| Corporate image / brand | 8 | 8,5 | 8,5 | **8,5** | Not re-swept; the screens on the field path are consistent |
| Modernity | 9 | 9 | 9 | **9** | Unchanged |
| Usability | 8,5 | 8,5 | 8,5 | **8,5** | The path has no dead end; held back by the example-profile trap (F3) and a tab count that is not true (F1) |
| Readiness of M4–M7 | 9 | 9 | 9 | **9** | No regression seen on the path |
| Field-test readiness | 7 | 7,5 | 8 | **8** | See below |

**Field-test readiness: 8 / 10.** B62, B61 and the field kit raised it; F1 and F2 take the same amount
back. What keeps it from 10:

| Gap | Worth | Closes with |
| --- | --- | --- |
| F1 voided tabs at the default clearance | −0,5 | M1, or the runbook setting |
| F2 extended test part cut free | −0,25 | M2, or skipping that file |
| B63 not on main (program end at park, vacuum-by-hand line, PDF names the NC file) | −0,25 | PR #200 landing |
| The mach3 post has never run on a machine; every Mach3 setting it relies on is unverified | −0,5 | the air cut itself |
| No machine information (`docs/machines/` holds only the template); the owner tests on a profile he has not created yet | −0,5 | the bring-list and step A of the runbook |

With M1, M2 and B63 on main the score is 9. The last point is only earned at the machine.

## 1. The field-test path in the app

| Step | Result | Finding |
| --- | --- | --- |
| Makineler, machine form | Works. One page, 11 sections, the feed-ceiling fields of B62 are there with a clear hint | The banner says "Bu bir örnek profildir" but does not say the example can never become verified (F3). "Vakum kapat kodu" hint says "Örnek: M7" (should be M9) |
| Verification | Works. Air cut needs the acceptance tick, the test cut is locked until "Air cut'ı onayla", four observation ticks are required | The side box lists three reasons the file stays "DOĞRULANMADI"; the second is the only place that tells the owner to create his own machine |
| Field kit, screen and print | Works. The print view is clean (one column, tick boxes, measurement form). "Mach3 ön kontrol" has the 7 lines of B62 | No word on where clamps or screws may sit, or how high they may be (F4). The bring-list names only T2 Ø8; any job with a hole or pocket also needs T1 Ø6. The air cuts have no mid-program tool change (F5) |
| New project, "Dolap ekle" | Works. 5 rows, 6 pieces, default MDF 18 | None |
| Door: hinge + handle templates | Works. Both arrive as "Doğrulanacak" | In the side panel the "Doğrulanacak" badge overlaps the template name and the delete button; "Çap · screw" is an English leftover (polish) |
| Dizilim | Works. 1 sheet, fire 62,8 % | The default clearance 0,1 is the cause of F1 and of the lead warning below. The note explains the arithmetic (Ø8 + 0,1 = 8,1) but not the consequence |
| Simülasyon | "Kontroller geçti · 1 uyarı". The warning is true and actionable: "Giriş/çıkış hareketi yer olmadığı için kaldırıldı … Dizilim adımında parça arası payı artırıp yeniden dizin" | "Köprü (tab) 24" is not true at this clearance (F1). The manual-change note ("1 kez durup takım ister … Z'yi yeniden sıfırlayın") is good |
| Kesim ayarları | Works. Tabs "Her parçada" 4 × 10 × 3 by default, entry Yay, plunge Dik dalma, Climb | None |
| Export checklist | Works. Six lines must be ticked, all in plain Turkish: origin, tool order, manual change + Z re-zero, park-off warning, unverified templates, air cut | "Tahmini kesim süresi 12 dk" against "≈ 11 dk 12 sn" in Simülasyon (known polish) |
| NC, DXF, PDF, labels | All four download; the NC passes the independent check (8 loops of 8) | PDF and labels not rendered here |

Every blocking or warning message met on the path was true, in Turkish and said what to do, with the
one exception of the tab count. Nothing on the path is a dead end.

## 2. The Mach3 programs, read line by line

Checked against `docs/machines/controllers/mach3.md` §2–§7 and §12.

| Point | What the files do | Judgement |
| --- | --- | --- |
| Preamble | `G21 G90 G91.1 G17 G40 G49 G54` is the first code line in all six | Right; independent of the Mach3 "Initial State" |
| First move | `G0 Z20.0000` (air cuts `G0 Z58.5000`), Z only | Right |
| Hold-down | `M7` right after the first move, before the first-tool pause; `M9` at the end | Right order. Depends on the M7 output (kit line 3) |
| First-tool pause | `(TAKIM T1 D6.000 TAKILI MI? DEVAM ICIN CYCLE START)`, `M0`, then `G0 Z20`, `M3 S18000`, `G4 P5.0` | Right. The spindle has not been started yet at this pause |
| Spindle start | `M3 S18000` then `G4 P5.0` before any feed move, also after the tool change | Right. Depends on the dwell unit (kit line 1) and on M3 really starting the spindle (air-cut observation) |
| Approach and plunge | XY rapid at Z 20, `G0 Z2.0000`, then `G1` down at F1500. No rapid ends below Z 2, no XY rapid below Z 20 (lint: 0) | Right |
| Depth | Deepest Z −18,5 = 18 + 0,5 allowance in every cutting file. Cups −12, test pocket −9, groove −2. Air cuts never below +20 | Right |
| Holes and cups | Ø35 cup: helix down, then rings outward, 0,75 mm per half turn. Ø6 through holes with the Ø6 tool: straight pecks at F1500 with a rapid back to Z 2 | Works only with a centre-cutting (plunge-capable) bit. The profile calls both tools "Düz freze"; a brazed straight bit that does not cut at the centre will burn or break here. In the bring-list |
| Contours | 4 passes of 4,625 mm, arc lead in and out (R4), clockwise around the outside = climb with M3. Step-down in the existing kerf at F1500 | Right for MDF with Ø8 at 6000 / 18 000 (chip load ≈ 0,17 mm) |
| Tabs | Last pass only: `G1 Z-15.0000 F1500`, 18 mm along the edge, `G1 Z-18.5000 F1500`. On straight edges only | Geometry right (3 mm high, 10 mm wide at the narrowest). **What they are attached to is not checked: F1** |
| Tool change | `G0 Z20.0000`, `M5`, `(TAKIM DEGISTIR: T2 D8.000 - Z SIFIRLA - SONRA CYCLE START)`, `M0`, `G0 Z20.0000`, `M3 S18000`, `G4 P5.0` | Right order, M0 never M1, the message names the tool and the re-zero. Mach3's M0 does not stop the spindle by itself; the `M5` before it does |
| Feeds | Level F6000, down F1500, every first feed after a rapid carries F. T1 Ø6 also runs F6000 | Within the machine ceiling (rapid 10 000). Ø6 at 6000 is on the high side for a first cut; the 50 % override in the runbook covers it |
| Arcs | G2/G3 with incremental I/J, start and end radius equal to 4 decimals, no R word, sweeps ≤ 180° | Right for Mach3's 0,002 mm tolerance |
| End | `G0 Z20.0000`, `M5`, `M9`, `M30` over the last part | Safe. B63 moves the end to the park point when park is on (not on main; not read here) |
| Format | CRLF, ASCII only, longest line 82, names ≤ 24 characters, 270–539 lines | Right. Above 500 lines a demo licence stops (kit line 2) |

### Findings from the reading

**F1. Tabs on an edge that faces a neighbour hold nothing (default clearance).**
The nest puts neighbours tool Ø + 0,1 mm apart (D-104). Part A's kerf is the 8 mm beside its edge;
part B's kerf is the same 8 mm shifted by 0,1 mm. A tab is material left in the part's own kerf, so
B's full-depth pass removes A's tab (what remains is a 0,1 mm stub), whichever part is cut first.
D-104 says "the two kerfs never meet"; they overlap by 7,9 mm of 8.

Evidence, cabinet job at the defaults (`Adsiz_proje_r3_S1.tap`): the door's tab at X 606,0 Y 207–225
(line 513, right edge) lies under the neighbour's full-depth pass `G1 Y505.5784` at X 606,1, Z −18,5
(line 463), which ran earlier over the same strip. In total 10 of 24 tabs are cut through by a neighbour at 0,1 mm offset; every
part keeps 2 or 3. The door, cut last, keeps two, both on the sheet-edge side where the margin of 10
leaves a 2 mm strip of MDF between kerf and sheet edge to hold on to. With "Parça arası pay" 8 and
"Kenar payı" 16 the same job has 0 voided tabs, still one sheet, and the lead warning is gone.

Why it matters: the big cabinet parts will stay put on a working vacuum table. A small part between
neighbours (the rehearsal's four 80 × 50 blocks side by side) can lose every tab and come free under
the cutter. The small-part rule (§6.3) guarantees tabs are *written*, not that they are *attached*.
Simülasyon ("Köprü 24"), the NC header ("kopru her parcada 4 adet") and the checker (it matches the
program to the model) all pass it.

**F2. The extended test part is cut free.** `TESTPARCA_GENIS_S1.tap` is built with
`cutting: { tabs: { auto: false } }` (`packages/core/src/testcut/extended.ts:177`), i.e. "yalnız küçük
parçada". The part is 300 × 200 = 60 000 mm², above the small-part limit of 50 000 mm², so its outer
contour goes to Z −18,5 all the way round (lines 256–266) with no tab. The inner window slug has 3.
The 200 × 200 test part (40 000 mm²) gets 4 tabs by the same rule. On a 400 × 300 scrap that is
clamped or screwed, the vacuum does not hold the part, and it is free on the last pass.

**F3. The owner is not told plainly to create his own machine.** The seeded machine is an example
(`example: true`) and stays "DOĞRULANMADI" after a perfect test cut. The only hint is the second
bullet of a side box. A first-time operator will verify the example.

**F4. Fixturing is not in the field kit.** The kit says "Fire plakayı tablaya sabitleyin" and nothing
about where. The 200 × 200 program cuts between 42 and 258 mm on a 300 × 300 scrap and crosses the
sheet at Z 20 above the material: a clamp inside the 40 mm band or taller than 20 mm is in the way.
The software cannot know clamps; this layer is the printed page only.

**F5. No air cut exercises the mid-program tool change.** Both air cuts use T2 only, so
`M5` → message → `M0` → re-zero → Cycle Start → `G0 Z20` → `M3` → dwell is first seen in the cabinet
job, with material under the tool. The runbook adds a dry pass of the real job with Z zero raised
40 mm.

### Mach3 settings the files depend on, against the kit's pre-check

| Dependency | In "Mach3 ön kontrol" | Note |
| --- | --- | --- |
| `G4 P5.0` in seconds | Yes, line 1 | The one that can hurt most |
| Licence (500-line limit) | Yes, line 2 | |
| M7 / M9 output | Yes, line 3 | Runbook adds: try `M7` in MDI before any file |
| S word or VFD by hand | Yes, line 4 | |
| **M3 really starts the spindle** (relay) | **No** | `mach3-saha-kontrol.md` row 7 has it; the kit dropped it. Covered by the air-cut tick "spindle" and by step A.4 of the runbook. SHOULD |
| Homing for G53 | Yes, line 5 | Park stays off for this test |
| Motor Tuning velocity ≥ feeds | Yes, line 6 | |
| Program end / M30 options | Yes, line 7 | |
| `G91.1` accepted, arc tolerance | No (air-cut observation in `mach3-saha-kontrol.md`) | Fine as an observation; "dur" list item 3 |
| Native units mm | No | The file writes G21; low risk. Note the value |
| M0 leaves the spindle as it is | n/a | The post writes `M5` first; checker `TOOL_CHANGE_SPINDLE_ON` |

## 3. Safety net audit

Five worst outcomes on this machine. "Validation" = before the toolpath; "checker" = the independent
reader on the written file (`packages/core/src/gcode-check/rules.ts`); mutation ids are in
`gcode-check/mutations.testing.ts`, run by `check.mutation.property.test.ts` on every fixture of
both posts.

| # | Outcome | Validation / generator | Independent checker | Tests | Rests on one layer? |
| --- | --- | --- | --- | --- | --- |
| 1 | Crash into a clamp, stop or the table edge | `MARGIN_BELOW_TOOL_RADIUS` (error, margin ≥ tool Ø) `validate/index.ts:594`; leads fitted inside the sheet `toolpath/build.ts:456–481` | `CUTTER_OFF_SHEET` `rules.ts:591`, `XY_RAPID_BELOW_SAFE_Z` `:449`, `OUT_OF_ENVELOPE` `:359`, `MACHINE_MOVE` (G53 only at the park point) `:305`, `TOOL_UNKNOWN` fails closed `:577` | `gcode-check/cutter-on-sheet.test.ts`, `b62-cutter-on-sheet.tester.test.ts`, `b62-fix-r1.test.ts`, `toolpath/lead-sheet-edge.field.tester.test.ts`; mutations `R2-xy-rapid-low`, `R6-X-beyond` | The sheet edge: three layers. **A clamp on the sheet, or taller than safe Z 20: no layer in the software, only the printed page (F4)** |
| 2 | Plunge at rapid, or far too fast | `FEED_OUT_OF_RANGE` `validate/index.ts:480`, `MACHINE_FEED_ABOVE_MAX` `:511`; post refuses a descent above the plunge feed `post/generate.ts:632` | `RAPID_INTO_MATERIAL` `rules.ts:460`, `RAPID_BELOW_CLEARANCE` `:467`, `PLUNGE_TOO_FAST` `:489`, `FEED_ABOVE_MACHINE` `:532` | `post/post.safety.tester.test.ts`, `post.rules.test.ts`; mutations `R3-plunge-as-rapid`, `R3-plunge-fast`, `R3-below-clearance` | In the file: three layers. **A wrong or missed Z zero after the manual change makes a correct file plunge at rapid: procedure only** (M0 message, checklist tick, runbook) |
| 3 | Cut through the spoilboard | Through-cut target = thickness + allowance `toolpath/build.ts:808`; blind depths `HOLE_DEPTH_NOT_BELOW_THICKNESS` `validate/index.ts:220`, `POCKET_DEPTH_NOT_BELOW_THICKNESS` `:727` | `BELOW_SPOILBOARD_ALLOWANCE` `rules.ts:376`, no rounding tolerance | `post/post.zround.test.ts`, `gcode-check/check.unit.test.ts`; mutation `R6-too-deep` | Three layers for the file. A sheet thinner than typed, or Z zero on the wrong surface, is procedure (runbook C.2, bring-list 14) |
| 4 | Lose the part | Small part gets ≥ 2 tabs or a bounded skin: `SMALL_PART_UNSECURED` `toolpath/build.ts:575`, `SMALL_PART_TAB_TOO_SMALL` `:616`, `SMALL_PART_SKIN_OUT_OF_BOUNDS` `:685`; `INNER_SLUG_UNSECURED` `validate/index.ts:764` | **None about holding.** The checker only matches the program to the model (`match.ts`), so a tab that is written passes | `toolpath/tabs.test.ts`, `tab-bounds.test.ts`, `toolpath.tabs.safety.test.ts`, `tab-bounds-*` goldens, `tabs-short.t334.test.ts` (B63) | **One layer (the generator), and it has a hole: F1 and F2.** No layer asks whether a tab is attached to anything |
| 5 | Cut with the spindle off or not at speed | `SPINDLE_RPM_OUT_OF_RANGE` `validate/index.ts:460`; post writes `M3 S` + dwell after every start | `CUT_SPINDLE_OFF` `rules.ts:497`, `WARMUP_MISSING` `:501`, `SPINDLE_NO_RPM` `:250`, `SPINDLE_RPM_RANGE` `:254`, `TOOL_CHANGE_SPINDLE_ON` `:277` | `manual-stop.t311.test.ts`, `manual-stop-tester.test.ts`; mutations `R4-no-M3`, `R4-no-G4`, `R4-short-G4`, `R4-M5-mid` | In the file: three layers. **On the machine it rests on two Mach3 facts no software can see: the dwell unit and whether M3 switches the spindle.** Kit line 1 and the air-cut tick are the only guard |

Reading: rows 1, 2, 3 and 5 are well covered for everything a file can get wrong; what remains is on
the operator's side and is in the runbook. Row 4 is the weak one and is where both new findings are.

## 4. T193 checklist

### Milestone exits

Judged from BACKLOG status, the exit specs and this walk; the full suite was not rerun by me (the
tester's final run is the other half of T193).

| Milestone | Exit | Met |
| --- | --- | --- |
| M2 | Every screen in the new design; visual + axe in CI | Yes |
| M3 | Free-angle grain respected from cut list to G-code; cut list editable | Yes (rehearsal job C: rotated grain parts confirmed by the checker) |
| M4 | A drawn freeform part gives checked G-code | Yes (`b13-m4-exit.spec.ts`; rehearsal job B) |
| M5 | Hinge door from a template and a DXF sign job give checked G-code | Yes (this walk: door with both templates, check ok) |
| M6 | 3D preview, perf budget, 2D fallback | Yes; one perf spec is on the flaky watch list |
| M7 | Three modes, true-shape nesting, offcuts, edge band | Yes. T306 (positions on the 0,001 grid) lands with B60 |
| M8 | NC, DXF, PDF, labels from the server; projects, home, settings | Yes, closed 2026-11-21 |
| M9 | Field-test ready, owner sign-off | T184–T192 done. **Not met until M1 and M2 below land (or the owner accepts the runbook workaround), B63 lands, and the owner signs off** |

### Known issues

| Issue | Matters at the field test |
| --- | --- |
| F1 voided tabs at the default clearance | **Yes** (M1 or runbook setting) |
| F2 extended test part cut free | **Yes** (M2 or skip the file) |
| F3 example profile cannot be verified, not said plainly | Yes, costs time and a wrong record (S1; runbook step 1) |
| F4 fixturing not in the kit | Yes (S2; runbook C.1) |
| F5 no air cut with a tool change | Yes (S3; runbook E.2) |
| Template sizes unverified (hinge cup 22,5 mm from the edge, Ø35 × 12; handle 128) | Yes: measure against the real hardware (bring-list 16) |
| Ø6 holes cut by plunging the Ø6 tool; both tools typed "Düz freze" | Yes: bring plunge-capable bits (bring-list 11) |
| Time estimate not calibrated; 12 dk on the report card, ≈ 11 dk 12 sn in Simülasyon | No (write the real time down) |
| Park off: tool stays above the sheet at a change and at the end | No for this test (park stays off on purpose) |
| Polish queue: P1 and P2 partly open, about 25 items | No |
| Flaky watch list: `b07-cutlist-tester-r3:247` (390 touch), `b21-preview3d-perf:69`, `t187`, `b39-p4:54`, `b13a-tester:145`, `geometry/offset.property` | No (none on the NC path) |
| Persona reports, parked: Syntec / NcStudio posts, cabinet options (rails, shelf setback, hinge plate holes), import mapping of band headers, offcut share of fire, barcode / roll labels, dogbone hint, zoom to selection | No |
| Persona reports, fixed since: edge band, door mirroring, grain "Var", drill only drills, one warning state, per-tool feed, ramp entry, blind pocket, park, file-name limit | n/a |
| Phone widths only "do not break" (D-043) | No, unless the owner uses the phone at the machine for more than reading |
| B60 not on main: an edit made within a second of closing the tab can be lost | Low: wait for "Kaydedildi" before closing |

### Open spec items (§14.2) that affect the test

| Item | Effect |
| --- | --- |
| Controller brand and model of the two test machines | Half open: machine 1 is Mach3 (version unknown); machine 2 unknown. "Saha 1" asks for two machines; this test covers one |
| File extension, tool change, hold-down, Z zero method | Assumed `.tap`, manual, vacuum on M7, material top. All four are bring-list items; hold-down and Z zero change what is safe |
| Old controller limits (name length, size, arcs, line numbers, drill cycles) | Assumed 32 characters, arcs yes, no N words, no cycles. The demo limit of 500 lines is the one to check |
| Template sizes from the maker | Open; the checklist line and the NC header say so |
| The rest of §14.2 (pricing, brand, legal, hosting) | No effect |

### Machine information (§12.3)

Not collected: `docs/machines/` holds `_template/` and `controllers/` only. What the owner must bring
and find out is one ordered list of 20 lines, each with its reason, in `docs/machines/saha-gunu.md`
("Yanınızda götürün"). It merges §12.3, the tester's 14 items and the 15 rows of
`mach3-saha-kontrol.md`.

## 5. What to do

### MUST before the machine (2 tasks; numbers by the PO)

**M1. A tab must be attached to something.**
Why now: safety (lost part) and a screen that states an untrue count. Spec §6.3 · D-104.

Acceptance:
- [ ] one rule in core decides whether a tab holds: the material beyond its kerf (to the nearest other part's kerf and to the sheet edge) is at least a set width (proposal 3 mm, beside `TAB_BOUNDS`, written to DECISIONS)
- [ ] a small part (the §6.3 rule) with fewer than 2 holding tabs is an error that blocks the export; the message names the cause and the fix ("Parça arası payı en az … mm yapın") and links to Dizilim
- [ ] other parts: a warning counted in Uyarılar and a checklist line to tick; Simülasyon's "Köprü" count and the NC header state the holding tabs
- [ ] D-104's sentence "the two kerfs never meet" is corrected
- [ ] goldens unchanged unless a golden nest has a facing tab (then PO + tester, D-051)
- [ ] if it cannot land tonight: the owner is told to use "Parça arası pay" 8 and "Kenar payı" 16 (runbook step 6), and M1 stays first in the next batch

Tester focus: four 80 × 50 parts side by side at 0,1 and at 8; a part against the sheet edge at margin 10 and 16; cabinet job at the defaults (10 of 24 today); both posts.

**M2. The extended test part keeps its tabs.**
Why now: the field kit tells the owner to cut it right after the first part.

Acceptance:
- [ ] `extendedTestProject` cuts with tabs on every part; the header says `kopru her parcada`; the outer contour has 4 tabs, none on the R20 arcs
- [ ] the kit text for the extended part says the part is held by tabs
- [ ] `testcut/extended*.test.ts` and any pinned output updated; `AIRCUT_GENIS` stays the same moves lifted

Tester focus: the downloaded file's last pass; tab count; independent check; air-cut floor.

### SHOULD (polish queue; none blocks the day because the runbook covers each)

- S1 (F3): the machine form banner and the verification page say plainly "Örnek profil doğrulanamaz: kendi makinenizi ekleyin" with a button; the field kit's first line repeats it.
- S2 (F4): field kit, test-cut step: where clamps or screws may sit for each test part (outer 30 mm band) and that they stay below safe Z.
- S3 (F5): the extended air cut uses two tools, so the mid-program change is seen without material.
- S4: "Mach3 ön kontrol" gets the dropped line "M3 spindle'ı açıyor mu?"; bring-list names every tool the kit's files and a first job need (T1 Ø6).
- S5: Dizilim's clearance note states the consequence at small values (leads removed, tabs facing a neighbour); offer 8 as a one-click value.
- S6: "Vakum kapat kodu" hint "Örnek: M9"; "Çap · screw" → Turkish; the "Doğrulanacak" badge does not overlap the template name; report card and Simülasyon round the time the same way.
- S7: tool type "dalabilen / ucu kesen" as a property, and a note when a hole is cut by plunging a tool of its own diameter.

### After the field test

- Post `mach3` 1.x from the real settings (dwell unit, vacuum code, feed ceiling), new goldens, "NittCam test etti" record.
- Calibrate the time estimate, tab size and the 0,5 mm allowance from the measurements.
- A fixture model (clamp / stop zones on the sheet) so row 1 of the safety table gets a software layer.
- Park on by default once homing is confirmed; program end at park (B63) verified at the machine.
- Second machine and the next post (order in HANDOFF: RichAuto, Syntec, NcStudio).
- Parked persona items and the open polish groups P1, P2.

## What depends on B63 and B60

- **B63 (PR #200):** the program end (park), the PDF sheet page (NC file name, tool order), the
  "vakum elle" header and checklist line, the `KOPRU AZ` header and the time estimate were **not**
  verified by me. My reading of the end sequence (`G0 Z20`, `M5`, `M9`, `M30`) is main's. The runbook
  tells the owner to leave the vacuum codes empty when the vacuum is switched by hand; the reminder
  for that case exists only with B63. The tester's read of a park-on file after B63 stays required.
  The readiness score counts B63 as landing.
- **B60 (PR #192):** no safety conclusion depends on it. It moves positions by less than 0,001 mm
  (five goldens) and closes the save-on-close loss; the walk and all line numbers here are main's.
  F1 is independent of it (the clearance is 0,1 mm, the grid 0,001 mm).

## Good (keep)

- The checker now fails closed on a manual post: the tool of every move comes from the job, an
  unknown tool is an error.
- The export checklist is the best screen on the path: six plain lines, each one a real act.
- The tool-change block: safe Z, `M5`, a message that names the tool and the re-zero, `M0`, safe Z
  again, spindle, dwell. Nothing relies on a Mach3 option.
- The field kit prints as one clean page and the Mach3 block names the menu path of each setting.
- The lead warning is honest and points at the right step.

## Decided (the owner may change)

- **K1:** a holding feature counts only when it is attached: tabs get the same "bounds in the field and in the validation" treatment as #11 K2 and #12 K2 (M1).
- **K2:** every program the field kit hands out holds its part with tabs (M2).
- **K3:** for field test 1 park stays off and the job is nested with clearance 8 / margin 16, whatever lands tonight.

## Outputs

- `docs/reviews/2026-11-23-cto-design-review-13.md`, `docs/reviews/2026-11-23-cto-13/` (16 screenshots, 1440, light).
- `docs/machines/saha-gunu.md`: runbook and bring-list for the owner (Turkish).
- `docs/BACKLOG.md`: T193 checklist marked as far as met; the owner sign-off stays open.

| Screen | Files |
| --- | --- |
| Makineler, form | `01-machines-1440-light.png`, `02-machine-form-1440-light.png` |
| Verification | `03-verification-draft-1440-light.png`, `05-verification-testcut-1440-light.png` |
| Field kit | `06-field-kit-1440-light.png`, `07-field-kit-print-1440-light.png` |
| Project steps 1–2 | `10-step1-machine-1440-light.png`, `11-cabinet-dialog-1440-light.png`, `14-door-drawing-1440-light.png` |
| Dizilim | `15-layout-1440-light.png`, `30-layout-gap8-1440-light.png` |
| Simülasyon | `16-simulation-1440-light.png`, `17-sim-cutting-1440-light.png`, `31-sim-gap8-1440-light.png` |
| Dışa aktar | `19-export-ticked-1440-light.png`, `20-export-done-1440-light.png` |
