import { describe, expect, it } from 'vitest';
import { createLexerDefinition } from '@jesscss/css-parser';

import { lessFragments, lessTokens } from '../src/lessTokens.js';
import { LessRecursiveParser, type TokenMap } from '../src/lessRecursiveParser.js';
import * as productions from '../src/productions/index.js';

type RuleFactory = (this: LessRecursiveParser, T: TokenMap) => unknown;
type GrammarAction = () => unknown;
type RuleMetadata = {
  originalGrammarAction?: unknown;
};

// chevrotain exposes these grammar-recording internals at runtime, but the
// public parser typings don't declare them. Describe the surface the debug
// harness drives here.
interface ParserInternals {
  topLevelRuleRecord(name: string, def: GrammarAction): unknown;
  definedRulesNames: string[];
  TRACE_INIT: (phase: string, action: () => unknown) => unknown;
  performSelfAnalysis(): void;
}

function internals(parser: LessRecursiveParser): ParserInternals {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return parser as unknown as ParserInternals;
}

function createLessTokenMap(): TokenMap {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return createLexerDefinition(lessFragments(), lessTokens()).T as unknown as TokenMap;
}

function isRuleMetadata(value: unknown): value is RuleMetadata {
  return !!value && (typeof value === 'object' || typeof value === 'function');
}

class DebugLessRecursiveParser extends LessRecursiveParser {
  readonly recordedRuleNames: string[] = [];

  topLevelRuleRecord(name: string, def: GrammarAction) {
    this.recordedRuleNames.push(name);
    // Reach the base (chevrotain) implementation directly; the public typings
    // don't declare topLevelRuleRecord, so super.* isn't visible here.
    const base: unknown = Object.getPrototypeOf(LessRecursiveParser.prototype);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return (base as ParserInternals).topLevelRuleRecord.call(this, name, def);
  }
}

describe('debug self analysis', () => {
  it('verifies registered rule metadata', () => {
    const T = createLessTokenMap();
    const parser = new DebugLessRecursiveParser(T, {});

    for (const [name, factory] of Object.entries(productions)) {
      if (typeof factory !== 'function') {
        continue;
      }
      const produced = (factory as RuleFactory).call(parser, T);
      expect(typeof produced, `${name} factory return type`).toBe('function');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect(typeof (parser as unknown as Record<string, unknown>)[name], `${name} parser rule type`).toBe('function');
    }

    for (const name of internals(parser).definedRulesNames) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const rule = (parser as unknown as Record<string, unknown>)[name];
      expect(isRuleMetadata(rule), `${name} rule metadata`).toBe(true);
      expect(isRuleMetadata(rule) ? typeof rule.originalGrammarAction : undefined, `${name} originalGrammarAction type`).toBe('function');
    }
  });

  it('traces performSelfAnalysis progress', () => {
    const T = createLessTokenMap();
    const parser = new DebugLessRecursiveParser(T, {});
    const parserInternals = internals(parser);
    const originalTraceInit = parserInternals.TRACE_INIT.bind(parser);
    const phases: string[] = [];
    parserInternals.TRACE_INIT = (phase: string, action: () => unknown) => {
      phases.push(phase);
      return originalTraceInit(phase, action);
    };
    parserInternals.performSelfAnalysis();

    expect(parser.recordedRuleNames).toEqual(parserInternals.definedRulesNames);
    expect(phases).toContain('performSelfAnalysis');
    expect(phases).toContain('Grammar Recording');
    expect(phases).toContain('Grammar Validations');
  });
});
