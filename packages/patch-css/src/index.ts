/**
 * Sets a stylesheet's exposed variables on the page (ledger A4,
 * docs/architecture/core/spec/R8-browser-runtime.md). The compiled CSS reads
 * each export as `var(--name, …)`; this maps a JavaScript key to its `--name`,
 * checks a value a CSS form reads is in the unit the form takes, and writes the
 * values that changed. `@jesscss/fns/runtime` adds what is computed from them.
 */

import { formatNumber } from './format-number.js';

export { formatNumber, TOLERANCE, trimNumber } from './format-number.js';

/** What a compiled stylesheet's module hands {@link exposedVars}. */
export interface ExposedSpec {
  /** Each exposed variable's name by its JavaScript key: `brandColor` is `brand-color`. */
  readonly keys: Readonly<Record<string, string>>;

  /**
   * The unit of each export a CSS form reads, `''` for a number: the only one it
   * takes, since CSS would convert another unit where Less does not
   * (`unit(7em, px)` is 7px in Less, 112px over `var(--a) / 1px * 1px`). A `%`
   * export is `%`.
   */
  readonly units: Readonly<Record<string, string>>;

  /** Each `%` export, held as its ratio, `50%` as `--a: 0.5`, which every read multiplies back. */
  readonly ratios: readonly string[];
}

/** Values by JavaScript key: the variable's name with dash-case turned to camelCase (`brandColor` for `@brand-color`), as CSS. */
export type ExportValues = Readonly<Record<string, string>>;

/** An element whose inline style takes custom properties. */
export interface StyleTarget {
  readonly style: { getPropertyValue(name: string): string; setProperty(name: string, value: string): void };
}

/** The page's document, in a browser; read only when no target is given. */
declare const document: { readonly documentElement: StyleTarget };

const NUMBER = /^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?/i;

/**
 * `n / by` to fifteen significant digits, so `0.1 / 1` is not
 * `0.1000000000000000055`: an exposed percentage's ratio, which the compile and
 * this runtime both compute with it and spell with {@link formatNumber}
 * (`@jesscss/core` re-exports both).
 */
export const ratioOf = (n: number, by: number): number => Number((n / by).toPrecision(15));

/** What `--name` holds for a value given for `key`: the value, checked, or what it stands for. */
export type Hold<S> = (spec: S, key: string, name: string, value: string) => string;

/** `value`, after checking it is in the unit a CSS form reads it in. Throws when it is not. */
export function checkUnit(spec: Pick<ExposedSpec, 'units'>, key: string, name: string, value: string): string {
  const unit = Object.hasOwn(spec.units, name) ? spec.units[name] : undefined;
  if (unit !== undefined) {
    const text = value.trim();
    const number = NUMBER.exec(text)?.[0];
    if (number === undefined || text.slice(number.length).toLowerCase() !== unit.toLowerCase()) {
      throw new TypeError(`${key} is read by a CSS form in ${unit === '' ? 'a number' : unit}, as its compile-time value is; ${value} would mean something else there.`);
    }
  }
  return value;
}

/** {@link checkUnit}, then a `%` export's ratio: `50%` is `0.5`. Only an export with a unit can be one. */
export function holdRatio(spec: ExposedSpec, key: string, name: string, value: string): string {
  checkUnit(spec, key, name, value);
  return Object.hasOwn(spec.units, name) && spec.ratios.includes(name) ? formatNumber(ratioOf(Number.parseFloat(value), 100)) : value;
}

/**
 * The custom property of each export `given`, by `--name`, holding what `hold`
 * makes of its value; each export's name to the value given, in `names`. Throws
 * for a key the stylesheet does not expose. A stylesheet passes the least
 * `hold` it needs, so a page bundles only that: none when no CSS form reads an
 * export, {@link checkUnit} when one does, {@link holdRatio} for a `%` export.
 */
export function exposedVars<S extends Pick<ExposedSpec, 'keys'>>(spec: S, given: ExportValues, hold?: Hold<S>, names?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(given)) {
    const name = Object.hasOwn(spec.keys, key) ? spec.keys[key] : undefined;
    if (name === undefined) {
      throw new TypeError(`The stylesheet exposes no variable with the key ${key}.`);
    }
    const value = given[key]!;
    out[`--${name}`] = hold === undefined ? value : hold(spec, key, name, value);
    if (names !== undefined) {
      names[name] = value;
    }
  }
  return out;
}

/**
 * Write `vars` on `target`'s inline style, the document root by default: one
 * declaration per `--name`, and only a value the style does not already hold,
 * read from the style itself so a value set elsewhere is never assumed
 * (docs/perf/BENCHMARKS.md §10).
 */
export function writeVars(vars: Readonly<Record<string, string>>, target: StyleTarget = document.documentElement): void {
  const { style } = target;
  for (const property of Object.keys(vars)) {
    const value = vars[property]!;
    if (style.getPropertyValue(property) !== value) {
      style.setProperty(property, value);
    }
  }
}
