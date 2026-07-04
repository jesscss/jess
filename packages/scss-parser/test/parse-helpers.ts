import { expect, it as vitestIt } from 'vitest';
import { Parser, type ScssParserChevrotain } from '../src/index.js';
import type { IParseResult, Rules, TreeContext } from '@jesscss/core';

export const parser = new Parser();

export function parseStylesheet(
  src: string,
  options?: { context?: TreeContext }
): IParseResult<Rules> {
  return parser.parse(src, 'stylesheet', options);
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
 * Cases not yet covered by the functional grammar. Kept skipped in parse-only,
 * baseline, and ast-serialize until ported (tranche 10).
 */
export const PENDING_FUNCTIONAL = new Set([
  // parse-only case names
  'isolated parenthesized slash division',
  'paren list with slash separator remains a list',
  'nested property declarations',
  'nested property declarations with base value',
  'interpolation inside @media prelude',
  'interpolation inside @supports prelude',
  'interpolation inside @container prelude',
  'interpolation inside @scope prelude',
  'interpolation inside @layer names',
  'placeholder ruleset',
  'parses @at-root',
  'parses @at-root selector shorthand',
  '@at-root filter rejection',
  'parses diagnostic at-rules',
  'plain function call',
  'escaped module-qualified mixin-ruleset call',
  // baseline / ast-serialize titles
  'parses nested property declarations as a Collection-valued declaration',
  'parses nested property declarations with a base value as Sequence(..., Collection)',
  'parses plain function calls as Call(Reference(type=function, fallbackValue:true)) without Expression',
  'parses escaped SCSS module-qualified mixin-ruleset calls (ns.\\#foo(...))',
  'parses SCSS interpolation inside @media prelude',
  'parses SCSS interpolation inside @supports prelude',
  'parses SCSS interpolation inside @container prelude',
  'parses SCSS interpolation inside @scope prelude',
  'parses SCSS interpolation inside @layer names',
  'parses @debug, @warn, @error diagnostic at-rules',
  'lowers plain @at-root to a null-parent ampersand selector',
  'parses placeholder rulesets',
  'lowers @at-root selector shorthand to a null-parent ampersand selector',
  'parses @at-root filter forms, reports an explicit unsupported error, and continues',
  'serializes isolated parenthesized slash division as Expression(Operation)',
  'keeps paren list slash forms as grouped values, not arithmetic expressions',
  'serializes nested property declarations as a Collection-valued declaration',
  'serializes nested property declarations with a base value as Sequence(..., Collection)',
  'serializes placeholder rulesets',
  'serializes @at-root selector shorthand as a hoisted ruleset',
  'serializes plain fn($x) as Call(name=Reference(type=function,fallbackValue:true)) (no Expression)',
  'serializes SCSS literal spread args',
  'serializes selector.parse("...") as SelectorCapture',
  'serializes ns.\\#foo($x) as Expression(Call(name=Reference(type=mixin-ruleset)))',
  'serializes @debug, @warn, @error as Log nodes with correct level'
]);

export function functionalIt(name: string, fn: () => void) {
  (PENDING_FUNCTIONAL.has(name) ? vitestIt.skip : vitestIt)(name, fn);
}

export type ChevrotainParser = InstanceType<typeof ScssParserChevrotain>;
