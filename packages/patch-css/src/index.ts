/**
 * Sets a stylesheet's exposed variables on the page (ledger A4,
 * docs/architecture/core/spec/R8-browser-runtime.md). The compiled CSS reads
 * each export as `var(--name, …)`; this maps a JavaScript key to its `--name`,
 * checks a value a CSS form reads is in the unit the form takes, and writes the
 * values that changed. `@jesscss/fns/runtime` adds what is computed from them.
 */

/** What a compiled stylesheet's module hands {@link exposeVars}. */
export interface ExposedSpec {
  /** Each exposed variable's name by its JavaScript key: `brandColor` is `brand-color`. */
  readonly keys: Readonly<Record<string, string>>;

  /**
   * The unit of each export a CSS form reads, `''` for a number: the only one it
   * takes, since CSS would convert another unit where Less does not
   * (`unit(7em, px)` is 7px in Less, 112px over `var(--a) / 1px * 1px`). A `%`
   * export read at all is `%`, and is held as its ratio, `50%` as `--a: 0.5`, which
   * every read multiplies back.
   */
  readonly units: Readonly<Record<string, string>>;
}

/** Values by JavaScript key: the variable's name with dash-case turned to camelCase (`brandColor` for `@brand-color`), as CSS. */
export type ExportValues = Readonly<Record<string, string>>;

/** An element whose inline style takes custom properties. */
export interface StyleTarget {
  readonly style: { setProperty(name: string, value: string): void };
}

/** The page's document, in a browser; read only when no target is given. */
declare const document: { readonly documentElement: StyleTarget };

const NUMBER = /^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?/i;

/** The value an export's `--name` holds: `value`, or for a `%` one its ratio. Throws when a CSS form reads it in another unit. */
function held(spec: ExposedSpec, key: string, name: string, value: string): string {
  const unit = Object.hasOwn(spec.units, name) ? spec.units[name] : undefined;
  if (unit === undefined) {
    return value;
  }
  const text = value.trim();
  const number = NUMBER.exec(text)?.[0];
  if (number === undefined || text.slice(number.length).toLowerCase() !== unit.toLowerCase()) {
    throw new TypeError(`${key} is read by a CSS form in ${unit === '' ? 'a number' : unit}, as its compile-time value is; ${value} would mean something else there.`);
  }
  return unit === '%' ? String(Number((Number(number) / 100).toPrecision(15))) : value;
}

/**
 * The custom property of each export `given`, by `--name`, and each export's
 * name to the value given. Throws for a key the stylesheet does not expose.
 */
export function exposedVars(spec: ExposedSpec, given: ExportValues, names?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(given)) {
    const name = Object.hasOwn(spec.keys, key) ? spec.keys[key] : undefined;
    if (name === undefined) {
      throw new TypeError(`The stylesheet exposes no variable with the key ${key}.`);
    }
    const value = given[key]!;
    out[`--${name}`] = held(spec, key, name, value);
    if (names !== undefined) {
      names[name] = value;
    }
  }
  return out;
}

/** What each target was last given, so a value already set is not set again. */
const written = new WeakMap<StyleTarget, Map<string, string>>();

/**
 * Write `vars` on `target`'s inline style, the document root by default: one
 * declaration per `--name`, and only the values that changed. The browser
 * recomputes style once for the whole call (docs/perf/BENCHMARKS.md,
 * "patch-css write strategy").
 */
export function writeVars(vars: Readonly<Record<string, string>>, target: StyleTarget = document.documentElement): void {
  let last = written.get(target);
  if (last === undefined) {
    last = new Map();
    written.set(target, last);
  }
  for (const property of Object.keys(vars)) {
    const value = vars[property]!;
    if (last.get(property) !== value) {
      last.set(property, value);
      target.style.setProperty(property, value);
    }
  }
}

export interface ExposedRuntime {
  /** The custom properties `values` set. Pure; usable as a React or Vue `style` object. */
  vars(values: ExportValues): Record<string, string>;

  /** Write {@link ExposedRuntime.vars} on `target`'s inline style, the document root by default. */
  set(values: ExportValues, target?: StyleTarget): void;
}

/** The runtime of a stylesheet that computes nothing from its exports. */
export function exposeVars(spec: ExposedSpec): ExposedRuntime {
  return {
    vars: values => exposedVars(spec, values),
    set: (values, target) => writeVars(exposedVars(spec, values), target)
  };
}
