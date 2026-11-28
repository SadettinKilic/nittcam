# CTO design and product review #15: ACM output safety, the operator flow, the plan (2026-11-28)

Scope: `origin/main` @ `48e390f9` (B68 T393–T396, B69 T399/T392/T422, MB5 T352–T354, B70 T391; earlier
the same day MB1–MB4, Montaj tezgâhı, B65/B66). Previous review: `2026-11-28-cto-review-14.md`.

Method:

- **NC reading.** ACM tray (250 × 250 blank, four fold lines, one inner cut, one small part) generated
  from `packages/core` with the example machine, a single-flute Ø6 and Ø8 set from `suggestCuttingSet`
  and a 90° V-bit; 3 mm and 4 mm; `mach3` and `generic` posts; Z zero on the material top and on the
  table. Read line by line. The same job was then built in the UI and downloaded
  (`acm-tray-4mm-ui-mach3.tap`); it matches the scripted files.
- **Checker.** 11 hand edits of the 4 mm Mach3 file, each for both Z references, through `checkGcode`
  (`r17-mutations.txt`).
- **Flow.** Production build, fresh database, port 3600, Playwright. MDF 18 (paste 5 rows, 30 parts)
  and ACM 4 mm (DXF tray with a "V-kanal" layer) from step 1 to a downloaded file at 1440 × 900 and
  1024 × 768; Montaj with "Katla (ACM)" at 1440 and 1024; 390 px only for horizontal scroll.
- Evidence in `2026-11-28-cto-15/` (9 screenshots, 3 NC files, the mutation table).

Not done: PDF and labels (T355 is in work), dark theme, axe, the 390 px flow beyond the scroll check,
arcs inside a fold line, 6 mm ACM, the aluminium path (still blocked, as intended). No product code,
golden file, DECISIONS or BACKLOG line was touched.

## Summary

The ACM program is well built where MB5 looked: grooves come first, then inner cuts, then the outline;
both contours run conventional; contours ramp in at 2°; the default hold is a 1 mm tab on every part;
the header carries the unverified-material and back-face lines; and rule R17 refused every deepened
groove I wrote by hand, on both Z references. Wood output is unchanged: since review #14 only four
golden files were added (the two ACM fixtures per post), no existing one was edited, and the golden,
checker and V-groove suites pass (1422 tests).

Three things do not hold yet, and all three sit on the path the owner will walk in the ACM machine
test. The no-straight-plunge rule for composite (spec §7.2 rule 12) is applied to the contour entry
only: the V-bit and every tab exit plunge straight into the panel, and no checker rule looks. The
V-bit runs at the contour tool's feed, not at the V-groove row of our own research. And the button
"Örnek ACM ayarlarını ekle" lands the operator on eight empty required fields on the seeded machine.

Field test 1 (Mach3, MDF 18) is not affected by any MUST. One SHOULD (S6) costs it a sheet.

## Scores

| Area | #13 | #15 | Note |
| --- | --- | --- | --- |
| Wood path (M4–M7) | 9 | **9** | No regression on the walked path at 1440 and 1024 |
| Field-test 1 readiness (MDF 18) | 8 | **8** | Unchanged; waits on the owner. S6 is worth doing first |
| ACM cut + V-groove, ready for the machine test T357 | – | **6** | M1–M3 and S1–S3 first; then 8 |
| Montaj tezgâhı + fold preview | – | **7,5** | The preview finds a real corner clash; its verdict text misleads at 0 % |

**Overall readiness: 7,5 / 10** (wood 9, the new metal surface 6).

## What the NC does (4 mm, Mach3, Ø6 single-flute set 2000 / 500 / 18 000 / 4)

| Question | Found | Verdict |
| --- | --- | --- |
| Groove depth, remaining | Z −1,6 then −3,2 (remaining 0,8); 3 mm: one pass to −2,2. Table zero: Z +2,4 / +0,8 | right |
| Order | all grooves (V-bit), `M5`, tool change with "Z SIFIRLA", inner cut, small part, outline last | right |
| Direction | outline counter-clockwise, hole clockwise = conventional with `M3`; header "yon conventional" | right |
| Contour entry | lead arc at Z 0, zig-zag ramp along the contour, 2,0°, at the plunge feed | right |
| Passes | 2 × 2,25 mm to Z −4,5 although the set says 4 mm in one pass | see P1 |
| Hold | UI default "her parçada 4 × 6 × 1 mm"; small part and slug get tabs; 1 mm = front skin + core | right |
| **Groove entry** | `G1 Z-1.6000 F500` straight down on the fold line, again for the second pass | **M1** |
| **Tab exit** | `G1 Z-4.5000 F500` straight down after every tab (1,0 mm of panel incl. the front skin) | **M1** |
| **V-bit feed** | F2000 / F500 at S18000, two flutes = 0,056 mm per tooth (research row: 1500 / 450, 0,025–0,05) | **M2** |
| Unverified mark | lines 1–3 of the file; two required checklist items in step 5 | right; S2 |
| Z zero | "Z SIFIR: malzeme ustu" on the example machine | S1 |

R17 against hand edits (same result on both Z references):

| Edit | Result |
| --- | --- |
| first groove to remaining 0,69 / 0,65 / 0,4 | refused: `VGROOVE_TOO_DEEP` (+ `MODEL_MISMATCH`) |
| first groove through the panel | refused: `VGROOVE_WRONG_TOOL`, `VGROOVE_MISSING` |
| all grooves left shallow (remaining 2,0) | refused: `VGROOVE_MISSING` |
| tool change to the end mill removed | refused: `VGROOVE_WRONG_TOOL`, `PART_NOT_HELD`, tool rules |
| an extra V cut across the tray face | refused: `MODEL_MISMATCH` |
| groove feed × 10, V-bit rpm 24 000 | refused: `FEED_ABOVE_MACHINE`, `RPM_MISMATCH` |
| "PLAKA ARKA YUZU USTTE" line removed | refused: `BACK_FACE_HEADER_MISSING` |
| "DOGRULANMAMIS MALZEME: ACM" line removed | **accepted** (S2) |

## MUST (3)

**M1. Spec rule 12 is broken in the ACM file, and nothing checks it.**
Where: `acm-tray-4mm-ui-mach3.tap` lines 27, 32 (groove) and every `G1 Z-4.5000 F500` after a tab;
Simülasyon → Kesim ayarları → "Dalma (konturda)"; the warning under Özet (`05`).
What is wrong: spec §7.2 rule 12 says no descent into a composite panel steeper than the table limit
(5°). T422 made the contour entry ramp; the V-groove operation (`buildOnlineOperation`) and the descent
after each tab still go straight down, the second through the front aluminium skin. The checker has no
R12 (planned in T362, two batches after MB7), so the file passes. In the UI "Dik dalma" looks
selectable for ACM, a click does nothing and gives no reason, and the `TABS_REDUCED` warning tells the
operator "girişi düz dalmaya alın", which the material does not allow. In ACM the risk is modest (soft
core, 0,5 mm skin, 500 mm/min); in aluminium the same two moves break tools, and T358's acceptance
does not name them.
Fix (one task, before T357):

- [ ] tab exit: the tool comes down along the contour at the traits angle (a sloped tab flank), never a vertical move, when `traits.entry.straightPlunge` is false
- [ ] V-groove entry: ramp along the fold line on the first leg of each pass; or a written exception in spec rule 12 ("V-bit in composite, at most the traits step, at the plunge feed") if the PO prefers the plunge. One of the two, in the spec
- [ ] checker R12 for composite pulled forward from T362 (descent angle of every feed move that enters material, drill tools and the agreed exception aside), with mutation tests
- [ ] "Dik dalma" locked for these materials with the reason "Bu malzemede dik dalma yok"; `TABS_REDUCED` text for them: "Köprü genişliğini ya da adedini azaltın"
- [ ] ACM goldens regenerated (`needs-human`); wood goldens byte-identical
- [ ] T358 acceptance extended with "tab exits and V-grooves"

**M2. The V-bit cuts at the end mill's feed; the V-groove row of the research is not in the code.**
Where: Simülasyon → Kesim ayarları → Devir, row "T3 · Ø12 mm": "Talaş yükü 0,056 mm/diş … İlerleme ve
dalma malzeme ayarından (2.000 / 500 mm/dk)"; NC lines 27–36; golden `acm-tray_S1.tap` (F6000 / F1500).
What is wrong: `feedsOf(vTool)` falls back to the job's material set, which belongs to the contour
tool. `starting-values.ts` has no V-bit row, although `kesim-degerleri-arastirma.md` §c/§d gives one:
two flutes, 18 000 rpm, 1500 mm/min, plunge 450, 0,025–0,05 mm per tooth, marked "weak". Result: Ø6
set → 0,056, Ø8 set → 0,069, and the golden pins 0,167 mm per tooth (3,3 × the researched ceiling)
because its ACM set is a copy of MDF 18. D-130 says the more conservative value wins; here no V-groove
value is used at all, and the chip-load note judges the V-bit with the end-mill band.
Fix (one task):

- [ ] `starting-values.ts`: row `acm` × `vBit` × 2 flutes (0,025 / 0,042 / 0,05; plunge share 0,3; 18 000 rpm; sources S8, S18, S20, S21)
- [ ] the V-groove operation takes, in this order: the project's own feed for that tool, a verified set that names the V-bit, the table row clamped to the machine; never the contour set
- [ ] a chip-load band for the V-bit in the ACM traits (warn outside 0,025–0,05), shown on its row in Kesim ayarları
- [ ] the tray fixture profile gets research values for both tools; the two `acm-tray` goldens regenerated (`needs-human`)

**M3. "Örnek ACM ayarlarını ekle" gives empty fields on the seeded machine.**
Where: step 1 with ACM (`02`) → the button → Makineler form (`03`).
What is wrong: the button adds ACM 3 and 4 mm rows on T1 (Ø6, two flutes). The table has ACM rows for
single-flute tools only, so all four values of both rows are empty, the note says "Bu malzeme için
hazır değer yok", and "Kaydet" answers with eight "Bir sayı girin". The operator has to invent the
numbers. Once typed they count as confirmed (typing ends the unverified state, there is no "Değerleri
doğruladım" left to press), so the `CUTTING_PARAMS_UNVERIFIED` gate is passed by any guess. The owner
asked for built-in starting values per material (2026-11-23) and D-130 promises researched values for
ACM; on the machine every new company gets, the flow delivers neither. The same button adds a V-bit
with a 0,2 mm tip (see S4).
Fix (one task):

- [ ] the sample flow also adds a sample single-flute Ø6 O-flute tool when the machine has none (as it does for the V-bit) and binds both rows to it: 2000 / 500 / 18 000 / 4 (3 mm: 3), source line shown, marked unverified
- [ ] a row whose four values were typed by hand keeps "Değerleri doğruladım" as an explicit press before it counts as confirmed
- [ ] e2e: new company → ACM → the button → "Kaydet" works without typing a number → back in the project with one remaining error at most (the unverified set)

## SHOULD (7)

**S1. The groove's remaining skin depends on the real panel thickness; nobody tells the operator.**
Where: NC header "(Z SIFIR: malzeme ustu)"; step 5 checklist. Our research (§b.8 item 8, "yazılımın
yapması gerekenler" 5) gives ACM ± 0,2 mm and says the depth must be taken from the table. The NC is
right for a table zero (Z +0,8, checked by R17). With the top zero, which the example machine and most
workshops use, a 4,0 nominal panel that measures 3,8 leaves 0,6 mm: below the 0,7 floor R17 guards to
four decimals. Fix: with V-grooves and `zZero = materialTop`, a Simülasyon warning and a required
checklist item "Panel kalınlığını kumpasla ölçtüm; proje kalınlığıyla aynı (± 0,1 mm)", a header line
"(V-KANAL: KALAN 0.800 mm, KALINLIK 4.000 mm OLCULMELI)", and one sentence in the machine form that the
table zero suits ACM folding. The field kit of T356 already measures the remaining skin; add the panel.

**S2. The checker does not assert the unverified-material line.** Removing
"(DOGRULANMAMIS MALZEME: ACM)" by hand leaves the file downloadable; the back-face line next to it is
asserted. Today the draft-profile line still stands above it, but T356 moves verification to "per
family", and then this line is the only mark on a machine verified with MDF. Fix: the check context
gets `unverifiedMaterial` from the project's traits (not from the post meta) and a rule
`UNVERIFIED_MATERIAL_HEADER_MISSING`, with a mutation test. Do it inside T356.

**S3. The file and the checklist do not describe the V-bit or the grooves.** Header "(TAKIMLAR: T3
D12.000, T1 D6.000)", prompt "(TAKIM T3 D12.000 TAKILI MI? …)", checklist "Takım doğru mu? (T3 Ø12 mm →
T1 Ø6 mm)" (`04`). For a V-bit the diameter says nothing; angle and tip flat decide the fold. Fix:
header "(V-KANAL: 4 hat, T3 V 90 uc 0.2, kalan 0.800 mm)", prompt "TAKIM T3 V-UC 90 D12", checklist "T3
V uç 90° (uç düzlüğü 0,2 mm)". Fits T355, which already owns the ACM checklist items.

**S4. The sample V-bit is an engraving bit.** `SAMPLE_V_BIT` and the tray fixture use a 0,2 mm tip.
The research names a flat-bottomed 90° V for ACM (Dibond: flat at least 3,2 mm; inner radius 2–3 mm); a
sharp tip leaves the skin a sharp crease and the fold panel shows "İç yarıçap 0 mm". Fix: sample bit
90° with a 3 mm flat (Ø12 still reaches 3,2 mm: its cone is 4,5 mm deep), and an info note on the V-kanal
tool row when the tip flat is under 2 mm: "ACM katlamada düz tabanlı V uç kullanılır". No block.

**S5. The fold verdict says "Kapanıyor" before anything is folded.** Montaj → Katla (`06`, `07`). At
0 % the part row reads "tepsi · Kapanıyor" with "köşe boşluğu 0 mm"; at 100 % the same tray is "Çakışma
var: Kanal 1 ile Kanal 2 çakışıyor (3,5 mm)". An owner who reads the panel without moving the slider
cuts a tray that does not close. The clash itself is real and a good catch: a square relief at the
fold intersection lets 4 mm flanges collide, and this is the geometry of our own `acm-tray` fixture.
Fix: the verdict is always computed at the target angles (the slider only moves the picture); the
clash line names the fix ("flanş uçlarını 3,5 mm kısaltın ya da köşe boşaltmasını büyütün"); only the
colliding flanges turn red, not the whole part; the ACM test part of T356 is a tray that closes.

**S6. Tabs cost the MDF job a whole sheet, and the screen does not say so.** Dizilim, MDF 18, the
30-part kitchen list (`01`): Parçalar estimates "≈ 2 plaka", the nest gives 3, the third at fire
%94,9, because D-129 widens the gap to 19,1 mm with tabs on. The helper line explains the rule but not
the price. Fix: when the last sheet is under 15 % used and a nest with thin skin (or tabs only on small
parts) needs one sheet fewer, the mode card says so with one button: "İnce tabakayla 2 plakaya sığar ·
Uygula". The owner will see this on the field-test job.

**S7. Wood words on ACM screens.** Step 1 (`02`): "Bu malzemede damar yok · Damar yönü ver"; Çizim →
Parça: "Damar · Damar sabit"; Kesim ayarları → Kesim yönü: "Climb çoğu router'da daha temiz kenar
verir…" under a default that is conventional for a stated reason. Fix: the strings come from the
traits (`direction.label` = film; a line "ACM'de önerilen: conventional" for kinds whose traits set
the direction).

## Polish

**P1. Two passes where the set says one.** A 4 mm ACM set with 4 mm step-down cuts 2 × 2,25 mm because
the depth includes the 0,5 mm spoilboard allowance; research says one pass, and a second lap doubles
the time on the outline. Fix: for kinds whose traits allow a full-depth pass, compare the step-down with
the panel thickness.
**P2. Offcut sizes ignore the number format.** Dizilim: "Plaka 3: 2259.4 × 2070 mm" beside "2.800 ×
2.070". Fix: `formatMm`.
**P3. Report tiles truncate at 1024.** Dışa aktar (`08`): "Toplam par…", "Tahmini ke…". Fix: two
columns below 1100 px or shorter labels ("Parça", "Süre").
**P4. Özet truncates the hold line at 1440.** Simülasyon (`05`): "Köprü: her parçada 4 × 6…". Fix: let
it wrap to two lines.
**P5. Katla sits below the fold.** Montaj at 900 px height: "Görünüm araçları" and two switches come
first; the per-groove rows need a scroll. Fix: in a project with V-grooves the Katla card comes first.
At 390 px I did not find the panel at all; check in the mobile pass.
**P6. Kenar payı helper** still says "En az 6 mm" beside "kenar payı en az takım Ø + 3 mm (10 mm)"
(#14 P8, in T398; listed so it is not lost).
**P7. "Takım iç köşeye giremez … (4 mm)" on an ACM tray** before the machine has any ACM set: the
radius is the wood tool's, and "Otomatik düzelt" would round the fold reliefs. Fix: no radius claim
without a set; for ACM name the relief ("köşe boşaltması").
**P8. D-130 says aluminium NC is blocked "until MB7 lands"**; the backlog releases it in T366 (MB9),
after the checker rules. The backlog is right; correct the sentence in D-130.
**P9. `M7` is written before the tool-check `M0`** in every file (wood too). Not new and not judged
here; T360 defines the order (spindle, dwell, coolant). Make sure the 1.1.0 posts move it.

## Good (keep)

- R17 takes its floor from the traits in the check context, not from the toolpath or the user's
  value, and works on both Z references.
- Grooves before every contour, one tool change, "Z SIFIRLA" in the prompt and as its own checklist
  item.
- The back-face fact is now in four places: wizard badge, Simülasyon chip "Arka yüz görünümü", NC
  header (asserted by the checker), required checklist item. #14 M1 is closed.
- The DXF dialog proposes "V-kanal (büküm)" from the layer name and says why.
- The machine form's chip-load line for a typed ACM set ("0,056 mm/diş · aralık 0,06–0,21 …
  Araştırma aralığının dışında") is exactly the tone the operator needs.
- "Oturuyor mu?" no longer collides with the view toolbar (#14 P4); no overlapping controls at 1440
  or 1024; no horizontal scroll at 1440, 1024 or 390 on any walked screen; no console error.

## The plan

Planned: B71 (T385, T397, T398) → MB6 (T355, T356) → MB7 (T358–T360) → 3D (T400–T421).

1. **B71 and MB6: right, keep.** Add M1–M3 as the next must-fix batch; they must be on main before
   the owner runs T357. S2, S3 and the tray of S5 belong inside T355/T356 while those are open.
2. **MB7: right place, wrong cut.** T358 must cover tab exits and V-grooves (M1). The checker rules
   R12–R14 (T362) sit in MB9, two batches after the toolpath rules they guard, behind the finishing
   pass (T364). Swap them: T362 directly after T358/T359, T364 later. The independent net should land
   with the rule, as R17 did with MB5.
3. **3D: not yet.** D-132 itself says "after field test 1 and M-Metal tier A". Nothing this product
   writes has cut material so far, and three owner gates are already queued (field test 1, T357, T369);
   3D adds a fourth (T416). More unverified surface is the wrong trade while field test 1 waits. If
   the seats must stay busy, take only the pure-core 3D tasks that ship no NC and no screen (T400
   tool kinds, T401 heightfield, T402 removal simulation), and stop there until field test 1 reports.
4. **Earlier than 3D:** T373 (a neighbour's lead can cut the web behind a tab; the header count is
   optimistic: a wood hold-down item, relevant to field test 1), T375 (a renderer crash can lose the
   last edit: data loss), S6.
5. **Drop for now:** MB11 (brass, V-engrave) and T421 (rotary) stay outlines; do not groom them.

## Outputs

`docs/reviews/2026-11-28-cto-design-review-15.md`, `docs/reviews/2026-11-28-cto-15/`.

| Subject | Files |
| --- | --- |
| MDF 18 | `01-mdf-dizilim-1440.png`, `08-mdf-export-1024.png` |
| ACM step 1, sample settings | `02-acm-step1-1440.png`, `03-acm-sample-empty-1440.png` |
| ACM export, simulation | `04-acm-export-1440.png`, `05-acm-sim-1440.png`, `09-acm-sim-1024.png` |
| Montaj, Katla | `06-bench-fold-flat-1440.png`, `07-bench-fold-clash-1440.png` |
| NC read | `acm-tray-4mm-ui-mach3.tap`, `acm-tray-3mm-script-generic.nc`, `acm-tray-4mm-script-mach3-table-z.tap` |
| Checker | `r17-mutations.txt` |
