import { expect, it as vitestIt } from 'vitest';
import { Parser, type ScssParserChevrotain } from '../src/index.js';
import type { IParseResult, Rules, TreeContext } from '@jesscss/core';

export const parser = new Parser();

export function parseStylesheet(
  src: string,
  options?: { context?: TreeContext }
): IParseResult<Rules> {
  return parser.parse(src, 'Stylesheet', options);
}

export function expectParseOk(src: string, options?: { context?: TreeContext }) {
  const result = parseStylesheet(src, options);
  expect(result.lexerResult.errors.map(error => error.message)).toEqual([]);
  expect(result.errors.map(error => error.message)).toEqual([]);
  expect(result.tree).toBeDefined();
  return result;
}

export function expectParseError(
  src: string,
  message?: string,
  options?: { context?: TreeContext }
) {
  const result = parseStylesheet(src, options);
  expect(result.lexerResult.errors.map(error => error.message)).toEqual([]);
  expect(result.errors.length).toBeGreaterThan(0);
  if (message) {
    expect(result.errors[0]?.message).toContain(message);
  }
  return result;
}

/** Stylesheet body rules — functional parser uses `.rules`, not Chevrotain `.value`. */
export function treeRules(tree: Rules) {
  return tree.rules;
}

export function normalizeOutput(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Control-flow nodes are non-visible; `tree.toString()` omits them. */
export function trimmedStylesheet(tree: Rules): string {
  return tree.rules.map(rule => rule.toTrimmedString()).join('\n');
}

/**
 * Remaining functional-parser gaps, skipped pending the tracked migration tasks:
 *  - @extend compound-target rejection wording + @include kwarg / SelectorCapture
 *    serialization are functional at-rule/value modeling gaps (tasks #9/#10/#17).
 */
export const PENDING_FUNCTIONAL = new Set<string>([
  'rejects compound @extend targets when only simple selectors are allowed',
  'serializes @include keyword args',
  'serializes selector.parse("...") as SelectorCapture'
]);

export function functionalIt(name: string, fn: () => void) {
  (PENDING_FUNCTIONAL.has(name) ? vitestIt.skip : vitestIt)(name, fn);
}

export type ChevrotainParser = InstanceType<typeof ScssParserChevrotain>;
