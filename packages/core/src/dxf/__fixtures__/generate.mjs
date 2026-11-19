/**
 * Writes the DXF test fixtures (T144). Run: `node packages/core/src/dxf/__fixtures__/generate.mjs`.
 * The files imitate dirty real-world exports (AutoCAD/LibreCAD/sign software): subclass markers,
 * handles, CRLF line ends, gaps, duplicates, mixed entity kinds, blocks, paper space, no units.
 * The generated .dxf files are committed; change this script and re-run to update them.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let handle = 0x100;
const h = () => (handle++).toString(16).toUpperCase();

function g(pairs) {
  return pairs.map(([c, v]) => `${String(c).padStart(3, ' ')}\n${v}`).join('\n');
}

function file({ insunits, entities, blocks = [], crlf = false }) {
  const header =
    insunits === undefined
      ? [
          [0, 'SECTION'],
          [2, 'HEADER'],
          [9, '$ACADVER'],
          [1, 'AC1015'],
          [0, 'ENDSEC'],
        ]
      : [
          [0, 'SECTION'],
          [2, 'HEADER'],
          [9, '$ACADVER'],
          [1, 'AC1015'],
          [9, '$INSUNITS'],
          [70, insunits],
          [0, 'ENDSEC'],
        ];
  const pairs = [
    ...header,
    [0, 'SECTION'],
    [2, 'BLOCKS'],
    ...blocks.flat(),
    [0, 'ENDSEC'],
    [0, 'SECTION'],
    [2, 'ENTITIES'],
    ...entities.flat(),
    [0, 'ENDSEC'],
    [0, 'EOF'],
  ];
  const text = g(pairs) + '\n';
  return crlf ? text.replace(/\n/g, '\r\n') : text;
}

const common = (type, layer, extra = []) => [
  [0, type],
  [5, h()],
  [100, 'AcDbEntity'],
  [8, layer],
  ...extra,
];

const line = (layer, x1, y1, x2, y2) => [
  ...common('LINE', layer),
  [100, 'AcDbLine'],
  [10, x1],
  [20, y1],
  [30, 0],
  [11, x2],
  [21, y2],
  [31, 0],
];
const circle = (layer, x, y, r, nz = 1) => [
  ...common('CIRCLE', layer),
  [100, 'AcDbCircle'],
  [10, x],
  [20, y],
  [30, 0],
  [40, r],
  ...(nz === 1
    ? []
    : [
        [210, 0],
        [220, 0],
        [230, nz],
      ]),
];
const arc = (layer, x, y, r, a0, a1, nz = 1) => [
  ...common('ARC', layer),
  [100, 'AcDbCircle'],
  [10, x],
  [20, y],
  [30, 0],
  [40, r],
  ...(nz === 1
    ? []
    : [
        [210, 0],
        [220, 0],
        [230, nz],
      ]),
  [100, 'AcDbArc'],
  [50, a0],
  [51, a1],
];
const lwpoly = (layer, pts, closed, extra = []) => [
  ...common('LWPOLYLINE', layer),
  [100, 'AcDbPolyline'],
  [90, pts.length],
  [70, closed ? 1 : 0],
  [43, 0],
  ...extra,
  ...pts.flatMap(([x, y, b = 0]) => [[10, x], [20, y], ...(b ? [[42, b]] : [])]),
];
const text = (layer, x, y, s) => [
  ...common('TEXT', layer),
  [100, 'AcDbText'],
  [10, x],
  [20, y],
  [30, 0],
  [40, 10],
  [1, s],
  [100, 'AcDbText'],
];
const mtext = (layer, x, y, s) => [
  ...common('MTEXT', layer),
  [100, 'AcDbMText'],
  [10, x],
  [20, y],
  [30, 0],
  [40, 10],
  [1, s],
];
const hatch = (layer) => [
  ...common('HATCH', layer),
  [100, 'AcDbHatch'],
  [10, 0],
  [20, 0],
  [30, 0],
  [210, 0],
  [220, 0],
  [230, 1],
  [2, 'SOLID'],
  [70, 1],
  [71, 0],
  [91, 1],
  [92, 2],
  [72, 0],
  [73, 1],
  [93, 0],
  [97, 0],
  [75, 0],
  [76, 1],
  [98, 0],
];
const dimension = (layer) => [
  ...common('DIMENSION', layer),
  [100, 'AcDbDimension'],
  [2, '*D1'],
  [10, 0],
  [20, -20],
  [30, 0],
  [11, 300],
  [21, -20],
  [31, 0],
  [70, 32],
  [1, ''],
  [100, 'AcDbAlignedDimension'],
  [13, 0],
  [23, 0],
  [33, 0],
  [14, 600],
  [24, 0],
  [34, 0],
];
const ellipse = (layer, cx, cy, mx, my, ratio, t0, t1, nz = 1) => [
  ...common('ELLIPSE', layer),
  [100, 'AcDbEllipse'],
  [10, cx],
  [20, cy],
  [30, 0],
  [11, mx],
  [21, my],
  [31, 0],
  ...(nz === 1
    ? []
    : [
        [210, 0],
        [220, 0],
        [230, nz],
      ]),
  [40, ratio],
  [41, t0],
  [42, t1],
];
const spline = (layer, { degree, flags, knots = [], controls = [], weights = [], fits = [] }) => [
  ...common('SPLINE', layer),
  [100, 'AcDbSpline'],
  [210, 0],
  [220, 0],
  [230, 1],
  [70, flags],
  [71, degree],
  [72, knots.length],
  [73, controls.length],
  [74, fits.length],
  [42, 1e-10],
  [43, 1e-10],
  [44, 1e-10],
  ...knots.map((k) => [40, k]),
  ...(weights.length
    ? controls.flatMap(([x, y], i) => [
        [10, x],
        [20, y],
        [30, 0],
        [41, weights[i]],
      ])
    : controls.flatMap(([x, y]) => [
        [10, x],
        [20, y],
        [30, 0],
      ])),
  ...fits.flatMap(([x, y]) => [
    [11, x],
    [21, y],
    [31, 0],
  ]),
];
const insert = (layer, name, x, y, { sx = 1, sy = 1, rot = 0, cols, rows, cs, rs } = {}) => [
  ...common('INSERT', layer),
  [100, 'AcDbBlockReference'],
  [2, name],
  [10, x],
  [20, y],
  [30, 0],
  [41, sx],
  [42, sy],
  [43, 1],
  [50, rot],
  ...(cols
    ? [
        [70, cols],
        [71, rows],
        [44, cs],
        [45, rs],
      ]
    : []),
];
const block = (name, bx, by, entities) => [
  [0, 'BLOCK'],
  [5, h()],
  [100, 'AcDbEntity'],
  [8, '0'],
  [100, 'AcDbBlockBegin'],
  [2, name],
  [70, 0],
  [10, bx],
  [20, by],
  [30, 0],
  [3, name],
  [1, ''],
  ...entities.flat(),
  [0, 'ENDBLK'],
  [5, h()],
  [100, 'AcDbEntity'],
  [8, '0'],
  [100, 'AcDbBlockEnd'],
];

const q = Math.tan(Math.PI / 8); // bulge of a 90° arc

/** Rounded rectangle (CCW) with corner radius r as LWPOLYLINE points. */
function roundedRect(x, y, w, hgt, r) {
  return [
    [x + r, y],
    [x + w - r, y, q],
    [x + w, y + r],
    [x + w, y + hgt - r, q],
    [x + w - r, y + hgt],
    [x + r, y + hgt, q],
    [x, y + hgt - r],
    [x, y + r, q],
  ];
}

const out = {
  // 600 × 400 panel from four LINEs with 0.03 mm gaps, one duplicate line, an open scribe line,
  // and annotation entities to be counted as ignored. CRLF line ends like Windows exports.
  'rect-lines-gaps.dxf': file({
    insunits: 4,
    crlf: true,
    entities: [
      line('CUT', 0, 0, 600, 0),
      line('CUT', 600.03, 0, 600, 400),
      line('CUT', 600, 400, 0.02, 400.01),
      line('CUT', 0, 400, 0, 0.03),
      line('CUT', 0, 0, 600, 0), // duplicate
      line('SCRIBE', 100, 100, 200, 100), // open
      text('TEXT', 10, 10, 'PANEL A'),
      mtext('TEXT', 10, 30, 'Not: 18 mm'),
      dimension('DIM'),
      hatch('HATCH'),
    ],
  }),
  // Rounded rectangle with a round hole, a CW-drawn slot (bulge −1), an open arc and an arc on a
  // mirrored OCS (extrusion 0,0,−1).
  'lwpoly-bulge.dxf': file({
    insunits: 4,
    entities: [
      lwpoly('OUTER', roundedRect(0, 0, 300, 200, 20), true),
      circle('HOLES', 50, 50, 10),
      lwpoly(
        'INNER',
        [
          [120, 90, -1],
          [120, 110, 0],
          [180, 110, -1],
          [180, 90, 0],
        ],
        true,
      ),
      arc('MISC', 250, 150, 15, 0, 90),
      arc('MISC', -250, 150, 15, 0, 90, -1),
    ],
  }),
  // 10 × 5 inch panel.
  'inch-units.dxf': file({
    insunits: 1,
    entities: [
      lwpoly(
        '0',
        [
          [0, 0],
          [10, 0],
          [10, 5],
          [0, 5],
        ],
        true,
      ),
    ],
  }),
  // 2 × 3 rectangle without $INSUNITS (cm or inch drawn as unitless) → the unit must be asked.
  'no-units-small.dxf': file({
    insunits: undefined,
    entities: [
      lwpoly(
        '0',
        [
          [0, 0],
          [2, 0],
          [2, 3],
          [0, 3],
        ],
        true,
      ),
    ],
  }),
  // Curves: a rational quarter circle (r 100), a closed cubic B-spline, full and partial
  // ellipses, a circular ellipse and a fit-point spline.
  'spline-ellipse.dxf': file({
    insunits: 4,
    entities: [
      spline('CURVE', {
        degree: 2,
        flags: 12,
        knots: [0, 0, 0, 1, 1, 1],
        controls: [
          [100, 0],
          [100, 100],
          [0, 100],
        ],
        weights: [1, Math.SQRT1_2, 1],
      }),
      spline('CURVE', {
        degree: 3,
        flags: 9,
        knots: [0, 0, 0, 0, 1, 2, 3, 4, 4, 4, 4],
        controls: [
          [300, 0],
          [400, 0],
          [450, 80],
          [400, 160],
          [300, 160],
          [250, 80],
          [300, 0],
        ],
      }),
      ellipse('CURVE', 600, 100, 80, 0, 0.5, 0, 2 * Math.PI),
      ellipse('CURVE', 800, 100, 0, 60, 0.4, 0, Math.PI),
      ellipse('CURVE', 1000, 100, 50, 0, 1, 0, 2 * Math.PI),
      spline('CURVE', {
        degree: 3,
        flags: 8,
        fits: [
          [0, 300],
          [100, 350],
          [200, 300],
          [300, 350],
        ],
      }),
    ],
  }),
  // A block used several ways: plain, rotated + scaled, mirrored, non-uniform, an array, a
  // missing block, a nested INSERT inside the block (skipped), and paper-space junk.
  'insert-block.dxf': file({
    insunits: 4,
    blocks: [
      block('PANEL', 10, 10, [
        lwpoly(
          '0',
          [
            [10, 10],
            [110, 10],
            [110, 60],
            [10, 60],
          ],
          true,
        ),
        circle('DRILL', 30, 30, 5),
        arc('0', 90, 40, 10, 0, 180),
        insert('0', 'SCREW', 0, 0),
      ]),
      block('SCREW', 0, 0, [circle('0', 0, 0, 2)]),
    ],
    entities: [
      insert('CUT', 'PANEL', 0, 0),
      insert('CUT', 'PANEL', 500, 0, { sx: 2, sy: 2, rot: 90 }),
      insert('CUT', 'PANEL', 1000, 0, { sx: -1, sy: 1 }),
      insert('CUT', 'PANEL', 0, 500, { sx: 2, sy: 1 }),
      insert('CUT', 'PANEL', 0, 1000, { cols: 2, rows: 2, cs: 150, rs: 100 }),
      insert('CUT', 'NOPE', 0, 0),
      [
        ...common('LINE', 'VIEW', [[67, 1]]),
        [100, 'AcDbLine'],
        [10, 0],
        [20, 0],
        [30, 0],
        [11, 10],
        [21, 0],
        [31, 0],
      ],
    ],
  }),
  // Old-style POLYLINE/VERTEX/SEQEND with bulges (closed), and a non-flat 3D polyline.
  'polyline-r12.dxf': file({
    insunits: 4,
    entities: [
      [
        ...common('POLYLINE', 'CUT'),
        [100, 'AcDb2dPolyline'],
        [66, 1],
        [10, 0],
        [20, 0],
        [30, 0],
        [70, 1],
        ...[
          [0, 0, 0],
          [200, 0, 1],
          [200, 100, 0],
          [0, 100, 0],
        ].flatMap(([x, y, b]) => [
          [0, 'VERTEX'],
          [5, h()],
          [100, 'AcDbEntity'],
          [8, 'CUT'],
          [100, 'AcDbVertex'],
          [100, 'AcDb2dVertex'],
          [10, x],
          [20, y],
          [30, 0],
          ...(b ? [[42, b]] : []),
          [70, 0],
        ]),
        [0, 'SEQEND'],
        [5, h()],
        [100, 'AcDbEntity'],
        [8, 'CUT'],
      ],
      [
        ...common('POLYLINE', 'CUT'),
        [100, 'AcDb3dPolyline'],
        [66, 1],
        [10, 0],
        [20, 0],
        [30, 0],
        [70, 8],
        ...[
          [0, 0, 0],
          [50, 0, 10],
          [50, 50, 0],
        ].flatMap(([x, y, z]) => [
          [0, 'VERTEX'],
          [5, h()],
          [100, 'AcDbEntity'],
          [8, 'CUT'],
          [100, 'AcDbVertex'],
          [100, 'AcDb3dPolylineVertex'],
          [10, x],
          [20, y],
          [30, z],
          [70, 32],
        ]),
        [0, 'SEQEND'],
        [5, h()],
        [100, 'AcDbEntity'],
        [8, 'CUT'],
      ],
    ],
  }),
  // Sign letters "N", "O", "L" (~200 mm tall) like sign software exports them: O as an outer and
  // an inner ring, L drawn as a LINE soup with tiny gaps and one reversed line, plus fill hatch
  // and a text note that are ignored.
  'sign-letters.dxf': file({
    insunits: 4,
    entities: [
      lwpoly(
        'HARF',
        [
          [0, 0],
          [40, 0],
          [40, 130],
          [120, 0],
          [160, 0],
          [160, 200],
          [120, 200],
          [120, 70],
          [40, 200],
          [0, 200],
        ],
        true,
      ),
      lwpoly(
        'HARF',
        [
          [200, 100, 1],
          [400, 100, 1],
        ],
        true,
      ),
      lwpoly(
        'HARF',
        [
          [250, 100, 1],
          [350, 100, 1],
        ],
        true,
      ),
      line('HARF', 450, 0, 580, 0),
      line('HARF', 580.02, 0, 580, 40),
      line('HARF', 490, 40, 580, 40.01), // reversed
      line('HARF', 490, 40, 490, 200),
      line('HARF', 490, 200, 450.01, 200),
      line('HARF', 450, 200, 450, 0.02),
      hatch('DOLGU'),
      mtext('NOT', 0, -30, 'NOL tabela 18mm MDF'),
    ],
  }),
};

for (const [name, content] of Object.entries(out)) writeFileSync(join(here, name), content);
console.log(`wrote ${Object.keys(out).length} fixtures`);
