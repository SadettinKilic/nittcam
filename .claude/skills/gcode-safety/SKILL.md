---
name: gcode-safety
description: Touching toolpath, post processor or G-code reader. The 10 non-negotiable G-code safety rules, golden files, reader independence. Spec §7.2, §6.5, §11. Also the tester's safety review checklist.
---

# G-code safety (spec §7.2): non-negotiable

Wrong G-code means broken tools, material and machines. Enforced in the generator **and** checked again by the independent reader.

1. The program assumes no modal state: units (G21), absolute (G90), plane (G17) and work offset (G54) are written explicitly at the start.
2. The first move goes up to safe Z. XY rapids happen only at safe Z.
3. Never enter material with a rapid; plunge always at plunge feed.
4. No cutting move before the spindle is on and the warm-up dwell has finished.
5. The first cutting move states its feed explicitly.
6. All coordinates lie inside the work envelope; an out-of-envelope program is never produced.
7. At program end: safe Z, spindle off, vacuum off, end code.
8. Numbers use fixed decimals: no exponent notation, NaN, Infinity or empty values.
9. A file that fails the reader checks cannot be downloaded.
10. An unverified profile adds a header comment "DOĞRULANMADI, önce air cut", and the download requires a warning and acceptance.

## Reader (packages/core/gcode-reader)
Written **independently of the generator**: it must not import the generator's code or constants (except shared types). Checks: sheet/table/axis/Z limits, rapid inside material, cutting with spindle off or feed undefined, tool-change order/number, the read path matching the toolpath model within tolerance, part count and positions matching the layout.

## Tests
- One failing-input test per rule (deliberately broken G-code must be caught).
- Golden files: `packages/machines/<post>/<version>/golden/*.nc` compared byte for byte. A changed golden file needs the owner's approval: PR label `needs-human`. Never "update snapshots" casually.
- Every field bug first becomes a reproducing test.
