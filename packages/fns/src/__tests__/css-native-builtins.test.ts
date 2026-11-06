import { readFileSync } from 'node:fs';
import type { Fn } from '@jesscss/core';
import { describe, expect, it } from 'vitest';
import { lessFns } from '../less/registry.js';
import { sassFns } from '../sass/registry.js';
import * as sassColor from '../sass/color/index.js';
import * as sassMath from '../sass/math/index.js';

/*
 * The CSS-native inventory (docs/design/CSS-NATIVE-BUILTINS.md §1) accounts for
 * every registered function exactly once: a row, an `aliasOf` row, or
 * `outOfScope`. A module member that is the same `Fn` as a global is that
 * global's row. The browser-runtime work reads the inventory, so a new built-in
 * cannot land unclassified.
 */

interface Row {
  readonly dialect: 'less' | 'scss';
  readonly name: string;
  readonly class?: string;
  readonly aliasOf?: string;
}

interface Inventory {
  readonly functions: readonly Row[];
  readonly outOfScope: Readonly<Record<Row['dialect'], readonly string[]>>;
}

const inventory: Inventory = JSON.parse(readFileSync(new URL('../css-native-builtins.json', import.meta.url), 'utf8'));
const CLASSES = new Set(['exact', 'exact-if', 'approx', 'already-css', 'none']);
const isFn = (value: unknown): value is Fn => typeof value === 'function' && 'params' in value;

/** Every callable name in a dialect, mapped to its `Fn`. */
const registered: Record<Row['dialect'], Map<string, Fn>> = {
  less: new Map(lessFns.map(fn => [fn.name, fn])),
  scss: new Map([
    ...sassFns.map((fn): [string, Fn] => [fn.name, fn]),
    ...Object.values(sassMath).filter(isFn).map((fn): [string, Fn] => [`math.${fn.name}`, fn]),
    ...Object.values(sassColor).filter(isFn).map((fn): [string, Fn] => [`color.${fn.name}`, fn])
  ])
};

describe.each(['less', 'scss'] as const)('CSS-native inventory: %s', (dialect) => {
  const rows = inventory.functions.filter(row => row.dialect === dialect);
  const names = new Map(rows.map(row => [row.name, row]));
  const outOfScope = new Set(inventory.outOfScope[dialect]);
  const fns = registered[dialect];
  const rowedFns = new Set(rows.map(row => fns.get(row.name)));

  it('has one row per name, each a registered function, none also out of scope', () => {
    expect(rows.length).toBe(names.size);
    expect(rows.filter(row => !fns.has(row.name) || outOfScope.has(row.name)).map(row => row.name)).toEqual([]);
    expect([...outOfScope].filter(name => !fns.has(name))).toEqual([]);
  });

  it('classifies every row, or names the row it aliases', () => {
    expect(rows.filter(row => row.aliasOf === undefined ? !CLASSES.has(row.class ?? '') : row.class !== undefined || names.get(row.aliasOf)?.class === undefined)).toEqual([]);
  });

  it('accounts for every registered function', () => {
    expect([...fns].filter(([name, fn]) => !names.has(name) && !outOfScope.has(name) && !rowedFns.has(fn)).map(([name]) => name)).toEqual([]);
  });
});
