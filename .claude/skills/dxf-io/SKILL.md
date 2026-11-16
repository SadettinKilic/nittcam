---
name: dxf-io
description: DXF import/export: supported entities, units, join tolerance, part recognition, layer mapping, test files. Spec §4.6.
---

# DXF I/O (spec §4.6)

- **Supported:** LINE, ARC, CIRCLE, LWPOLYLINE (with bulge), POLYLINE, single-level INSERT.
- **Converted:** SPLINE and ELLIPSE to lines/arcs within tolerance; tell the user.
- **Ignored:** TEXT/MTEXT, DIMENSION, HATCH; report the counts.
- **Units:** read $INSUNITS; if missing or suspicious (e.g. a part comes out 2 mm), ask.
- **Join:** endpoints within 0.05 mm join into closed contours; unclosed ones are flagged.
- **Part recognition:** the outermost closed contour is the part; contours inside it are inner contours or holes; circles can become hole objects.
- **Layer mapping:** layer name → operation (outer cut, inner cut, pocket, drill, on-line). Stored as a company setting.
- **DWG:** not supported; tell the user to save as DXF.
- Import always goes through a preview + confirm screen and produces commands (`importDxf`).
- Reading: `dxf-parser` is a candidate (licence and maintenance checked in M0). Writing: our own writer, with layers by operation.
- Test files in `packages/core/dxf/__fixtures__/`: include dirty real-world files (gaps, duplicates, mixed units).
