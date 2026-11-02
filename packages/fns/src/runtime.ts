import { isThenable } from '@jesscss/awaitable-pipe';
import type { Fn, ValueGroup } from '@jesscss/core';
import { DEFAULT_MODES, emitValue, makeList, sniffLiteral } from '@jesscss/core/value';

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

/** What a compiled stylesheet's module hands {@link createRuntime}. */
export interface RuntimeSpec {
  /** The compile-time CSS of each export a derived value reads. */
  readonly defaults: Readonly<Record<string, string>>;

  /** Each generated custom property, by name, with how it is computed. */
  readonly derived: Readonly<Record<string, RuntimeRecipe>>;
}

/** Export values by name (`brand`, not `--brand`), as CSS. */
export type ExportValues = Readonly<Record<string, string>>;

/** An element whose inline style takes custom properties. */
export interface StyleTarget {
  readonly style: { setProperty(name: string, value: string): void };
}

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

const CTX = { modes: DEFAULT_MODES, stringify: emitValue };

/** The page's document, in a browser; read only when `set` is given no target. */
declare const document: { readonly documentElement: StyleTarget };

export function createRuntime(spec: RuntimeSpec): Runtime {
  const vars = (values: ExportValues): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const name of Object.keys(values)) {
      out[`--${name}`] = values[name]!;
    }
    for (const property of Object.keys(spec.derived)) {
      const recipe = spec.derived[property]!;
      if (reads(recipe, values)) {
        out[property] = emitValue(run(recipe, values, spec.defaults));
      }
    }
    return out;
  };
  return {
    vars,
    set(values, target = document.documentElement) {
      const out = vars(values);
      for (const property of Object.keys(out)) {
        target.style.setProperty(property, out[property]!);
      }
    }
  };
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

function run(recipe: RuntimeRecipe, values: ExportValues, defaults: ExportValues): ValueGroup {
  if (typeof recipe === 'string') {
    return parseValue(recipe);
  }
  if (!isCall(recipe)) {
    return parseValue(values[recipe.export] ?? defaults[recipe.export] ?? '');
  }
  const [fn, args] = recipe;
  const result = fn(makeList(args.map(arg => run(arg, values, defaults)), ','), CTX);
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
function parseValue(text: string): ValueGroup {
  const items = split(text, ',').map((item) => {
    const words = split(item, ' ').map(literal);
    return words.length === 1 ? words[0]! : words;
  });
  return items.length === 1 ? items[0]! : makeList(items, ',');
}

function literal(word: string): ValueGroup {
  if (word.includes('(')) {
    throw new TypeError(`The runtime computes from CSS literals (#c00, 8px, red); "${word}" is a function.`);
  }
  return sniffLiteral(word);
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
