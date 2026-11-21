/**
 * Post processor config (spec §6.4, T017, D-025). A post is not code: it is this versioned,
 * declarative config, interpreted by the one generator in `generate.ts`. A new controller is
 * usually only a new config file in `packages/machines/<post>/v<n>/post.json`.
 *
 * Every §6.4 item has a field here. The schema also refuses configs that would break a §7.2 rule
 * by construction (no G21/G90/G17/work offset, no program end code, ...).
 */
import { z } from 'zod';

/** The post config schema version this build reads. */
export const POST_CONFIG_SCHEMA_VERSION = 1;

/** Work offsets accepted for rule 1 (§7.2). */
const WORK_OFFSETS = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'] as const;
/** Modal words that contradict what the generator writes (inch, incremental, other planes ...). */
const FORBIDDEN_MODAL = ['G20', 'G91', 'G18', 'G19', 'G93', 'G41', 'G42', 'G43'] as const;

const text = (max: number) => z.string({ error: 'must be a string' }).max(max);
/** A raw program line (printable ASCII only, no line breaks). */
const rawLine = z
  .string({ error: 'must be a string' })
  .min(1)
  .max(120)
  .regex(/^[\x20-\x7E]+$/, { error: 'must be printable ASCII without line breaks' });
const gWord = z
  .string({ error: 'must be a string' })
  .regex(/^G\d{1,3}(\.\d)?$/, { error: 'must be a G word like G21 or G91.1' });
const mWord = z
  .string({ error: 'must be a string' })
  .regex(/^M\d{1,3}$/, { error: 'must be an M word like M3' });
const decimals = (max: number) => z.number().int().min(0).max(max);

export const postConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(POST_CONFIG_SCHEMA_VERSION),
    /** Matches the machine profile's `post.id`. */
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/, { error: 'must be a lowercase id' }),
    /** Display name (data, shown as is), e.g. "Genel düz G-code". */
    name: text(80).min(1),
    /** Semantic version; every version has its own golden files. */
    version: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/, { error: 'must be like 1.0.0' }),
    /** `unverified` until checked against real NC files and a field test (§6.4, §12.3). */
    status: z.enum(['unverified', 'verified']),
    notes: text(1000).default(''),

    /** Program start/end blocks. Rule 7 needs an end code (M30 or M2) in `end`. */
    program: z.strictObject({
      /** Lines before the header comment (e.g. `%`). */
      prefix: z.array(rawLine).max(10),
      /** Extra lines after the modal line and before the first move. */
      start: z.array(rawLine).max(20),
      /** Program end lines, written last (after safe Z, spindle off, vacuum off). */
      end: z.array(rawLine).min(1).max(10),
      /** Lines after the end block (e.g. `%`). */
      suffix: z.array(rawLine).max(10),
    }),

    /** Comment syntax and sanitising. */
    comments: z.strictObject({
      style: z.enum(['paren', 'semicolon']),
      /** Transliterate Turkish letters and drop any other non-ASCII character. */
      asciiOnly: z.boolean(),
      /** Longest comment text (without the delimiters). */
      maxLength: z.number().int().min(16).max(250),
    }),

    /** N words. A number above `max` wraps back to `start`. */
    lineNumbers: z.strictObject({
      enabled: z.boolean(),
      start: z.number().int().min(0).max(99_999),
      increment: z.number().int().min(1).max(1_000),
      max: z.number().int().min(10).max(99_999_999),
    }),

    /**
     * Unit/mode words, written on one line at the start (rule 1). Must contain G21, G90, G17 and
     * a work offset G54–G59, plus the arc distance word when `arcs.distanceModeWord` is set.
     */
    modal: z.strictObject({
      words: z.array(gWord).min(4).max(12),
    }),

    /** auto = `T.. M6`; manual = comment + stop; none = one file per tool. */
    toolChange: z.strictObject({
      mode: z.enum(['auto', 'manual', 'none']),
      /**
       * Stop code of a manual change (the operator presses cycle start after changing). Only M0:
       * M1 is an optional stop the controller may skip, then the old tool cuts on (T311, D-100).
       */
      manualStop: z.literal('M0', { error: 'manual tool change must stop with M0' }),
      /** Write `G43 H<tool>` after a change when the profile has length compensation. */
      lengthOffset: z.boolean(),
      /**
       * Manual mode: also stop for the first tool (message + stop before the first spindle
       * start), so the operator confirms the right tool is in the spindle.
       */
      pauseForFirstTool: z.boolean(),
    }),

    spindle: z.strictObject({
      on: mWord,
      off: mWord,
      /** `after` = `M3 S18000`, `before` = `S18000 M3`. */
      speedPosition: z.enum(['after', 'before']),
      rpmDecimals: decimals(1),
    }),

    /** Warm-up dwell after spindle start: `G4 P<s>`, `G4 P<ms>` or `G4 X<s>`. */
    dwell: z.strictObject({
      word: z.enum(['P', 'X']),
      unit: z.enum(['s', 'ms']),
      decimals: decimals(3),
    }),

    motion: z.strictObject({
      rapid: z.enum(['G0', 'G00']),
      linear: z.enum(['G1', 'G01']),
      cw: z.enum(['G2', 'G02']),
      ccw: z.enum(['G3', 'G03']),
      /** Omit the motion code when it repeats the previous one. */
      suppressRepeatedCode: z.boolean(),
      /** Omit axis words whose written value did not change (arcs always write X and Y). */
      suppressUnchangedAxes: z.boolean(),
      /**
       * The controller understands `G53` (one-block machine coordinates), needed for the park
       * point of a manual tool change (T309, D-097). Absent = not supported (park stays off).
       */
      machineCoordinates: z.boolean().optional(),
    }),

    /** Decimal places per word. */
    decimals: z.strictObject({
      xy: decimals(6),
      z: decimals(6),
      arc: decimals(6),
      feed: decimals(3),
    }),

    arcs: z.strictObject({
      /** false = split every arc into lines within `chordTolerance`. */
      enabled: z.boolean(),
      mode: z.enum(['ijIncremental', 'ijAbsolute', 'r']),
      /** Arc distance mode word written in the modal line (G91.1 / G90.1), or null. */
      distanceModeWord: z.enum(['G91.1', 'G90.1']).nullable(),
      /** A full circle in one block (I/J only); false = split in halves. */
      fullCircle: z.boolean(),
      /** Helical arcs (Z changes); false = split into lines. */
      helical: z.boolean(),
      /** Largest sweep of one block, degrees; longer arcs are split evenly. */
      maxSweepDeg: z.number().min(10).max(360),
      /** Max distance between an arc and its line approximation, mm. */
      chordTolerance: z.number().min(0.0005).max(1),
    }),

    /** Drill operations as G81 (one per peck) when not "none" and the profile allows cycles; G83 is never written (D-050). */
    drill: z.strictObject({
      cycles: z.enum(['none', 'G81', 'G83']),
    }),

    /** Write the profile's vacuum on/off M codes. */
    vacuum: z.strictObject({
      enabled: z.boolean(),
    }),

    file: z.strictObject({
      extension: z.string().regex(/^[a-z0-9]{1,5}$/, { error: 'must be like nc or tap' }),
      /** Longest file name including the extension (the profile may lower it). */
      maxNameLength: z.number().int().min(8).max(255),
      lineEnding: z.enum(['crlf', 'lf']),
      /** Largest file in bytes (the profile's MB limit may lower it). */
      maxSizeBytes: z
        .number()
        .int()
        .min(1_024)
        .max(4 * 1024 ** 3),
      /** What to do with a larger program: split at operation boundaries, or refuse. */
      onOversize: z.enum(['split', 'error']),
    }),
  })
  .superRefine((c, ctx) => {
    const words = c.modal.words;
    const need = (word: string, why: string) => {
      if (!words.includes(word)) {
        ctx.addIssue({
          code: 'custom',
          path: ['modal', 'words'],
          message: `${word} missing: ${why}`,
        });
      }
    };
    need('G21', 'units must be millimetres (rule 1)');
    need('G90', 'absolute distance mode (rule 1)');
    need('G17', 'XY plane (rule 1)');
    if (!words.some((w) => (WORK_OFFSETS as readonly string[]).includes(w))) {
      ctx.addIssue({
        code: 'custom',
        path: ['modal', 'words'],
        message: 'work offset G54–G59 missing (rule 1)',
      });
    }
    for (const w of words) {
      if ((FORBIDDEN_MODAL as readonly string[]).includes(w)) {
        ctx.addIssue({
          code: 'custom',
          path: ['modal', 'words'],
          message: `${w} contradicts the generated program`,
        });
      }
    }
    if (new Set(words).size !== words.length) {
      ctx.addIssue({ code: 'custom', path: ['modal', 'words'], message: 'duplicate modal word' });
    }
    const arcWord = c.arcs.distanceModeWord;
    if (arcWord !== null) need(arcWord, 'arc distance mode declared in arcs.distanceModeWord');
    for (const w of ['G90.1', 'G91.1']) {
      if (words.includes(w) && w !== arcWord) {
        ctx.addIssue({
          code: 'custom',
          path: ['modal', 'words'],
          message: `${w} must match arcs.distanceModeWord`,
        });
      }
    }
    if (c.arcs.mode === 'ijAbsolute' && arcWord !== 'G90.1') {
      ctx.addIssue({
        code: 'custom',
        path: ['arcs', 'distanceModeWord'],
        message: 'absolute I/J needs G90.1 written explicitly',
      });
    }
    if (c.arcs.mode === 'ijIncremental' && arcWord === 'G90.1') {
      ctx.addIssue({
        code: 'custom',
        path: ['arcs', 'distanceModeWord'],
        message: 'incremental I/J cannot use G90.1',
      });
    }
    if (c.arcs.mode === 'r' && (c.arcs.fullCircle || c.arcs.maxSweepDeg > 179)) {
      ctx.addIssue({
        code: 'custom',
        path: ['arcs', 'maxSweepDeg'],
        message: 'R arcs: no full circle and at most 179° per block (R is ambiguous near 180°)',
      });
    }
    if (!c.program.end.some((l) => /\bM(30|2|02)\b/.test(l))) {
      ctx.addIssue({
        code: 'custom',
        path: ['program', 'end'],
        message: 'program end code M30 or M2 missing (rule 7)',
      });
    }
    if (c.spindle.on === c.spindle.off) {
      ctx.addIssue({ code: 'custom', path: ['spindle', 'off'], message: 'on and off codes equal' });
    }
    if (c.lineNumbers.start > c.lineNumbers.max) {
      ctx.addIssue({ code: 'custom', path: ['lineNumbers', 'start'], message: 'start above max' });
    }
  });

export type PostConfig = z.infer<typeof postConfigSchema>;
export type PostConfigInput = z.input<typeof postConfigSchema>;

export type ParsePostConfigResult =
  { ok: true; config: PostConfig } | { ok: false; issues: { path: string; message: string }[] };

/** Validates raw post config JSON. Never throws. */
export function parsePostConfig(json: unknown): ParsePostConfigResult {
  const r = postConfigSchema.safeParse(json);
  if (r.success) return { ok: true, config: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
  };
}

/**
 * Posts shipped with NittCam (the machine form offers these ids). The configs themselves live in
 * `packages/machines/<id>/v1/post.json`; a core test checks that this list matches them.
 */
export const KNOWN_POSTS = [
  { id: 'generic', version: '1.0.0', name: 'Genel düz G-code' },
  { id: 'mach3', version: '1.0.0', name: 'Mach3' },
] as const;

export type KnownPostId = (typeof KNOWN_POSTS)[number]['id'];

/** "1.0" → "1.0.0" (the profile allows a two-part version). */
export function normalizePostVersion(version: string): string {
  const parts = version.trim().split('.');
  while (parts.length < 3) parts.push('0');
  return parts.map((p) => String(Number(p))).join('.');
}
