# T007 Offset spike: CavalierContours vs Clipper2 vs own implementation

Spec §6.3 (offset keeps arcs), §8.3 (offset library is a candidate, decided in M0), §8.4, §14.1 ("offset library does not fit" risk).
Date: 2026-11-16. Author: dev. **Status: recommendation for the PO; the decision (D-013) is not written yet.**

## Summary

| | A. CavalierContours | B. Clipper2 + arc fitting | C. Own TS implementation |
| --- | --- | --- | --- |
| What was measured | `cavalier-contours-js` 0.1.1 (pure TS port of the Rust crate). The Rust/WASM route was evaluated on paper. | `clipper2-ts` 2.0.1-18 + arcs flattened at 0.001 / 0.01 mm + a prototype greedy arc fitter | `packages/core/src/geometry/offset.ts` (this PR) |
| 1. Arc preservation | Yes, native bulges | Partly: the arcs come back only through fitting. The seam splits an arc (rect out: 9 vertices instead of 8; slot: 5 instead of 4) | Yes, native bulges, same vertex counts as A on every fixture |
| 2. Correctness: max \|dist − \|d\|\| on the fixtures | ≤ 2e-13 mm | 1.4e-3 mm at 0.001 tolerance (**over EPS** on the slot), 1.3e-2 mm at 0.01 | ≤ 2e-13 mm |
| 2. Orientation kept, closed stays closed | yes / yes | yes / yes (after the wrapper re-orients) | yes / yes (property-tested) |
| 3. Browser + Node + Worker | yes (pure ESM, no WASM) | yes (pure TS) | yes (pure TS, part of core) |
| 4. Bundle (esbuild, minified / gzip) | 66.3 kB / 19.0 kB | 63.2 kB / 17.3 kB (Clipper alone) + fitter | 8.8 kB / 3.6 kB (includes the segment/polyline helpers core already ships) |
| 5. Licence (D-009) | MIT OR Apache-2.0 ✔ | BSL-1.0 ✔ | n/a (our code) |
| 6. Maintenance, last release | JS port: 0.1.1, 2026-08-08 (two releases that day, none since), 27★, one maintainer, ports Rust **0.7.0** (Rust is at 0.9.0). Rust crate: 0.9.0, 2026-08-20, last commit 2026-10-21, 241★, one maintainer | `clipper2-ts`: only prerelease versions `2.0.1-N`; latest -19 is 9 days old (blocked by D-008), -18 is 2026-07-04. Upstream C++ repo `AngusJohnson/Clipper2` is **archived** | Ours |
| 7. Cost for a solo dev | Low to adopt (with an adapter for arcs > 180°); high if a bug needs a fork of a 74 kB port | High: arc fitting with tolerances and seam handling is its own project; output still off by ≈ the flattening tolerance | Already written (607 lines incl. docs) and tested; we own every bug |
| Speed, fixtures (one contour, 4–14 segments) | 0.04–0.48 ms | 0.02–14 ms (arch out: 13.6 ms) | 0.01–0.17 ms |
| Speed, 2000-segment contour | 17 ms | not measured | 130–320 ms (O(n²) worst case) |
| Random cross-check (9 987 star polygons with bulges) | reference | not run | **same area on 9 987 / 9 987**, max deviation 6.7e-5 mm |

**Recommendation: C (own implementation), with A (`cavalier-contours-js`) kept as a devDependency used only as a test oracle.** Revisit A, or the Rust crate via WASM, when we need multi-contour offsets with islands (pocket clearing) or contours with thousands of segments (large DXF). Reasons are in [Recommendation](#recommendation).

## Method

All three candidates ran on the same fixtures through one harness (scratch prototype, not committed, because it needs `clipper2-ts`). For every result it reported loops, vertices, arcs, the largest |distance − |d|| over samples (each vertex, 8 points per line, 32 per arc, distance measured exactly to the original lines and arcs), orientation, closedness, area error where the exact area is known, and the mean time over 20 runs (Node 26, Windows laptop).

Sign convention used everywhere: **d > 0 offsets to the right of travel**. With the stored directions (outer CCW, inner CW) `offset(contour, toolRadius)` is the tool-centre path for both: an outer contour grows, an inner contour (opening) shrinks.

Fixtures (tool radius 3 mm unless stated):

| Fixture | Input | Exact expectation |
| --- | --- | --- |
| rect out / in | 600 × 400 CCW, ±3 | out: 4 lines + 4 r3 arcs, area 606·406 − (4 − π)·9; in: 594 × 394 sharp |
| rounded rect out / in | 400 × 250 r20, ±3 | arcs r23 / r17; area formula |
| window | the CW inner contour of `mixed.json` `arch-panel`, +3 | 194 × 194 (CW) |
| small radius | CW opening 100 × 60 with r2 corners, tool r3 | sharp 94 × 54 corners + warning |
| arch panel | `mixed.json` outline (semicircle top), ±3 | semicircle stays one arc |
| slot | 200 × 20 stadium, −9 / −12 | −9: 200 × 2 slot, area 400 + π; −12: collapses |
| dumbbell (split) | two 100 × 100 squares joined by a 20 mm neck, −12 | two loops |
| sheet | 2440 × 1220 r10 rounded rect, ±5 | area formula |

## Measured results

`maxDev` = largest |distance − |d|| in mm. Area error in mm². A and C produce identical vertex counts, arcs and areas on every fixture, so they share one table.

| Fixture | A and C: loops / verts / arcs | A and C: maxDev | C: ms | A: ms | B (0.001 mm): verts / arcs | B: maxDev | B: area err | B: ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rect out +3 | 1 / 8 / 4 | 5e-14 | 0.17 | 0.48 | 9 / 4 | 1.0e-3 | 1e-4 | 0.69 |
| rect in −3 | 1 / 4 / 0 | 0 | 0.09 | 0.08 | 4 / 0 | 0 | 0 | 0.06 |
| rounded rect out +3 | 1 / 8 / 4 | 3e-14 | 0.08 | 0.24 | 8 / 4 | 1.5e-4 | 0.10 | 2.20 |
| rounded rect in −3 | 1 / 8 / 4 | 2e-14 | 0.06 | 0.18 | 8 / 4 | 1.5e-4 | 0.01 | 1.92 |
| window (CW) +3 | 1 / 4 / 0 | 0 | 0.04 | 0.05 | 4 / 0 | 0 | 0 | 0.02 |
| r2 corners, tool r3 | 1 / 4 / 0 (C warns `ARC_COLLAPSED`) | 0 | 0.06 | 0.21 | 4 / 0 | 0 | 0 | 1.67 |
| arch out +3 | 1 / 6 / 3 | 1e-13 | 0.03 | 0.08 | 7 / 3 | 1.0e-3 | – | 13.6 |
| arch in −3 | 1 / 4 / 1 | 1e-13 | 0.02 | 0.05 | 4 / 1 | 1e-5 | – | 4.53 |
| slot −9 | 1 / 4 / 2 | 9e-15 | 0.03 | 0.05 | 5 / 3 | **1.4e-3** | 0.39 | 2.29 |
| slot −12 | collapsed (C: `COLLAPSED`, A: empty) | – | 0.01 | 0.04 | empty | – | – | 14.0 |
| dumbbell −12 | 2 / 14 / 4 (C warns `SPLIT`) | 2e-14 | 0.13 | 0.28 | 14 / 4 | 8.7e-4 | 0 | 0.30 |
| sheet out +5 | 1 / 8 / 4 | 2e-13 | 0.03 | 0.06 | 8 / 4 | 4.3e-4 | 1.8 | 0.91 |
| sheet in −5 | 1 / 8 / 4 | 2e-13 | 0.03 | 0.06 | 8 / 4 | 4.9e-4 | 0.009 | 1.08 |

Area errors for A and C are ≤ 3e-11 mm² wherever the exact area is known. The dumbbell area includes the bump towards the neck: 2·(76² + 2·(120 − 5√44 − 72·asin(5/6))), which C matches to 1e-6 (unit test).

B with a 0.01 mm flattening tolerance is faster (0.04–1.9 ms) but maxDev grows to 1.3e-2 mm and the sheet area error to 17 mm². Without arc fitting B returns 128–1284 vertices per loop (e.g. arch out: 1284 lines).

### Random cross-check C vs A

10 000 random star-shaped polygons (3–16 vertices, radius 20–520 mm, concave corners, 40 % of edges bulged, either direction), random d up to ±30 % of the size:
- 13 inputs rejected by C as self-intersecting; A's `scanForSelfIntersect` agrees on all 13.
- On the other 9 987: same total area (relative 1e-6) on **9 987**, same loop count on 9 987.
- Worst |dist − |d||: C 6.7e-5 mm, A 4.5e-6 mm (both < EPS = 1e-3).
- Total time: C 656 ms, A 842 ms.

The committed property test repeats this check with fast-check on every run (`matches the CavalierContours port`), and was run locally with `OFFSET_RUNS=100` (≈ 95 000 cases per property) five times without a failure.

### Bugs found in `cavalier-contours-js` 0.1.1 while building the oracle

These are edge cases, but they are real wrong answers from candidate A. The first two are pinned as regression tests in `offset.test.ts` (C gives the correct result):

1. Rounded square 6.62 mm with 0.001 mm corner radii, inward 0.00104 mm: A returns a loop with **half** the area (21.9 instead of 43.8 mm²).
2. 14-vertex CW contour, 0.004 mm into the opening: A returns **nothing**.
3. A collapsing inward offset (d = 551 mm on a ~1000 mm star) **throws** `view data must be valid for source` (a debug assertion) instead of returning empty.
4. Near-flat arcs (radius ≈ 1e10 mm, bulge ≈ 1e-8): A's result is 0.01 mm off (> EPS). C replaces arcs over 10 km radius by lines within EPS/10.

The oracle test therefore compares only well-conditioned input (|d| ≥ 0.01 mm, arc radius ≤ 100 m, no loop under 0.01 mm² near a collapse) and does not compare loop counts at pinch points, where A splits into two touching loops and C keeps one loop with the same area.

### Performance on large contours (wavy circle, alternate edges bulged)

| Segments | C +3 | C −3 | A +3 | A −3 |
| --- | --- | --- | --- | --- |
| 100 | 6.6 ms | 2.9 ms | 7.3 ms | 2.6 ms |
| 500 | 13 ms | 26 ms | 7.3 ms | 7.6 ms |
| 2000 | 130 ms | 319 ms | 17 ms | 17 ms |

C uses an x-sweep for the intersections and bounding boxes for the distance test, but the distance test is still linear per sample. A uses a packed spatial index (flatbush port). For the M1–M3 parts (rectangles, rounded rectangles, freeform outlines with tens of segments) C stays under 1 ms.

## Candidate notes

### A. CavalierContours

- **Rust crate** (`jbuckmccready/cavalier_contours`): MIT OR Apache-2.0, 0.9.0 (2026-08-20), active (last commit 2026-10-21). Offsets open/closed bulge polylines, handles self-intersecting input, and has a multi-polyline `Shape` offset (islands and holes) and booleans.
- **No maintained WASM on npm.** `cavalier_contours_wasm` 0.0.3 is from 2021 (wasm 261 506 bytes, demo FFI only). Building our own: a wasm-bindgen wrapper crate (≈ 100–200 lines over `Float64Array`s), the Rust toolchain + `wasm32-unknown-unknown` + wasm-pack/wasm-bindgen in CI (or a committed artifact), async init in the worker and in Vitest, ≈ 250 kB wasm. It adds a second language and build chain, which §8.4 argues against ("tek dil").
- **Pure TS port** `cavalier-contours-js` 0.1.1: the practical form of A. Same algorithm, the full Rust test suite ported (232 tests), ESM, worker-friendly, 19 kB gzip. Risks: one maintainer, published once (two versions on 2026-08-08), no activity since, two Rust versions behind, and the four wrong answers above. Arcs over 180° (bulge > 1) must be split by our adapter (our model allows |sweep| < 2π).

### B. Clipper2 + arc fitting

- Polygon-only: arcs are flattened, offset as polygons with round joins, and arcs must be fitted back for G2/G3. The prototype fitter (greedy: extend a run while all points and chord sagittas fit a line or the circle through first/middle/last point) recovers the arc count on these fixtures, but:
  - the result is only as exact as the flattening tolerance (maxDev 1.4e-3 mm > EPS at 0.001 mm on the slot; 1.3e-2 mm at 0.01 mm);
  - arcs crossing the loop's start are split in two (seam), so G-code gets extra arcs;
  - 10–100× slower than A and C on arc-heavy parts (arch out: 13.6 ms vs 0.03 ms), because a fine flattening means many points;
  - a production-grade fitter (tolerance bands, tangent continuity, seam rotation, tiny-arc rejection) is a sizable project of its own.
- Maintenance: the upstream C++/C#/Delphi repo is archived; the TS port only publishes prerelease versions.

### C. Own implementation (this PR)

Approach (the CavalierContours method, written fresh for closed simple contours):
1. raw offset: lines shift along their normal, arcs keep their centre (radius ± d), neighbours are joined with an arc of radius |d| around the original vertex (round join = tool centre path);
2. self-intersections of the raw loop (x-sweep over bounding boxes), every segment split there;
3. pieces whose sample points come closer than |d| to the original are dropped (would gouge);
4. remaining pieces are stitched into closed loops (backtracking at nodes with several choices), collinear lines and co-circular arcs are merged back, loops with the wrong direction or an area ≤ EPS² are dropped.

API (`@nittcam/core`):

```ts
offset(poly: Polyline, d: number):
  | { ok: true; polylines: Polyline[]; warnings: ('ARC_COLLAPSED' | 'SPLIT')[] }
  | { ok: false; reason: 'INVALID_DISTANCE' | 'NOT_CLOSED' | 'DEGENERATE' | 'SELF_INTERSECTING' | 'COLLAPSED'; message: string }
```

Stated limits (also in the file header):
- one closed, simple contour per call; open polylines → `NOT_CLOSED`, crossing or touching input → `SELF_INTERSECTING`;
- a contour that disappears → `COLLAPSED`; a shrinking offset that splits returns all loops with `SPLIT`;
- an arc whose radius is smaller than |d| on the offset side becomes a sharp corner with `ARC_COLLAPSED` (spec: minimum concave corner radius = tool radius, warn);
- outline + inners are not offset together (no islands); each contour is offset on its own;
- arcs with radius > 10 km are replaced by lines within EPS/10 (float precision); nodes can move by up to 1e-4 mm (stitch tolerance);
- worst case O(n²) in the segment count (see performance).

Tests: 13 fixture tests + 2 regression tests from the oracle bugs + 6 input-check tests (`offset.test.ts`), and 4 fast-check properties (`offset.property.test.ts`): the |d| ± EPS distance property with closedness and direction, "a growing offset never fails and gets larger", invariance under translation and quarter turns, and the CavalierContours oracle.

## Recommendation

**C**, because on the evidence above it is as exact as A (identical results on all fixtures and on 9 987 random contours, deviation ≤ 6.7e-5 mm against an EPS of 1e-3 mm), keeps arcs natively, costs 3.6 kB, adds no runtime dependency and no second language, and avoids the wrong answers we found in the only maintained JS build of A. Its weak spot is speed on contours with thousands of segments (320 ms at 2000) and the missing multi-contour (island) offset; neither is needed for M1–M3.

Keep `cavalier-contours-js` as a **devDependency only** (test oracle; MIT OR Apache-2.0; 0.1.1 is older than two weeks, D-008). It never ships in the bundle.

B is not recommended: arcs survive only approximately, the result is off by about the flattening tolerance, and the upstream library is archived.

Triggers to revisit:
- pocket clearing / island offsets (`Shape` offset) → evaluate A (JS port, or Rust via WASM) again, or extend C;
- DXF contours with > 1000 segments in the editor loop → add a spatial index to C's distance test, or switch to A;
- a C bug we cannot fix quickly → A is a drop-in for single contours (the oracle test already maps the sign convention).

## Open questions for the PO

1. Accept C plus the test-only `cavalier-contours-js` devDependency, or prefer C without the oracle (the fast-check distance property alone)?
2. Sign convention: `d > 0` = right of travel (so `+toolRadius` is correct for both stored outer CCW and inner CW contours). Fine as the core API, or should the toolpath layer expose "outside / inside" instead?
3. `ARC_COLLAPSED`: the spec says "warn or auto-fix" for concave corners below the tool radius. C warns and returns the sharp-corner path. Is a warning enough for M1, and where should it show up (validation list)?
4. A shrinking offset that splits (`SPLIT`) returns all loops. Should toolpath cut every loop, or flag it as an error for inner contours?
5. Update the geometry-kernel skill's "Offset: Library: decided in T007" line together with D-013 (`.claude/` is outside the dev's scope).
