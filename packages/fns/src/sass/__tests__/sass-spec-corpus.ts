/**
 * Test-only harness that drives `sass:color` from the SASS-SPEC CONFORMANCE
 * CORPUS rather than from hand-picked examples.
 *
 * Source: the `sass-spec` package pinned by `packages/scss-parser`
 * (`github:sass/sass-spec@f282e3844`), `spec/core_functions/color/**`. Cases
 * arrive as `.hrx` archives — a flat `<===> path` archive of `input.scss` /
 * `output.css` / `error` triples.
 *
 * Two deliberate design choices:
 *
 * 1. Cases run at the VALUE-DOMAIN level, not through the SCSS pipeline. SCSS
 *    end-to-end eval is still at `EVAL_PASS_FLOOR = 0`, and Sass fn registration
 *    is the integrator's step, so a pipeline runner would measure neither. The
 *    reader below understands the restricted expression grammar these cases
 *    actually use (hex, named colours, dimensions, and the four colour
 *    constructors); anything outside it is RECORDED as unrunnable with a reason,
 *    never silently dropped.
 *
 * 2. Comparison is SEMANTIC (channels + alpha within tolerance), not byte-wise.
 *    dart-sass and jess make different serializer choices for the same colour
 *    (`aqua` vs `rgb(0, 255, 255)`, `#123456` vs `rgb(18, 52, 86)`), and those
 *    are format decisions this port does not own. A channel that differs by more
 *    than tolerance is a real failure; a channel that differs ONLY by 8-bit
 *    rounding is reported separately as a dart-sass legacy-model finding, since
 *    the owner ruling is that channels carry full precision internally.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { colorRawRgb, emitValue, isValueGroupArray, namedColor, sniffLiteral, makeList } from '@jesscss/core/value';
import type { Color, FnCtx, ValueGroup, ValueObj } from '@jesscss/core/value';
import { hsl } from '../color/hsl.js';
import { hsla } from '../color/hsla.js';
import { rgb } from '../color/rgb.js';
import { rgba } from '../color/rgba.js';

const resolver = createRequire(import.meta.url);

/** The `spec/core_functions/color` root, or `null` when sass-spec is not installed. */
export function specRoot(): string | null {
  const scssParser = new URL('../../../../scss-parser', import.meta.url).pathname;
  try {
    const pkg = resolver.resolve('sass-spec/package.json', { paths: [scssParser] });
    const root = join(dirname(pkg), 'spec', 'core_functions', 'color');
    return existsSync(root) ? root : null;
  } catch {
    return null;
  }
}

export interface SpecCase {
  /** `<hrx file>::<case dir>` — unique and greppable back to the corpus. */
  readonly id: string;
  readonly fn: string;
  readonly input: string;
  readonly output?: string;
  readonly error?: string;
}

/** Parse one `.hrx` archive into its `path -> contents` entries. */
function parseHrx(text: string): Map<string, string> {
  const files = new Map<string, string>();
  let path: string | null = null;
  let buf: string[] = [];
  const flush = (): void => {
    if (path !== null) {
      files.set(path, buf.join('\n'));
    }
    path = null;
    buf = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('<===>')) {
      flush();
      const p = line.slice(5).trim();
      if (p) {
        path = p;
      }
      continue;
    }
    if (path !== null && !/^=+$/.test(line)) {
      buf.push(line);
    }
  }
  flush();
  return files;
}

function hrxFilesUnder(root: string): string[] {
  const out: string[] = [];
  const rec = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        rec(full);
      } else if (entry.endsWith('.hrx')) {
        out.push(full);
      }
    }
  };
  if (statSync(root).isDirectory()) {
    rec(root);
  } else {
    out.push(root);
  }
  return out;
}

/** Every case under `spec/core_functions/color/<entry>`, tagged with `fn`. */
export function casesFor(root: string, entry: string, fn: string): SpecCase[] {
  const target = join(root, entry);
  if (!existsSync(target)) {
    return [];
  }
  const cases: SpecCase[] = [];
  for (const file of hrxFilesUnder(target).sort()) {
    const rel = file.slice(root.length + 1);
    const grouped = new Map<string, { input?: string; output?: string; error?: string }>();
    for (const [path, contents] of parseHrx(readFileSync(file, 'utf8'))) {
      const slash = path.lastIndexOf('/');
      const dir = slash === -1 ? '' : path.slice(0, slash);
      const base = slash === -1 ? path : path.slice(slash + 1);
      const bucket = grouped.get(dir) ?? {};
      if (base === 'input.scss') {
        bucket.input = contents;
      } else if (base === 'output.css') {
        bucket.output = contents;
      } else if (base === 'error' || base === 'error-dart-sass') {
        bucket.error = contents;
      }
      grouped.set(dir, bucket);
    }
    for (const [dir, bucket] of grouped) {
      if (bucket.input === undefined) {
        continue;
      }
      cases.push({
        id: `${rel}::${dir || '.'}`,
        fn,
        input: bucket.input,
        ...(bucket.output !== undefined ? { output: bucket.output } : {}),
        ...(bucket.error !== undefined ? { error: bucket.error } : {})
      });
    }
  }
  return cases;
}

/* ------------------------------------------------------- case shape */

/**
 * The single expression a case asserts, or `null` when it is not that shape.
 *
 * Two spellings appear in the corpus and both are accepted: the plain
 * `a {b: <expr>}` declaration, and the `@include utils.inspect(<expr>)` mixin the
 * colour specs use to dump a colour's value, space and channels. Recognizing the
 * mixin form matters — the constructors' bounds cases (`rgb(256 0 0)`,
 * `rgb(-1 0 0)`) are written that way and would otherwise fall out of coverage.
 */
export function soleDeclaration(scss: string): string | null {
  const body = scss
    .split('\n')
    .filter(line => !/^\s*(@use|@forward|\/\/)/.test(line) && line.trim() !== '')
    .join('\n')
    .trim();
  const include = /^@include\s+utils\.inspect\(([\s\S]*)\)\s*;?$/.exec(body);
  if (include) {
    return include[1]!.trim();
  }
  const m = /^[a-z]+\s*\{\s*[a-z-]+\s*:\s*([\s\S]*?)\s*\}$/i.exec(body);
  return m && !m[1]!.includes('{') ? m[1]!.replace(/;$/, '').trim() : null;
}

/**
 * The value an `output.css` case expects: the sole declaration's value, or —
 * for the `utils.inspect` shape — its `value:` line.
 */
export function soleOutputValue(css: string): string | null {
  const value = /^\s*[a-z]+\s*\{\s*value\s*:\s*([^;\n]*);/i.exec(css);
  if (value) {
    return value[1]!.trim();
  }
  const m = /^\s*[a-z]+\s*\{\s*[a-z-]+\s*:\s*([\s\S]*?);?\s*\}\s*$/i.exec(css);
  return m ? m[1]!.trim() : null;
}

/** Why a case cannot run at the value-domain level, or `null` when it can. */
export function unrunnableReason(expr: string): string | null {
  if (/\b(color|oklch|oklab|lab|lch|hwb|xyz|srgb|display-p3|a98-rgb|prophoto-rgb|rec2020)\s*\(/.test(expr)) {
    return 'non-legacy colour space (unimplemented)';
  }
  if (/,\s*(hwb|lab|lch|oklab|oklch|xyz|srgb|display-p3|rec2020)\s*\)/.test(expr)) {
    return 'colour-space argument (unimplemented)';
  }
  if (/\$space\s*:|\$method\s*:/.test(expr)) {
    return 'colour-space argument (unimplemented)';
  }
  if (/\b(var|calc|env|clamp|min|max|attr)\s*\(/.test(expr)) {
    return 'special function passed as a channel (evaluator concern, not a fn body)';
  }
  if (/\bmeta\.|type-of|inspect/.test(expr)) {
    return 'sass:meta (out of scope)';
  }
  if (/\$[a-z][\w-]*/i.test(expr)) {
    return 'named argument (the evaluator route is positional-only)';
  }
  if (/\bnone\b/.test(expr)) {
    return 'missing channel (`none`) — modern colour model, unimplemented';
  }
  if (/\bfrom\b/i.test(expr)) {
    return 'relative colour syntax (`from`) — unimplemented';
  }
  if (/\blist\.slash\s*\(/.test(expr)) {
    return 'sass:list (sibling module, not this port)';
  }
  if (/\b(longer|shorter|increasing|decreasing) hue\b/.test(expr)) {
    return 'hue interpolation method — unimplemented';
  }
  return null;
}

/**
 * A case whose `output.css` echoes its own input expression is a CSS-FILTER (or
 * otherwise unresolvable) passthrough — `saturate(50%)`, `invert(10%)`,
 * `grayscale(1)`. Sass leaves the call verbatim, and jess reaches the same
 * observable result by having the body decline the arguments: under
 * `functionMode: preserve` a throwing built-in re-emits the call as authored.
 */
export function isPassthrough(expr: string, expectedValue: string | null): boolean {
  if (expectedValue === null) {
    return false;
  }
  // ONLY the four functions that have a same-named CSS filter can be echoed
  // back. A constructor never can: `rgb(18, 52, 86)` also renders as
  // `rgb(18, 52, 86)`, and that is a computed value, not a passthrough.
  if (!/^(?:color\.)?(saturate|invert|grayscale|opacity)\s*\(/.test(expr)) {
    return false;
  }
  const norm = (s: string): string => s.replace(/\s+/g, '').replace(/^color\./, '');
  return norm(expectedValue) === norm(expr);
}

/* ------------------------------------------- restricted value reader */

/** Split `text` on top-level `sep`, respecting parentheses. */
function splitTop(text: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (depth === 0 && sep.test(ch)) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map(s => s.trim()).filter(s => s !== '');
}

const CONSTRUCTORS: Record<string, typeof rgb> = { rgb, rgba, hsl, hsla };

const CTX: FnCtx = {
  modes: { unitMode: 'preserve' },
  stringify: (v: ValueGroup): string => emitValue(v)
};

/** Read one restricted SCSS expression into a value-domain group. Throws on anything unsupported. */
export function readValue(expr: string): ValueGroup {
  const text = expr.trim().replace(/;$/, '');
  const commas = splitTop(text, /,/);
  if (commas.length > 1) {
    return makeList(commas.map(readValue), ',');
  }
  const slashes = splitTop(text, /\//);
  if (slashes.length > 1) {
    return makeList(slashes.map(readValue), '/');
  }
  const spaces = splitTop(text, /\s/);
  if (spaces.length > 1) {
    return spaces.map(part => readSingle(part));
  }
  return readSingle(text);
}

function readSingle(text: string): ValueObj {
  const call = /^(?:color\.)?([a-z-]+)\s*\(([\s\S]*)\)$/i.exec(text);
  if (call) {
    const name = call[1]!.toLowerCase();
    const ctor = CONSTRUCTORS[name];
    if (!ctor) {
      throw new Error(`unsupported constructor in fixture: ${name}()`);
    }
    const result = ctor(readValue(call[2]!), CTX);
    if (result instanceof Promise || isValueGroupArray(result)) {
      throw new Error(`constructor did not return a single value: ${text}`);
    }
    return result;
  }
  if (/^-?[\d.]/.test(text) || text.startsWith('#') || namedColor(text.toLowerCase()) !== undefined) {
    const value = sniffLiteral(text);
    if (isValueGroupArray(value)) {
      throw new Error(`literal did not materialize to a single value: ${text}`);
    }
    return value;
  }
  throw new Error(`unsupported literal in fixture: ${text}`);
}

/* ------------------------------------------------------ comparison */

export const isColor = (v: ValueGroup): v is Color =>
  !isValueGroupArray(v) && v.type === 'Color';

/**
 * A colour's comparable channels: its DERIVED raw rgb plus alpha. `colorRawRgb`
 * rather than `c.rgb`, because an hsl-sourced colour carries `rgb: [0, 0, 0]`
 * and computes its channels from the hsl triple on demand.
 */
export function channelsOf(c: Color): [number, number, number, number] {
  const [r, g, b] = colorRawRgb(c);
  return [r, g, b, c.alpha];
}

export const TOLERANCE = 1e-6;

export interface Comparison {
  readonly kind: 'match' | 'rounding-only' | 'mismatch';
  readonly detail?: string;
}

/**
 * Compare an actual colour against a spec-expected one. A difference that
 * disappears once the EXPECTED value is treated as an 8-bit rounding of the
 * actual is classified `rounding-only` — dart-sass's legacy colour model, which
 * the owner ruling explicitly does not adopt.
 */
export function compareColors(actual: Color, expected: Color): Comparison {
  const a = channelsOf(actual);
  const e = channelsOf(expected);
  const close = a.every((v, i) => Math.abs(v - e[i]!) <= TOLERANCE);
  if (close) {
    return { kind: 'match' };
  }
  const rounded = a.every((v, i) => (i === 3 ? Math.abs(v - e[i]!) <= TOLERANCE : Math.round(v) === Math.round(e[i]!)));
  return rounded
    ? { kind: 'rounding-only', detail: `actual ${a.join(',')} vs expected ${e.join(',')}` }
    : { kind: 'mismatch', detail: `actual ${a.join(',')} vs expected ${e.join(',')}` };
}

export { CTX as fnCtx };
