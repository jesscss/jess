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

function createLessTokenMap(): TokenMap {
  return createLexerDefinition(lessFragments(), lessTokens()).T;
}

function isRuleMetadata(value: unknown): value is RuleMetadata {
  return !!value && (typeof value === 'object' || typeof value === 'function');
}

class DebugLessRecursiveParser extends LessRecursiveParser {
  readonly recordedRuleNames: string[] = [];

  override topLevelRuleRecord(name: string, def: GrammarAction) {
    this.recordedRuleNames.push(name);
    return super.topLevelRuleRecord(name, def);
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
      expect(typeof (parser as unknown as Record<string, unknown>)[name], `${name} parser rule type`).toBe('function');
    }

    for (const name of parser.definedRulesNames) {
      const rule = (parser as unknown as Record<string, unknown>)[name];
      expect(isRuleMetadata(rule), `${name} rule metadata`).toBe(true);
      expect(isRuleMetadata(rule) ? typeof rule.originalGrammarAction : undefined, `${name} originalGrammarAction type`).toBe('function');
    }
  });

  it('traces performSelfAnalysis progress', () => {
    const T = createLessTokenMap();
    const parser = new DebugLessRecursiveParser(T, {});
    const originalTraceInit = parser.TRACE_INIT.bind(parser);
    const phases: string[] = [];
    parser.TRACE_INIT = (phase: string, action: () => unknown) => {
      phases.push(phase);
      return originalTraceInit(phase, action);
    };
    parser.performSelfAnalysis();

    expect(parser.recordedRuleNames).toEqual(parser.definedRulesNames);
    expect(phases).toContain('performSelfAnalysis');
    expect(phases).toContain('Grammar Recording');
    expect(phases).toContain('Grammar Validations');
  });
});
