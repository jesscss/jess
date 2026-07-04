/**
 * Functional Jess grammar — macro-compiled composition of Less + SCSS + Jess.
 *
 * Inheritance chain via spread (not class extension):
 *   lessGrammarRules → scssGrammarRules → jessGrammarRules
 *
 * This is the path jess-parser will use once macro compilation is the default.
 */
import { rules } from 'parseman' with { type: 'macro' };
import type { Span } from 'parseman';
import type { TriviaMap, JessError, Rules } from '@jesscss/core';
import { runFunctionalParse } from '@jesscss/css-parser';
import { lessGrammarRules } from '@jesscss/less-parser/grammar-rules';
import { scssGrammarRules } from '@jesscss/scss-parser/grammar-rules';
import { jessGrammarRules } from './grammar-rules.js';
import { JessGrammar } from './builders.js';
// Macro resolves nested spreads by name against the consumer's import bindings.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { numericRules, parenRules, queryRules, stringRules } from '@jesscss/css-parser/shared-value-rules';

// ---------------------------------------------------------------------------
// Builder host — reuse JessGrammar's builders (Jess + inherited SCSS/Less/CSS).
// ---------------------------------------------------------------------------

class BuilderHost extends JessGrammar {
  setSource(src: string) {
    this._source = src;
  }

  resetWarnings() {
    this._warnings = [];
    this._errors = [];
  }

  getWarnings() {
    return this._warnings.slice();
  }

  getErrors() {
    return this._errors.slice();
  }

  build(type: string, span: { start: number; end: number }, children: ReadonlyArray<unknown>, rawChildren: ReadonlyArray<unknown>): unknown {
    /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
    return (this as unknown as {
      buildNode(t: string, s: Span, c: ReadonlyArray<unknown>, st: unknown, r: ReadonlyArray<unknown>): unknown;
    }).buildNode(type, span as Span, children, undefined, rawChildren);
    /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
  }
}

const host = new BuilderHost();

export function build(type: string, children: ReadonlyArray<unknown>, rawChildren: ReadonlyArray<unknown>, span: { start: number; end: number }): unknown {
  return host.build(type, { start: span.start, end: span.end }, children, rawChildren);
}

export const jessRules = rules((g: any) => ({
  ...lessGrammarRules(g, { build }),
  ...scssGrammarRules(g, { build }),
  ...jessGrammarRules(g, { build })
}));

const ALIASES: Record<string, string> = {
  stylesheet: 'Stylesheet',
  main: 'Stylesheet',
  declaration: 'anyDeclaration',
  declarationList: 'declarationList',
  selector: 'LessSelectorList',
  value: 'valueList',
  valueList: 'valueList'
};

export type JessFnParseResult = {
  tree: Rules;
  errors: JessError[];
  warnings: Array<{ message: string; deprecation?: string }>;
  trivia: TriviaMap;
};

export function parseJessFn(input: string, rule = 'stylesheet'): JessFnParseResult {
  const ruleName = ALIASES[rule] ?? rule;
  const fn = (jessRules as Record<string, unknown>)[ruleName];
  return runFunctionalParse(input, fn, host, { lineComments: true });
}

/** Functional Jess parser — macro-composed Less + SCSS + Jess fragments. */
export class JessParserParsemanFn {
  parse = (text: string, rule = 'stylesheet'): JessFnParseResult => parseJessFn(text, rule);
}
