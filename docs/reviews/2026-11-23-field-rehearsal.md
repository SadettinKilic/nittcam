# Field-test rehearsal on main (tester, 2026-11-23)

Before field test 1 (air cut, then test cut on scrap, Mach3-class router, manual tool change), I
played the operator on `main` @ `5ebbb2f`. I built three jobs through the UI on the seeded machine
"Örnek router (Mach3)", exported them, downloaded the field-kit test programs, and read every NC
file as a machinist would. I also tried on purpose to get dangerous files out.

The production build ran locally (`next start`, port 3400, fresh PGlite). The flows were driven
with Playwright (1 worker, 1440 × 1000). Every downloaded NC file went through three checks:

- the repo's independent checker (`verifyDownloaded` → `checkGcodeFiles`: reader + all automatic
  rules, re-derived from the saved project);
- my own line-by-line lint, a small Node script that shares no code with the repo;
- reading by eye.

The scratch rehearsal specs are not committed. Only the failing test for B2 is committed.

## Verdict

The programs themselves are clean, and the checklist and checker stop most of the dangerous
cases. **Two blockers** must be fixed or worked around before the machine:

- **B1:** a feed or plunge typo goes out green.
- **B2:** the lead-in/out runs the cutter 2 mm past the sheet edge.

**Three should-fixes** concern the park move, stale machine versions and the field kit.

## BLOCKER (must fix before the machine)

### B1. Any feed up to 60 000 mm/min and any plunge up to 30 000 mm/min goes out green, with no warning

**Steps.**

1. Paste `Yan 560 × 720`, then Dizilim → Diz, then Simülasyon → Kesim ayarları, T2 row.
2. Set İlerleme to `59000` and Dalma to `29000`.
3. Go to Dışa aktar: "Tüm kontroller geçti". Tick the checklist and download.

**What happens.** Feed `0`, `-100` and `60001` are refused (aria-invalid). `59000` and `29000` are
accepted. The warnings box says "Sorun bulunmadı". The panel itself shows "Talaş yükü 1,639 mm/diş"
without any warning. The simulation estimates 0:18 at that feed, although the machine's
`rapidFeed` is 10 000. File `Adsiz_proje_10_r2_S1.tap`:

```
(ILERLEME T2: 59000 mm/dk, dalma 29000 mm/dk elle, onerilen 6000 / 1500)
...
G0 Z2.0000
G1 Z-4.6250 F29000
G3 X6.0000 Y370.0000 I0.0000 J4.0000 F59000
```

**Why it matters at the machine.** The realistic case is one extra zero while typing the T323
per-tool feed: plunge `15000` instead of `1500`, or feed `60000` instead of `6000`. The file passes
every check, and the operator sees a green screen.

- Mach3 then plunges at its Z maximum (it clamps to motor tuning) into 18 mm MDF with an Ø8 end mill.
- It cuts at the XY maximum with a chip load 10–20 × too high.

The likely result is a broken tool or lost steps (a ruined part and position).

**Cause.** The limits are deliberately profile-wide (`machineFeedLimits()` = `PROFILE_BOUNDS`, used
by the command, the validation and checker R5 `FEED_ABOVE_MACHINE`, `gcode-check/rules.ts:351`). The
profile has no own maximum yet: T323 notes "the profile has no own max yet".

**Suggested fix (small).**

- Cap the cutting feed at the profile's `rapidFeed` (or a new `maxFeed`), and the plunge feed at a
  machine plunge maximum.
- Show a warning, and a checklist line to tick, when the feed or plunge is more than about 1.5 × the
  recommendation or the chip load is out of band.
- Make plunge > recommended plunge a warning, not only plunge > feed.

**Workaround for the field test:** do not touch İlerleme or Dalma (leave "önerilen"), or read the
`ILERLEME` header line before running.

### B2. The arc lead-in/out puts the cutter 2 mm past the sheet edge at full depth (Ø8, default margin 10)

**Steps.** Any job with the Ø8 tool and the default margin 10: all three rehearsal jobs show it.

**What happens.** A part at the left margin (part edge X 10) has its contour tool centre at X 6. The
arc lead (radius = tool radius 4) starts and ends at X 2. The plunge is at the lead start, so on
every pass the Ø8 cutter spans X −2 … 6 down to Z −18.5. Job A, `Adsiz_proje_r3_S1.tap`, end of the
last part:

```
G1 Y366.0000
G3 X2.0000 Y370.0000 I-4.0000 J0.0000
```

Job B, `Adsiz_proje_7_r6_S1.tap`:

```
G0 X2.0000 Y306.0000
G0 Z2.0000
G1 Z-4.6250 F1500
```

My lint over A, B and C: the smallest cutting X is 2.00 with Ø8 (cutter edge −2). With Ø6 (job C)
it is 4.00 (edge +1, fine).

**Why it matters at the machine.** Sheets are often pushed against stop pins, a fence or clamps at
the program-zero corner. The cutter then hits them at full depth, a broken tool on the very first
part. The code's own intent says otherwise: `minSheetMargin` (`validate/index.ts:495`) says the
radius margin "keeps the cutter on the sheet" because "leads are clipped to the sheet by the
toolpath". The clip keeps only the tool **centre** on the sheet. The checker accepts it because the
centre stays inside the envelope.

**Failing test (committed):**
`packages/core/src/toolpath/lead-sheet-edge.field.tester.test.ts`. The Ø8 case fails with
`approach: centre 2.000 / 366.000`; the Ø6 case passes.

**Suggested fix.** Clip the lead so the cutter edge (centre ± r) stays on the sheet. Otherwise
shorten or remove the lead with the existing `LEAD_SHORTENED` / `LEAD_REMOVED` warnings. The checker
should apply the same rule to the cutter edge.

**Workaround for the field test:** set the sheet margin in Dizilim (`layout-margin`) to ≥ 14 mm with Ø8.
By arithmetic, the lead centre is then ≥ X 6 and the cutter edge ≥ 2; I did not run this case.
Alternatively, keep stops and clamps away from the left and front edges.

> Severity note: this is a real BLOCKER if the owner's table has a fence, stops or clamps at the
> origin corner. With a bare vacuum table it only scores the spoilboard 2 mm outside the sheet, and
> it would be a SHOULD.

## SHOULD (fix soon; not a crash by itself)

### S1. Park move (G53) needs a homed machine, and nothing says so

Every manual pause goes to safe Z, then `G53 G0 X50.0000 Y2100.0000` (the park point I set), then
the message, then `M0`. That order is correct. But G53 is in machine coordinates. On a Mach3
machine that was not referenced (no home switches, or not homed after power-on), machine zero is
wherever the gantry stood at power-on. The park move can then drive into a hard limit at rapid
speed, already in the air cut.

The field kit's park note ("Not: takım değişimi ve park konumu") and the checklist do not mention
homing. Suggested fix:

- add a kit line and a checklist line "Makine referanslandı (home) mı? Park noktası makine
  koordinatıdır";
- keep park **off** for the first air cut if the owner's machine has no home switches.

### S2. A project pinned to an older machine version exports with stale tool data

**Steps.**

1. Export a job on machine profile v3.
2. In the machine, shorten T2's flute length to 10 mm (new version v4; the state becomes
   "yeniden doğrulama gerekli", which is correct).
3. Open the project's Dışa aktar.

**What happens.** An info box (blue) says "Makine profili güncellendi … Son sürüme geç". The checks
stay green, and the download is allowed. The file is generated for v3: 25 mm flute, cut to −18.5.
Its header says `(PROFIL: Ornek router Mach3 surum 3)` and `(DOGRULAMA: AIR CUT ONAYLANDI ...)`,
although the machine as it is now needs re-verification.

**Why it matters.** At the machine the operator edits the tool, or the park point or origin, in
NittCam, then exports a project saved earlier. The file silently uses the old values. With a
shorter real tool, an 18.5 mm cut exceeds the flute: the shank rubs and the tool breaks. Pinning
versions is by design (spec §8), but a safety-relevant newer version should at least turn the
info box into a checklist line to tick ("eski makine sürümüyle çıkıyor"), or default to the latest
version.

### S3. The field kit's air-cut Z-zero step is ambiguous

Kit "Makine günü 1: air cut (malzemesiz)", step 3 says "Z sıfırını profildeki yönteme göre alın:
Malzemenin üst yüzeyi". There is no material in an air cut. The program keeps Z ≥ +20 (lint: air
cut Z range 20 … 58.5), so zeroing on the bare table or a scrap is safe. But the kit should say
which, and say clearly that Z must be re-zeroed on the real sheet before the test cut. Day 2,
step 2 does say "Z sıfırını yeniden alın", which is good. A missed re-zero after zeroing on the
table means that `G0 Z2` is inside an 18 mm sheet.

## NOTE (not blocking)

- **N1. Ramp entry drops one tab on small parts, but the header still says 4.** In job C (ramp 3°,
  small 80 × 50 "Takoz"), each Takoz gets 3 tabs (`G1 Z-15.0000` count per block: `3 3 3 3`, the
  bigger parts 4). The header still says `(KESIM: kopru her parcada 4 adet ...)`. Three tabs hold an
  80 × 50 part, but the header should match, or the UI should say "rampa nedeniyle 1 köprü kaldı".
- **N2. The program ends over the last part.** At program end the tool stays at Z 20 above the last
  part: `G0 Z20.0000`, `M5`, `M9`, `M30`. With a park point configured, ending at park would free
  the sheet for unloading. This is convenience, not safety.
- **N3. The PDF sheet page does not name the NC file or the tool order.** From the code
  (`apps/web/lib/server/pdf/layout-pages.ts`): the page carries "Plaka n / total", the
  program-zero mark (B51) and the part numbers, but not the NC file name (`…_S1.tap`) or the tool
  order. The operator can still match S1 to "Plaka 1", and the tool order is in the export
  checklist and the NC header. I could not render the PDF on this PC (no poppler); this note is
  from the code only.
- **N4. The time estimate ignores the machine's real speed.** It uses the programmed feed, so the
  59 000 mm/min case showed 0:18. It should clamp at the machine's speed (see B1).
- **N5. Template hole sizes are unverified.** The hinge template's cup is placed 22.5 mm from the
  edge (cup edge 5 mm from the door edge), Ø35 × 12, cups at 106 and 606 on a 712 door. The handle
  holes are Ø6 through, cut by plunging the Ø6 end mill in pecks (`G1 Z-4.6250 … G0 Z2.0000 …`). A
  Ø6 hole cut with an Ø6 tool comes out at the tool's real cutting diameter. The NC header and the
  checklist already flag "SABLON DOGRULANMADI", which is good: the owner should measure these
  against his own hinges and handles.
- **N6. Machine version count.** I edited the seeded example machine (park on, then a flute and
  park round trip through the API for S2). It is now at v10 with v3 values and state
  `air_cut_approved`. Verification resets correctly on a tool Ø, flute or park change, and comes
  back when the values return to the approved ones.

## What I ran

| # | Job | Built in the UI | Output |
|---|-----|-----------------|--------|
| 0 | Machine | Makineler form: park on, X 50 / Y 2100 (T309); field kit; verification air cut → "Air cut'ı onayla" → test cut | `AIRCUT_S1.tap`, `TESTPARCA_S1.tap` (verification); `AIRCUT_GENIS_S1.tap`, `TESTPARCA_GENIS_S1.tap` (kit, T191) |
| A | Cabinet | "Dolap ekle" default base unit (18 mm MDF), then on the door "Menteşe çukuru Ø35 (2 menteşe)" + "Kulp deliği 128 mm" | `Adsiz_proje_r3_S1.tap` + DXF ×2, A4 PDF, labels |
| B | Drawn part | L part drawn with the line tool (600 × 600, 300 arms), "Tüm köşeler" fillet R20 (arcs), rectangle cut-out 80 × 140 (through), rectangle → "Cep (kör)" 200 × 140 × 6 mm (T325), through Ø10, blind Ø35 × 10, ring groove Ø60 w 8 d 3 | `Adsiz_proje_7_r6_S1.tap` + DXF, PDF, labels |
| C | Mixed list | Sheet grain 90°, pasted Yan ×2 (grain), Raf ×2 set to fixed 30° (placed at rot 60), Açılı panel, Takoz 80 × 50 ×4 (small, tabs); Kesim ayarları: outer contour tool T1 Ø6 (T308), rpm 16 000 (T307), feed 4000 / plunge 1200 (T323), ramp 3° (T324) | `Adsiz_proje_9_r4_S1.tap` + DXF, PDF, labels |
| D | Danger attempts | see "Dangerous on purpose" | |

Independent checker (`verifyDownloaded`) on A, B and C: `ok: true`, `violations: []`, parts cut =
parts expected (A 6/6, B 3/3 loops, C 9/9). My lint on all 7 NC files (A, B, C, D1 and the 4 test
programs): 0 issues apart from the feeds in D1 (B1).

### Checked line by line (all 7 files, by lint and by eye)

- **Modal state before any motion.** `G21 G90 G91.1 G17 G40 G49 G54` is on the first code line;
  only comments come before it.
- **Spindle and first moves.**
  - `M3 S…` then `G4 P5.0` before the first feed move, also after every tool change.
  - The first move is `G0 Z20.0000`, with no XY.
  - No XY rapid below safe Z (count 0).
  - No `G0` with Z < 0. Approach is `G0 Z2.0000`, then `G1 Z0.0000` or `G1 Z-…` at the plunge feed.
  - Every plunge, helix and ramp leg runs at the (tool's) plunge feed.
- **Depth.** The deepest Z is −18.5 = 18 + spoilboard allowance 0.5 in all jobs; air cuts never go
  below +20. Blind work is exactly as drawn: cups −12, blind hole −10, pocket −6, groove −3; in the
  extended test part, pocket −9 and groove −2.
- **Tool change (job A).**
  - The sequence is `G0 Z20.0000`, `M5`, `(PARK ...)`, `G53 G0 X50.0000 Y2100.0000`,
    `(TAKIM DEGISTIR: T2 D8.000 - Z SIFIRLA - SONRA CYCLE START)`, `M0`, `G0 Z20.0000`,
    `M3 S18000`, `G4 P5.0`.
  - The first-tool pause names T1 Ø6, and the export checklist shows "T1 Ø6 mm → T2 Ø8 mm" and
    "Program içinde 1 kez durup takım ister. Her değişimden sonra Z'yi yeniden sıfırlayacağım".
  - Only `M0`, never `M1` (T311).
- **Feed.** No `F0`. The first feed move after every rapid carries F. Defaults are 6000 / 1500; in
  C the override 4000 / 1200 is used and named in the header.
- **Arcs.**
  - `G2`/`G3` with incremental I/J (`G91.1`).
  - Start and end radius differ by at most 0.00009 mm (C's ramp arcs; 0 elsewhere), so no "radius
    to end of arc differs".
  - Sweeps ≤ 180° and helices are consistent.
- **Tabs.** 10 × 3 mm (Z −15.0) on straight segments only, never on the R3/R4 corner arcs. 4 per
  part, 3 on ramped small parts (N1). Inner cut-out slugs have 4 tabs.
- **Order.** Holes, cups, pockets, grooves and inner cut-outs come before the part's outer contour.
  The leads do not cut into a neighbour (checker, and gap Ø + 0.1).
- **Header and ending.**
  - The first line is `(DOGRULANMADI, once air cut)`. Template jobs add
    `(SABLON DOGRULANMADI: ...)`. Overrides add `DEVIR`, `ILERLEME`, `GIRIS` and `TAKIM ELLE` lines.
  - The program ends with `G0 Z20.0000`, `M5`, `M9`, `M30`.
  - Vacuum `M7` is on before the first pause.
- **File format.**
  - File names are 13–24 characters, within the profile's 32 and the post's 64.
  - CRLF line endings, ASCII-only comments, fixed 4 decimals, no exponent, NaN or −0 residue.
    Z helix values are rounded toward the shallow side, e.g. `-1.7343` for −1.734375, which is
    harmless.
- **Coordinates.** All inside the 3100 × 2200 travel and the sheet, except the cutter edge at the
  leads (B2).

### Program summaries

- **A, cabinet** (546 lines, 1 sheet 2800 × 2070, est. 12 dk):
  - T1 Ø6 first: 2 hinge cups Ø35 × 12 (helix + rings), 2 handle holes Ø6 through (peck plunge).
  - Tool change to T2 Ø8: 6 outer contours (2 Yan, Üst, Alt, Raf, Kapak), 4 passes of 4.625,
    4 tabs each, arc leads, climb.
- **B, drawn part** (383 lines, T2 Ø8 only):
  - through hole Ø10 (helix r 1), blind hole Ø35 × 10, rectangular pocket 6 mm (ramped 2.5° on the
    inner ring, then offset rings), ring groove Ø60 w 8 d 3 (helix);
  - inner cut-out 80 × 140 with 4 tabs;
  - the L outline with R20 arcs, 4 tabs.
- **C, mixed list** (641 lines, T1 Ø6 only, rpm 16 000, F 4000 / 1200, ramp 3°): 4 Takoz (3 tabs
  each, ramp along the contour), 2 Yan, 2 Raf rotated 60° (grain 30° part on a 90° sheet), Açılı
  panel. The checker confirms the rotated contours match the layout.
- **Test programs:**
  - The air cuts (`AIRCUT_S1`, `AIRCUT_GENIS_S1`) stay at Z ≥ +20 with the same moves: spindle,
    dwell, park, M0 and safe Z.
  - `TESTPARCA_S1`: 200 × 200 square, Ø100 hole, Ø40 × 9 blind pocket, T2.
  - `TESTPARCA_GENIS_S1`: 300 × 200, arcs, inner window, 2 holes, Ø35 × 9 pocket, groove 2 mm.
  - All clean in lint. The test cut unlocks only after "Air cut'ı onayla" (gate works).

### Dangerous on purpose: was I stopped?

| Attempt | Result |
|---|---|
| Feed 0 / −100 / 60 001 | Refused in the field (aria-invalid) ✔ |
| Feed 59 000, plunge 29 000 | **Not stopped**, file downloaded (B1) ✘ |
| Hole Ø4, smaller than every tool | Export blocked: "Delik çapı takım çapından küçük" ✔ |
| Blind hole depth 25, then 18, on an 18 mm sheet | Field accepts the value; export blocked: "Delik derinliği plaka kalınlığından az olmalı" ✔ |
| Hole Ø0 / −5 | Refused in the field ✔ |
| Sheet margin 0 | Export blocked: "Kural 6 … çalışma alanının dışına çıkıyor" ✔ |
| Part dragged or nudged over the sheet edge | Refused on drop (covered by `t013-layout-tester.spec.ts`; not repeated) ✔ |
| Cut-list rows En 0 / −50 / Adet 0 | Paste preview marks them "En sıfırdan büyük olmalı" and imports only the valid row ✔ |
| Tool flute shortened in the machine after the project was saved | Not stopped: the old profile version is used (S2) ✘ |
| Example machine, unverified post | Every file starts with `(DOGRULANMADI, once air cut)`; download needs the acceptance box ✔ |

### Flow at the machine

- **Which file is which sheet:** `…_S1.tap` and the header `(PLAKA 1/1)`; the PDF says "Plaka 1 / 1".
- **Which tool first:** the first pause names it, and the checklist lists the order.
- **Where X0/Y0 is:** header `(ORIJIN: on sol, X+ sag, Y+ arka ...)`, the export checklist "Orijin
  doğru mu? (Ön sol)", and the B51 mark on the PDF sheet page.
- **What to do at each M0:** the comment line just before it says it, in ASCII Turkish.

The export cannot be downloaded until every checklist line and the unverified-profile acceptance
are ticked.

## What I could NOT check without the real machine (for the owner)

1. **`G4 P5.0` units.** Mach3 reads P as seconds only while "G04 dwell in ms" is off. If it is on,
   the warm-up is 5 ms. Check the setting, and watch that the spindle reaches speed before the first
   plunge in the air cut.
2. **`M7` / `M9` = vacuum.** In Mach3 M7 is the "mist" output by default. Check it is wired or
   mapped to the vacuum, and that M9 at the end does not release the sheet early.
3. **Homing and G53 park.** Is the machine referenced (home switches) before running? Is
   X 50 / Y 2100 (or the chosen point) free and inside soft limits? (S1)
4. **Axis directions and origin.** Front-left, X+ right, Y+ back must match the machine. The air
   cut shows it.
5. **`G91.1`, helical `G2`/`G3` and arc tolerance** in the owner's Mach3 version.
6. **Spindle speed control.** If the spindle speed is set by hand on the VFD and not by S/PWM, the
   rpm override (T307) and the S word do nothing; set the dial to the header's DEVIR.
7. **Real maximum feed and Z plunge speed** of the machine, and whether 6000 / 1500 feels right on
   MDF 18 (T1 Ø6 also runs at 6000 by default: chip load about 0.17 mm).
8. **Tool stick-out and flute length** of the real Ø6 / Ø8 bits against a 18.5 mm cut (profile:
   22 / 25 mm).
9. **Sheet thickness variation against the 0.5 mm spoilboard allowance:** through-cuts and tabs
   (3 mm) on the real 18 mm MDF.
10. **Vacuum hold** of the small parts (80 × 50) with 3 tabs, and how hard the tabs are to break.
11. **Z re-zero method after the manual change** (touch plate or paper), and that Cycle Start after
    `M0` resumes with `G0 Z20`, `M3` and the dwell as written.
12. **Fixturing at the origin corner** (stops, fence, clamps): decides whether B2 is a BLOCKER for
    this table.
13. **Measured sizes** (test part form) and the hinge/handle template sizes against the owner's
    hardware.
14. **File transfer:** USB, the `.tap` extension, the name-length limit and CRLF on the controller PC.
