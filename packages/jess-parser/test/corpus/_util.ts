/**
 * Shared helpers for the Jess syntax corpus.
 *
 * Each corpus case parses a snippet of `.jess` and asserts the SERIALIZED AST
 * (via core's `serializeTypes`) — the canonical "what does this parse into"
 * oracle the corpus is built around. `toBeString` / `toContainString` (root
 * test/setup.ts) dedent the expected block so cases read cleanly.
 */
import { expect } from 'vitest';
import { serializeTypes, type SerializeTypesOptions } from '@jesscss/core';
import { parseJessFn } from '../../src/functional-parser.js';

export type Parsed = ReturnType<typeof parseJessFn>;

/** Parse and assert no syntax errors; returns the result for further checks. */
export function parse(src: string, rule = 'Stylesheet'): Parsed {
  const result = parseJessFn(src, rule);
  expect(result.errors.map(e => e.message), `unexpected parse errors for ${JSON.stringify(src)}`).toEqual([]);
  return result;
}

/** Assert the full serialized AST of a parsed snippet equals `expected`. */
export function expectAst(src: string, expected: string, opts?: SerializeTypesOptions): void {
  const { tree } = parse(src);
  expect(serializeTypes(tree, opts)).toBeString(expected);
}

/** Assert the serialized AST contains `fragment` (order-preserving substring). */
export function expectAstContains(src: string, fragment: string, opts?: SerializeTypesOptions): void {
  const { tree } = parse(src);
  expect(serializeTypes(tree, opts)).toContainString(fragment);
}

/** Assert the parsed tree round-trips: `tree.toString()` contains `fragment`. */
export function expectRoundTrip(src: string, fragment: string): void {
  const { tree } = parse(src);
  expect(String(tree)).toContain(fragment);
}
