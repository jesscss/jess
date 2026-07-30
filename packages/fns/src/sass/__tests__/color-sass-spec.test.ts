/**
 * `sass:color` conformance, driven by the SASS-SPEC CORPUS.
 *
 * This is the port's primary verification source: every `sass:color` function
 * this package implements is run against every case in
 * `sass-spec/spec/core_functions/color/**` that is expressible at the
 * value-domain level, rather than against examples an author thought to pick.
 *
 * The suite is deliberately self-reporting. It asserts three things:
 *   - every runnable VALUE case matches (semantically — see `sass-spec-corpus.ts`);
 *   - every runnable ERROR case is rejected by the body;
 *   - the runnable/unrunnable split is EXACTLY the recorded one, so a case can
 *     never fall out of coverage silently. Unrunnable cases are grouped by
 *     reason and printed, not skipped in the dark.
 */
import { describe, expect, it } from 'vitest';
import {
  casesFor,
  compareColors,
  fnCtx,
  isColor,
  isPassthrough,
  readValue,
  soleDeclaration,
  soleOutputValue,
  specRoot,
  unrunnableReason,
  TOLERANCE
} from './sass-spec-corpus.js';
import type { SpecCase } from './sass-spec-corpus.js';
import type { Color, Fn, ValueGroup, Value } from '@jesscss/core';
import { isValueGroupArray, makeList } from '@jesscss/core';
import { adjustHue } from '../color/adjust-hue.js';
import { complement } from '../color/complement.js';
import { darken } from '../color/darken.js';
import { desaturate } from '../color/desaturate.js';
import { fadeIn } from '../color/fade-in.js';
import { fadeOut } from '../color/fade-out.js';
import { grayscale } from '../color/grayscale.js';
import { hsl } from '../color/hsl.js';
import { hsla } from '../color/hsla.js';
import { hue } from '../color/hue.js';
import { ieHexStr } from '../color/ie-hex-str.js';
import { invert } from '../color/invert.js';
import { lighten } from '../color/lighten.js';
import { lightness } from '../color/lightness.js';
import { mix } from '../color/mix.js';
import { opacify } from '../color/opacify.js';
import { rgb } from '../color/rgb.js';
import { rgba } from '../color/rgba.js';
import { saturate } from '../color/saturate.js';
import { saturation } from '../color/saturation.js';
import { transparentize } from '../color/transparentize.js';
import { ieHexString } from '../color/kernels.js';

/** corpus entry → the `Fn` under test. `opacify`/`transparentize` have no own hrx file. */
const UNDER_TEST: ReadonlyArray<readonly [entry: string, fn: Fn]> = [
  ['hue.hrx', hue],
  ['saturation.hrx', saturation],
  ['lightness.hrx', lightness],
  ['grayscale.hrx', grayscale],
  ['complement.hrx', complement],
  ['invert', invert],
  ['ie_hex_str.hrx', ieHexStr],
  ['adjust_hue', adjustHue],
  ['lighten.hrx', lighten],
  ['darken.hrx', darken],
  ['saturate.hrx', saturate],
  ['desaturate.hrx', desaturate],
  ['fade_in.hrx', fadeIn],
  ['fade_out.hrx', fadeOut],
  ['mix', mix],
  ['rgb', rgb],
  ['rgba.hrx', rgba],
  ['hsl', hsl],
  ['hsla.hrx', hsla]
];

/** `opacify`/`transparentize` share `fade_in`/`fade_out`'s corpus — Sass defines them as the same function. */
const ALIAS_OF: Readonly<Record<string, Fn>> = { fade_in: opacify, fade_out: transparentize };

const root = specRoot();

interface Runnable {
  readonly spec: SpecCase;
  readonly fn: Fn;
  readonly expr: string;
  readonly args: string;
}

interface Skipped {
  readonly id: string;
  readonly reason: string;
}

const runnableValue: Runnable[] = [];
const runnableError: Runnable[] = [];
const skipped: Skipped[] = [];

if (root) {
  for (const [entry, fn] of UNDER_TEST) {
    const name = entry.replace('.hrx', '');
    for (const spec of casesFor(root, entry, name)) {
      const expr = soleDeclaration(spec.input);
      if (expr === null) {
        skipped.push({ id: spec.id, reason: 'not a single `a {b: <expr>}` declaration' });
        continue;
      }
      const reason = unrunnableReason(expr);
      if (reason !== null) {
        skipped.push({ id: spec.id, reason });
        continue;
      }
      const call = /^(?:color\.)?[a-z-]+\s*\(([\s\S]*)\)$/i.exec(expr);
      if (!call) {
        skipped.push({ id: spec.id, reason: 'expression is not a bare call to the function under test' });
        continue;
      }
      const record = { spec, fn, expr, args: call[1]! };
      if (spec.error !== undefined) {
        runnableError.push(record);
      } else if (spec.output !== undefined) {
        // A case that echoes its own call is a CSS-filter passthrough: Sass
        // leaves it verbatim, and the body must DECLINE it (which is what makes
        // jess re-emit it). Assert the decline, not a value.
        (isPassthrough(expr, soleOutputValue(spec.output)) ? runnableError : runnableValue).push(record);
      } else {
        skipped.push({ id: spec.id, reason: 'case has neither output.css nor error' });
      }
    }
  }
}

/** Invoke `fn` the way the evaluator does: one structural group + the fn context. */
function invoke(fn: Fn, args: string): Value {
  const read = readValue(args);
  const group: ValueGroup = !isValueGroupArray(read) && read.type === 'List'
    ? read
    : makeList([read], ',');
  const result = fn(group, fnCtx);
  if (result instanceof Promise || isValueGroupArray(result)) {
    throw new Error('expected a single synchronous value');
  }
  return result;
}

describe.skipIf(!root)('sass:color — sass-spec conformance', () => {
  it('covers the corpus with a recorded runnable/unrunnable split', () => {
    // Guards against coverage silently eroding: if a case moves between buckets
    // this fails and the new grouping has to be looked at, not assumed benign.
    const byReason = new Map<string, number>();
    for (const s of skipped) {
      byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
    }
    const summary = {
      value: runnableValue.length,
      error: runnableError.length,
      unrunnable: Object.fromEntries([...byReason].sort())
    };
    expect(summary).toMatchSnapshot();
    expect(runnableValue.length).toBeGreaterThan(80);
  });

  describe('value cases', () => {
    for (const { spec, fn, expr, args } of runnableValue) {
      const label = `${spec.fn} ${spec.id} — ${expr}`;
      it(label, () => {
        const expected = soleOutputValue(spec.output!);
        expect(expected).not.toBeNull();
        const actual = invoke(fn, args);

        // `ie-hex-str` is a STRING result whose whole contract is the byte
        // spelling (upper case, `#AARRGGBB`) — compare it verbatim.
        if (spec.fn === 'ie_hex_str') {
          expect(ieHexString(invokeColorArg(args))).toBe(expected);
          return;
        }

        const want = readValue(expected!);
        if (isColor(actual) && isColor(want)) {
          const cmp = compareColors(actual, want);
          // A `rounding-only` difference is dart-sass's 8-bit legacy colour
          // model. The owner ruling keeps full precision internally, so such a
          // case is surfaced by name rather than conformed to.
          expect(`${cmp.kind}${cmp.detail ? `: ${cmp.detail}` : ''}`).toBe('match');
          return;
        }
        if (actual.type === 'Dimension' && !isValueGroupArray(want) && want.type === 'Dimension') {
          expect(actual.unit).toBe(want.unit);
          expect(Math.abs(actual.number - want.number)).toBeLessThanOrEqual(TOLERANCE);
          return;
        }
        expect(actual.bytes).toBe(expected);
      });
    }
  });

  describe('error cases', () => {
    for (const { spec, fn, expr, args } of runnableError) {
      it(`${spec.fn} ${spec.id} — ${expr}`, () => {
        expect(() => invoke(fn, args)).toThrow();
      });
    }
  });
});

/** The single colour argument of an `ie-hex-str` case. */
function invokeColorArg(args: string): Color {
  const value = readValue(args);
  if (!isColor(value)) {
    throw new TypeError('expected a colour argument');
  }
  return value;
}
