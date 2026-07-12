import { describe, expect, it } from 'vitest';
import { createLexerDefinition } from '@jesscss/css-parser';

import { lessFragments, lessTokens } from '../src/lessTokens.js';
import { LessRecursiveParser, type TokenMap } from '../src/lessRecursiveParser.js';
import * as productions from '../src/productions/index.js';

class DebugLessRecursiveParser extends LessRecursiveParser {
  override topLevelRuleRecord(name: string, def: Function) {
    process.stderr.write(`recording ${name}\n`);
    return super.topLevelRuleRecord(name, def);
  }
}

describe('debug self analysis', () => {
  it('verifies registered rule metadata', () => {
    const { T } = createLexerDefinition(
      lessFragments() as unknown as ReadonlyArray<Readonly<[string, string]>>,
      lessTokens()
    );

    const parser = new DebugLessRecursiveParser(T as TokenMap, {});

    for (const [name, factory] of Object.entries(productions)) {
      if (typeof factory !== 'function') {
        continue;
      }
      const produced = (factory as (this: LessRecursiveParser, T: TokenMap) => unknown).call(parser, T as TokenMap);
      expect(typeof produced, `${name} factory return type`).toBe('function');
      expect(typeof (parser as Record<string, unknown>)[name], `${name} parser rule type`).toBe('function');
    }

    for (const name of parser.definedRulesNames) {
      const rule = (parser as Record<string, unknown>)[name] as Record<string, unknown>;
      expect(typeof rule.originalGrammarAction, `${name} originalGrammarAction type`).toBe('function');
    }
  });

  it('traces performSelfAnalysis progress', () => {
    const { T } = createLexerDefinition(
      lessFragments() as unknown as ReadonlyArray<Readonly<[string, string]>>,
      lessTokens()
    );

    const parser = new DebugLessRecursiveParser(T as TokenMap, {});
    const originalTraceInit = parser.TRACE_INIT.bind(parser);
    parser.TRACE_INIT = ((phase: string, action: () => unknown) => {
      process.stderr.write(`trace ${phase}\n`);
      return originalTraceInit(phase, action);
    }) as typeof parser.TRACE_INIT;
    parser.performSelfAnalysis();
  });
});
