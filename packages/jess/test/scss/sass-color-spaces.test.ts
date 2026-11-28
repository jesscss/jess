import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hslToRgb, namedColor } from '@jesscss/core';
import * as sass from 'sass';
import { Compiler } from '../../src/index.js';

/*
 * The `sass:color` colour-space functions (`space`, `to-space`, `is-legacy`,
 * `is-missing`, `is-powerless`, `is-in-gamut`, `channel`, `same`) through the
 * `.scss` compile path, driven by sass-spec's own cases
 * (`spec/core_functions/color/<function>`, ledger C6: every Sass function
 * behaviour-complete; P51: measured against Dart Sass 1.101.7).
 *
 * The spec's `utils.inspect` mixin is inlined, with the global `type-of` for
 * `meta.type-of` (`sass:meta` has no module in jess yet), and its
 * `-real-channel` helper returns through `if()`: a jess `@function` whose only
 * `@return`s are in an `@if` and its `@else` yields nothing, a gap of its own.
 *
 * The expected result of each case is Dart Sass 1.101.7's on the same
 * stylesheet, run here, not the spec's recorded output: the pinned sass-spec is
 * newer, and where the two differ (rec2020's transfer function, which the spec
 * has as a pure 2.4 gamma) jess matches the Dart Sass it is measured against.
 *
 * Output is compared as the same CSS, not the same bytes: every number within
 * 1e-7 of Dart Sass's, relative to the largest number in the value (jess
 * writes ten significant digits, Dart Sass ten decimals, ledger V5 quantizing at
 * output; a colour far out of gamut keeps only the digits its largest channel
 * leaves), and a legacy colour by its channels,
 * so `#2288dd` is `rgb(34, 136, 221)` (jess and Dart Sass choose different
 * spellings for a legacy colour; neither is this change's). A function's own
 * error is Dart Sass's message word for word; an argument-count error is core's
 * dispatcher's, in its own words, for every built-in.
 */
const FUNCTIONS = ['space', 'to-space', 'is-legacy', 'is-missing', 'is-powerless', 'is-in-gamut', 'channel', 'same'];

const specRoot = ((): string | null => {
  const scssParser = fileURLToPath(new URL('../../../syntax/scss/scss-parser', import.meta.url));
  try {
    const root = join(dirname(createRequire(import.meta.url).resolve('sass-spec/package.json', { paths: [scssParser] })), 'spec', 'core_functions', 'color');
    return existsSync(root) ? root : null;
  } catch {
    return null;
  }
})();

interface Case {
  readonly id: string;
  readonly fn: string;
  readonly input: string;
}

function hrxFiles(path: string): string[] {
  if (!existsSync(path)) {
    const file = `${path}.hrx`;
    return existsSync(file) ? [file] : [];
  }
  return statSync(path).isDirectory()
    ? readdirSync(path).flatMap(name => hrxFiles(join(path, name))).filter(file => file.endsWith('.hrx'))
    : [path];
}

function cases(root: string, fn: string): Case[] {
  const out: Case[] = [];
  for (const file of hrxFiles(join(root, fn.replaceAll('-', '_')))) {
    const entries = new Map<string, string>();
    let path: string | null = null;
    let lines: string[] = [];
    for (const line of [...readFileSync(file, 'utf8').split(/\r?\n/u), '<===>']) {
      if (line.startsWith('<===>')) {
        if (path !== null) {
          entries.set(path, lines.join('\n'));
        }
        const next = line.slice(5).trim();
        path = next === '' ? null : next;
        lines = [];
      } else if (path !== null) {
        lines.push(line);
      }
    }
    for (const [entry, input] of entries) {
      if (!entry.endsWith('input.scss')) {
        continue;
      }
      const dir = entry.slice(0, -'input.scss'.length);
      out.push({ id: `${relative(root, file)}::${dir}`, fn, input });
    }
  }
  return out;
}

const UTILS = specRoot === null
  ? ''
  : readFileSync(join(specRoot, '_utils.scss'), 'utf8')
      .split('\n')
      .filter(line => !line.startsWith('@use'))
      .join('\n')
      .replaceAll('meta.type-of(', 'type-of(')
      .replace(/@if color\.is-missing\(\$color, \$channel\) \{\s*@return none;\s*\} @else \{\s*@return color\.channel\(\$color, \$channel\);\s*\}/u,
        '@return if(color.is-missing($color, $channel), none, color.channel($color, $channel));');

/** The case's stylesheet, the spec's utils inlined. */
function stylesheet(input: string): string {
  if (!input.includes('core_functions/color/utils')) {
    return input;
  }
  const lines = input.split('\n');
  const uses = lines.filter(line => line.startsWith('@use') && !line.includes('utils'));
  const rest = lines.filter(line => !line.startsWith('@use'));
  return [...uses, ...['"sass:color"', '\'sass:list\''].filter(use => !uses.some(line => line.includes(use.slice(1, -1)))).map(use => `@use ${use};`), UTILS, ...rest]
    .join('\n')
    .replaceAll('utils.inspect(', 'inspect(');
}

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/giu;

/** A legacy colour's channels, or `undefined`. */
function legacyChannels(text: string): number[] | undefined {
  const named = namedColor(text);
  if (named !== undefined) {
    return [...named.rgb, named.alpha];
  }
  const hex = /^#([0-9a-f]{3,8})$/iu.exec(text)?.[1];
  if (hex !== undefined) {
    const digits = hex.length <= 4 ? [...hex].map(d => d + d) : hex.match(/../gu) ?? [];
    const bytes = digits.map(d => parseInt(d, 16));
    return [bytes[0]!, bytes[1]!, bytes[2]!, bytes.length > 3 ? bytes[3]! / 255 : 1];
  }
  const call = /^(rgba?|hsla?)\((.*)\)$/iu.exec(text);
  if (call === null) {
    return undefined;
  }
  const rgb = call[1]!.toLowerCase().startsWith('rgb');
  const numbers = [...call[2]!.matchAll(new RegExp(`(${NUMBER.source})(%?)`, 'giu'))]
    .map((m, i) => (m[2] === '%' && rgb && i < 3 ? Number(m[1]) * 255 / 100 : Number(m[1])));
  if (numbers.length < 3) {
    return undefined;
  }
  const alpha = numbers[3] ?? 1;
  return rgb
    ? [numbers[0]!, numbers[1]!, numbers[2]!, alpha]
    : [...hslToRgb(numbers[0]!, numbers[1]! / 100, numbers[2]! / 100), alpha];
}

/* Within 1e-7 of the largest number in the value: a colour's channels come out of one conversion, so their error scales with the largest. */
const close = (a: number, b: number, scale: number): boolean => Math.abs(a - b) <= 1e-7 * Math.max(1, scale);

const largest = (numbers: readonly number[]): number => Math.max(0, ...numbers.map(Math.abs));

/* An rgb channel as written: a byte, clamped (ledger V5 quantizes at output); either byte for a channel a rounding error from a tie. */
const byte = (n: number): number => Math.min(255, Math.max(0, Math.round(n)));
const sameByte = (actual: number, expected: number): boolean => actual === byte(expected - 1e-6) || actual === byte(expected + 1e-6);

/** Whether two declaration values are the same CSS. */
function sameValue(actual: string, expected: string): boolean {
  const a = legacyChannels(actual);
  const b = legacyChannels(expected);
  if (a !== undefined || b !== undefined) {
    return a !== undefined && b !== undefined && a.every((n, i) => i < 3 ? sameByte(byte(n), b[i]!) : close(n, b[i]!, 1));
  }
  const words = (text: string): string[] => text.split(NUMBER);
  const numbers = (text: string): number[] => (text.match(NUMBER) ?? []).map(Number);
  const [an, bn] = [numbers(actual), numbers(expected)];
  return words(actual).join('#') === words(expected).join('#') && an.length === bn.length && an.every((n, i) => close(n, bn[i]!, largest(bn)));
}

const declarations = (css: string): Array<[string, string]> =>
  [...css.matchAll(/([\w-]+):\s*([^;{}]*);/gu)].map(m => [m[1]!, m[2]!.trim()]);

/** What Dart Sass 1.101.7 writes for the stylesheet, or the message it stops on. */
function dartSass(source: string): { readonly css?: string; readonly error?: string } {
  try {
    return { css: sass.compileString(source, { logger: sass.Logger.silent }).css };
  } catch (error) {
    return { error: error instanceof sass.Exception ? error.sassMessage : String(error) };
  }
}

/** The case's result: `null` when jess writes what Dart Sass writes, else what differs. */
async function run(c: Case): Promise<string | null> {
  const source = stylesheet(c.input);
  const dart = dartSass(source);
  let css: string;
  try {
    css = await new Compiler({ compile: { functionMode: 'error' } }).renderString(source, { extension: '.scss' });
  } catch (error) {
    const reason = /could not be evaluated: (.*)/u.exec(String(error))?.[1] ?? String(error).split('\n')[0]!;
    if (dart.error === undefined) {
      return `ERROR ${reason}`;
    }
    const message = dart.error;
    const missing = /^Missing argument \$(\S+)\.$/u.exec(message);
    const expected = missing !== null
      ? `${c.fn}: missing required argument ${missing[1]}`
      : /^Only \d+ arguments? allowed/u.test(message) ? `${c.fn}: too many arguments` : message;
    return reason === expected ? null : `ERROR ${reason} (Dart Sass: ${message})`;
  }
  if (dart.css === undefined) {
    return `no error, wrote ${css} (Dart Sass: ${dart.error})`;
  }
  const actual = declarations(css);
  const expected = declarations(dart.css);
  if (actual.length !== expected.length) {
    return `wrote ${JSON.stringify(actual)}, Dart Sass ${JSON.stringify(expected)}`;
  }
  const differ = expected.findIndex(([prop, value], i) => actual[i]![0] !== prop || !sameValue(actual[i]![1], value));
  return differ < 0 ? null : `${expected[differ]![0]}: wrote ${actual[differ]![1]}, Dart Sass ${expected[differ]![1]}`;
}

/*
 * The cases jess does not pass, by the gap each is for (`sass-color-spaces.gaps.json`:
 * reason → case ids). Each runs as an expected failure, so a fix shows here.
 */
const listed: unknown = JSON.parse(readFileSync(new URL('./sass-color-spaces.gaps.json', import.meta.url), 'utf8'));
const GAPS = new Map(Object.entries<unknown>(typeof listed === 'object' && listed !== null ? listed : {})
  .flatMap(([reason, ids]) => (Array.isArray(ids) ? ids : []).map(id => [String(id), reason] as const)));

const gapOf = (id: string): string | undefined => GAPS.get(id);

describe.runIf(specRoot !== null)('sass:color colour spaces: sass-spec through .scss', () => {
  const all = FUNCTIONS.flatMap(fn => cases(specRoot!, fn));

  it('has no global spelling: a bare call is the CSS function written', async () => {
    const source = FUNCTIONS.map((fn, i) => `.a${i} {b: ${fn}(red)}`).join('\n');
    const css = await new Compiler().renderString(source, { extension: '.scss' });
    expect(declarations(css).map(([, value]) => value)).toEqual(FUNCTIONS.map(fn => `${fn}(red)`));
  });

  it('finds the corpus, and every listed gap in it', () => {
    expect(all.length).toBeGreaterThan(3000);
    expect([...GAPS.keys()].filter(id => !all.some(c => c.id === id))).toEqual([]);
  });

  it.each(all.filter(c => gapOf(c.id) === undefined).map(c => [c.id, c] as const))('%s', async (_, c) => {
    expect(await run(c)).toBeNull();
  });

  it.fails.each(all.filter(c => gapOf(c.id) !== undefined).map(c => [c.id, c] as const))('%s (gap)', async (_, c) => {
    expect(await run(c)).toBeNull();
  });
});
