---
name: geometry-kernel
description: Touching geometry code: bulge polylines, units, contour direction, epsilon, offset, fillet, dogbone. Spec §6.1, §4.4, §6.3. Use for anything in packages/core/geometry.
---

# Geometry kernel (spec §6.1)

- **Units:** millimetres everywhere inside. Convert only in the UI and the post processor.
- **Representation:** bulge polyline: vertices `{x, y, bulge}`; bulge = tan(θ/4) of the arc to the next vertex (0 = line). Same model as DXF LWPOLYLINE, so G2/G3 come out directly.
- **Direction:** outer contour CCW, inner contour CW. Normalize on input.
- **Coordinates:** a part is in its local frame; the sheet origin is bottom-left, X right, Y up. Conversion to the machine origin happens **only** in the post.
- **Z:** Z=0 is the material top, negative goes down. Conversion to the machine Z reference happens only in the post.
- **Tolerance:** one `EPS = 0.001` mm and one `JOIN_TOL = 0.05` mm in `geometry/constants.ts`. No scattered magic numbers.
- **Offset:** the tool-centre path is offset by the tool radius; outer contours outward, inner contours and holes inward. Arcs stay arcs. Implementation: our own `geometry/offset.ts` (D-013). `offset(poly, d)`, d > 0 = right of travel; with outer CCW / inner CW, `+toolRadius` is the tool-centre path. `ARC_COLLAPSED` = warning; `SPLIT` on an inner contour = export-blocking error. The test oracle is `cavalier-contours-js` (dev only).
- **Rules:** minimum concave corner radius = tool radius (warn or auto-fix); fillet radius is clamped to the adjacent segments; dogbone/T-bone overcut = tool radius; closed-contour auto-join within JOIN_TOL.
- **Purity:** no Date, Math.random, I/O.

## Property tests (fast-check)
- every offset point lies at tool radius ± EPS from the original contour
- direction preserved; closed stays closed
- area/bbox/length consistent under translation and rotation
- signed area > 0 ⇔ CCW
