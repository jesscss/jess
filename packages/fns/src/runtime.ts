import { isThenable } from '@jesscss/awaitable-pipe';
import { exposedVars, writeVars, type ExportValues, type ExposedSpec, type Hold, type StyleTarget } from '@jesscss/patch-css';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import type { Value } from '@jesscss/core/value';
import { DEFAULT_MODES, emitValue, isValueGroupArray, makeList, spelledColor } from '@jesscss/core/value';

/** The two literal readers a generated module picks from: with the colour-name table, or without it. */
export { sniffLiteral, sniffUnnamed } from '@jesscss/core/value';

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
 * export, an argument's compile-time CSS, or a function and its arguments.
 */
export type RuntimeRecipe = { readonly export: string } | string | readonly [Fn, readonly RuntimeRecipe[]];

/**
 * A colour name a recipe's own argument writes for a colour parameter, read at
 * compile time: the colour the compile's binder makes of that name
 * ({@link spelledColor}), as a call of no arguments, so a page that writes none
 * bundles nothing for it.
 */
export function color(src: string, rgb: readonly [number, number, number], alpha: number): Fn {
  const value = spelledColor(src, rgb, alpha);
  return Object.assign(() => value, { params: [] });
}

/** What a compiled stylesheet's module hands {@link createRuntime}. */
export interface RuntimeSpec extends ExposedSpec {
  /** The compile-time CSS of each export a derived value reads. */
  readonly defaults: Readonly<Record<string, string>>;

  /** Each generated custom property, by name, with how it is computed. */
  readonly derived: Readonly<Record<string, RuntimeRecipe>>;

  /** The check a given export's value takes: `checkUnit` when a CSS form reads an export, `holdRatio` for a `%` export, none otherwise, so a page bundles only what its exports need. */
  readonly hold?: Hold<ExposedSpec>;

  /** By export, the key of each one a computed value reads as a colour, when the page takes no colour names for them (R8 spec, colour names). */
  readonly hex?: Readonly<Record<string, string>>;

  /**
   * How a word of a value is read: `sniffLiteral` when the page takes colour
   * names, `sniffUnnamed` otherwise, so the name table ships only when names
   * can arrive (R8 spec, colour names).
   */
  readonly literal: (word: string) => Value;
}

export type { ExportValues, StyleTarget };

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

const CTX = { modes: DEFAULT_MODES, stringify: (value: ValueGroup): string => !isValueGroupArray(value) && value.type === 'Quoted' ? value.value : emitValue(value) };

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
        const key = spec.hex?.[name];

        /* Each word the reader reads, so a name anywhere in a list is refused; a function word fails in the reader first. */
        const literal = key === undefined || given === undefined
          ? spec.literal
          : (word: string): Value => {
              if (/^[a-z]/i.test(word)) {
                throw new TypeError(`\`${key}\` received \`${given.trim()}\`, which is not a hex colour; set \`colorNames: true\` in the Jess plugin options to accept colour names.`);
              }
              return spec.literal(word);
            };
        value = parseValue(given ?? spec.defaults[name] ?? '', literal);
        parsed.set(name, value);
      }
      return value;
    };
    for (const property of Object.keys(spec.derived)) {
      const recipe = spec.derived[property]!;
      if (reads(recipe, values)) {
        out[property] = emitValue(run(recipe, read, spec.literal));
      }
    }
    return out;
  };
}

export function createRuntime(spec: RuntimeSpec): Runtime {
  const vars = createVars(spec);
  return { vars, set: (values, target) => writeVars(vars(values), target) };
}

function reads(recipe: RuntimeRecipe, values: ExportValues): boolean {
  return typeof recipe === 'string'
    ? false
    : isCall(recipe)
      ? recipe[1].some(arg => reads(arg, values))
      : Object.hasOwn(values, recipe.export);
}

function isCall(recipe: Exclude<RuntimeRecipe, string>): recipe is readonly [Fn, readonly RuntimeRecipe[]] {
  return Array.isArray(recipe);
}

/** `read` is an export's value, given or compile-time, parsed once per {@link Runtime.vars}; `literal` reads a recipe's own argument. */
function run(recipe: RuntimeRecipe, read: (name: string) => ValueGroup, literal: RuntimeSpec['literal']): ValueGroup {
  if (typeof recipe === 'string') {
    return parseValue(recipe, literal);
  }
  if (!isCall(recipe)) {
    return read(recipe.export);
  }
  const [fn, args] = recipe;
  const result = fn(args.map(arg => run(arg, read, literal)), CTX);
  if (isThenable(result)) {
    throw new TypeError(`${fn.name}() computes asynchronously, which the runtime cannot do.`);
  }
  return result;
}

/**
 * A value as the runtime is given it: a comma list of space lists of
 * literals. ponytail: no function syntax (`rgb(…)`, `calc(…)`) — `<input
 * type="color">` gives hex; parse with the dialect's colour functions if
 * authors need more.
 */
function parseValue(text: string, literal: RuntimeSpec['literal']): ValueGroup {
  const items = split(text, ',').map((item) => {
    const words = split(item, ' ').map(word => readWord(word, literal));
    return words.length === 1 ? words[0]! : words;
  });
  return items.length === 1 ? items[0]! : makeList(items, ',');
}

function readWord(word: string, literal: RuntimeSpec['literal']): ValueGroup {
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
