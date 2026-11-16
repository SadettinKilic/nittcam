---
name: nesting-engine
description: Touching nesting: rectangle placer, modes, grain rule, offcuts, locks, determinism. Spec §6.2. Use for packages/core/nesting.
---

# Nesting engine (spec §6.2)

Own MaxRects + guillotine heuristics. Try several orderings and heuristics; pick the lowest objective:
`min( A_waste + λ·L_cut + μ·N_toolchange + ν·C_handling )`. Modes (minWaste / fastest / fewestToolChanges) are just weight presets.

## Invariants (each needs a fast-check test)
1. No two placements overlap (inflated by gap/2 + tool diameter considerations).
2. Every part lies inside the sheet minus the margin.
3. Gap rule satisfied.
4. grainLock parts rotate only 0°/180°; others 0/90/180/270.
5. **Deterministic:** same input, same output. No randomness; stable sorts; seedless.
6. Locked placements are never moved by re-nesting.
7. Parts that do not fit open a new sheet; report the sheet count. A part larger than the sheet is a validation error, not an infinite loop.

Freeform/DXF parts are nested by their bounding rectangle (true-shape nesting is a later version).
Offcuts: try saved offcuts of the same material and thickness first. After nesting, offer leftover rectangles above the threshold (default 300×300) to save, with user confirmation.
Keep benchmark datasets in `packages/core/nesting/__bench__/` and track utilisation % over time.
