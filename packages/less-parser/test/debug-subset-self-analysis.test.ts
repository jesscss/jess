/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Chevrotain parser self-analysis harness: token-map / rule-factory casts are inherent framework integration. */
import { describe, expect, it } from 'vitest';
import {
  CssRecursiveParser,
  productions as cssProductions,
  createLexerDefinition
} from '@jesscss/css-parser';

import { lessFragments, lessTokens } from '../src/lessTokens.js';
import type { TokenMap as LessTokenMap } from '../src/lessRecursiveParser.js';
import * as lessProductions from '../src/productions/index.js';

type LessFactory = (this: CssRecursiveParser, T: LessTokenMap) => (...args: unknown[]) => unknown;

const overrideNames = Object.keys(lessProductions).filter(name => name in cssProductions);
const additionNames = Object.keys(lessProductions).filter(name => !(name in cssProductions));

class SubsetLessParser extends CssRecursiveParser {
  declare T: LessTokenMap;
  looseMode = true;
  leakyRules = true;
  warnings: Array<{ message: string }> = [];
  mathMode = 'parens-division' as const;
  wrapOuterExpressions = true;

  constructor(T: LessTokenMap, enabledOverrides: ReadonlySet<string>) {
    super(T as never, { legacyMode: true });
    this.T = T;

    for (const [name, factory] of Object.entries(lessProductions)) {
      if (typeof factory !== 'function') {
        continue;
      }

      const rule = (factory as LessFactory).call(this, T);
      if (name in cssProductions) {
        if (enabledOverrides.has(name)) {
          this.OVERRIDE_RULE(name, rule);
        }
      } else {
        this.RULE(name, rule);
      }
    }
  }

  warnDeprecation(message: string) {
    this.warnings.push({ message });
  }
}

function createParser(enabledOverrides: readonly string[]) {
  const { T } = createLexerDefinition(
    lessFragments() as unknown as ReadonlyArray<Readonly<[string, string]>>,
    lessTokens()
  );
  return new SubsetLessParser(T as LessTokenMap, new Set(enabledOverrides));
}

// performSelfAnalysis is a protected chevrotain method; expose it for the
// debug harness without widening the parser class itself.
function runSelfAnalysis(parser: SubsetLessParser): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  (parser as unknown as { performSelfAnalysis(): void }).performSelfAnalysis();
}

describe('debug override subset self-analysis', () => {
  it('documents the override/addition split', () => {
    expect(overrideNames.length).toBeGreaterThan(0);
    expect(additionNames.length).toBeGreaterThan(0);
  });

  it('supports enabling no Less overrides', () => {
    const parser = createParser([]);
    expect(() => runSelfAnalysis(parser)).not.toThrow();
  });

  it('supports an override subset from SUBSET env', () => {
    const subset = (process.env.SUBSET ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

    const parser = createParser(subset);
    runSelfAnalysis(parser);
    expect(true).toBe(true);
  });
});
