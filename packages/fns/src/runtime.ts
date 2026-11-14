import { isThenable } from '@jesscss/awaitable-pipe';
import { exposedVars, writeVars, type ExportValues, type ExposedSpec, type Hold, type StyleTarget } from '@jesscss/patch-css';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import type { Value } from '@jesscss/core/value';
import { DEFAULT_MODES, emitValue, isValueGroupArray, makeList, parseHex, sniffLiteral, sniffUnnamed, spelledColor } from '@jesscss/core/value';

/**
 * The browser runtime for a stylesheet's exported variables (ledger A4,
 * docs/architecture/core/spec/R8-browser-runtime.md, slice 3). The compiled
 * CSS reads each export as `var(--name, …)` and each value derived from one as
 * a generated custom property; setting an export sets its property and
 * recomputes every derived value that reads it, with the same functions the
 * compile ran. Nothing here serializes CSS.
 */

/**
 * How a derived value is computed, as the generated module writes it: an
 * export, an argument's compile-time CSS, or a computation and its arguments.
 */
export type RuntimeRecipe = { readonly export: string } | string | Call<ValueGroup>;

/** A computation and the recipes of its arguments. */
type Call<T> = readonly [(args: ValueGroup[]) => T, readonly RuntimeRecipe[]];

/**
 * A derived property's recipe: a {@link RuntimeRecipe}, or the call of a body
 * whose declared result is one node that is not `Any`, written as its text
 * (`(a) => body(...a).bytes`), so the page needs no value writer for it.
 */
export type Derived = RuntimeRecipe | Call<string>;

/** What a recipe calls with its computed arguments: a built-in's body, {@link call} over a defined function, or {@link color}. */
export type Compute = (args: ValueGroup[]) => ValueGroup;

/**
 * A colour name a recipe's own argument writes for a colour parameter, read at
 * compile time: the colour the compile's binder makes of that name
 * ({@link spelledColor}), as a call of no arguments, so a page that writes none
 * bundles nothing for it.
 */
export function color(src: string, rgb: readonly [number, number, number], alpha: number): Compute {
  const value = spelledColor(src, rgb, alpha);
  return () => value;
}

const CTX = { modes: DEFAULT_MODES, stringify: (value: ValueGroup): string => !isValueGroupArray(value) && value.type === 'Quoted' ? value.value : emitValue(value) };

/** A defined function as a recipe calls it, with the runtime's context, so a page whose recipes all call bodies bundles neither the context nor the async refusal. */
export function call(fn: Fn): Compute {
  return (args) => {
    const result = fn(args, CTX);
    if (isThenable(result)) {
      throw new TypeError(`${fn.name}() computes asynchronously, which the runtime cannot do.`);
    }
    return result;
  };
}

/** What a compiled stylesheet's module hands {@link createRuntime}. */
export interface RuntimeSpec extends ExposedSpec {
  /** The compile-time CSS of each export a derived value reads. */
  readonly defaults: Readonly<Record<string, string>>;

  /** Each generated custom property, by name, with how it is computed. */
  readonly derived: Readonly<Record<string, Derived>>;

  /** Writes a derived value that is not already text: `emitValue`, which the generated module passes only when a recipe's result needs it. */
  readonly emit?: (value: ValueGroup) => string;

  /** The check a given export's value takes: `checkUnit` when a CSS form reads an export, `holdRatio` for a `%` export, none otherwise, so a page bundles only what its exports need. */
  readonly hold?: Hold<ExposedSpec>;

  /** By export, the key of each one a computed value reads as a colour, when the page takes no colour names for them (R8 spec, colour names). */
  readonly hex?: Readonly<Record<string, string>>;

  /**
   * How a value's text is read, the generated module's pick: {@link readHex}
   * when every export a recipe reads is a hex colour and no recipe holds text,
   * {@link readNamed} when the page takes colour names, {@link readUnnamed}
   * otherwise. So a page bundles only the reader it needs, and the name table
   * only when names can arrive (R8 spec, colour names).
   */
  readonly read: Reader;
}

/** A reader of a value's text; `hexKey`, the export's key, when the value is given for an export that takes the hex check. */
export type Reader = (text: string, hexKey?: string) => ValueGroup;

export type { ExportValues, StyleTarget };

/** The value writer, for a generated module whose recipes' results need it ({@link RuntimeSpec.emit}). */
export { emitValue } from '@jesscss/core/value';

export interface Runtime {
  /**
   * The custom properties `values` set: each export given, and each derived
   * value that reads one, computed from `values` and the compile-time value of
   * every export not given. Pure; usable as a React or Vue `style` object.
   */
  vars(values: ExportValues): Record<string, string>;

  /** Write {@link Runtime.vars} on `target`'s inline style, the document root by default. */
  set(values: ExportValues, target?: StyleTarget): void;
}

/** {@link Runtime.vars} alone, so a page that never calls `set` bundles no writer. */
export function createVars(spec: RuntimeSpec): Runtime['vars'] {
  return (given: ExportValues): Record<string, string> => {
    const values: Record<string, string> = {};
    const out = exposedVars(spec, given, spec.hold, values);
    const parsed = new Map<string, ValueGroup>();
    const read = (name: string): ValueGroup => {
      let value = parsed.get(name);
      if (value === undefined) {
        const given = values[name];
        value = given === undefined ? spec.read(spec.defaults[name] ?? '') : spec.read(given, spec.hex?.[name]);
        parsed.set(name, value);
      }
      return value;
    };
    for (const property of Object.keys(spec.derived)) {
      const recipe = spec.derived[property]!;
      if (reads(recipe, values)) {
        const value = isCall(recipe) ? apply<ValueGroup | string>(recipe, read, spec.read) : run(recipe, read, spec.read);
        out[property] = typeof value === 'string' ? value : spec.emit!(value);
      }
    }
    return out;
  };
}

export function createRuntime(spec: RuntimeSpec): Runtime {
  const vars = createVars(spec);
  return { vars, set: (values, target) => writeVars(vars(values), target) };
}

function reads(recipe: Derived, values: ExportValues): boolean {
  return typeof recipe === 'string'
    ? false
    : isCall(recipe)
      ? recipe[1].some(arg => reads(arg, values))
      : Object.hasOwn(values, recipe.export);
}

function isCall<R extends Derived>(recipe: R): recipe is Extract<R, readonly unknown[]> {
  return Array.isArray(recipe);
}

/** `read` is an export's value, given or compile-time, parsed once per {@link Runtime.vars}; `text` reads a recipe's own argument. */
function run(recipe: RuntimeRecipe, read: (name: string) => ValueGroup, text: Reader): ValueGroup {
  if (typeof recipe === 'string') {
    return text(recipe);
  }
  return isCall(recipe) ? apply(recipe, read, text) : read(recipe.export);
}

function apply<T>([compute, args]: Call<T>, read: (name: string) => ValueGroup, text: Reader): T {
  return compute(args.map(arg => run(arg, read, text)));
}

/** The hex check's error; `named` when what was given reads as a colour name, so the option that takes names would help. */
const notHex = (key: string, given: string, named: boolean): TypeError =>
  new TypeError(`\`${key}\` received \`${given.trim()}\`, which is not a hex colour${named ? '; set `colorNames: true` in the Jess plugin options to accept colour names' : ''}.`);

/** A hex colour, `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, and nothing else: the reader of a page whose recipes read only colour exports. */
export function readHex(text: string, hexKey?: string): ValueGroup {
  const src = text.trim();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(src)) {
    const { rgb, alpha } = parseHex(src);
    return spelledColor(src, rgb, alpha);
  }
  throw notHex(hexKey ?? 'a colour export', text, /^\s*[a-z]+(?:[\s,]|$)/i.test(text));
}

/** A value with colour names read as colours. */
export const readNamed: Reader = (text, hexKey) => parseValue(text, gated(sniffLiteral, text, hexKey));

/** A value with a colour name read as the keyword it spells. */
export const readUnnamed: Reader = (text, hexKey) => parseValue(text, gated(sniffUnnamed, text, hexKey));

/** `literal`, refusing each word a colour name could be for an export that takes the hex check: a name anywhere in a list is refused, and a function word fails in the reader first. */
const gated = (literal: (word: string) => Value, given: string, hexKey: string | undefined) => hexKey === undefined
  ? literal
  : (word: string): Value => {
      if (/^[a-z]/i.test(word)) {
        throw notHex(hexKey, given, true);
      }
      return literal(word);
    };

/**
 * A value as the runtime is given it: a comma list of space lists of
 * literals. ponytail: no function syntax (`rgb(…)`, `calc(…)`) — `<input
 * type="color">` gives hex; parse with the dialect's colour functions if
 * authors need more.
 */
function parseValue(text: string, literal: (word: string) => Value): ValueGroup {
  const items = split(text, ',').map((item) => {
    const words = split(item, ' ').map(word => readWord(word, literal));
    return words.length === 1 ? words[0]! : words;
  });
  return items.length === 1 ? items[0]! : makeList(items, ',');
}

function readWord(word: string, literal: (word: string) => Value): ValueGroup {
  if (word.includes('(') && word[0] !== '"' && word[0] !== '\'') {
    throw new TypeError(`The runtime computes from CSS literals (#c00, 8px, red); "${word}" is a function.`);
  }
  return literal(word);
}

/** `text` split at each `separator` outside parentheses and quotes; `' '` splits at any whitespace run. */
function split(text: string, separator: ',' | ' '): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== '') {
      quote = c === quote && text[i - 1] !== '\\' ? '' : quote;
    } else if (c === '"' || c === '\'') {
      quote = c;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    } else if (depth === 0 && (separator === ',' ? c === ',' : /\s/.test(c))) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim()).filter(part => part !== '');
}
