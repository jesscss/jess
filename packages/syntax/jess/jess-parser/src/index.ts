export { jessGrammar } from './grammar.js';
export { parseJessCst, parseJessDoc } from './cst.js';
export type {
  JessCstChild, JessCstError, JessCstLeaf, JessCstNode, JessCstParseResult, JessCstType
} from './cst.js';

import { run } from 'parseman';
import {
  createTriviaMapFromParseman,
  withSourceSpan,
  withTriviaMap,
  type Apply,
  type Ruleset,
  type SelectorBranch,
  type SelectorList,
  type SelectorTerm,
  type SimpleSelector,
  type SimpleToken,
  type Statement,
  type Stylesheet
} from '@jesscss/core/ast';
import type { ApplySelectorKind, ExtendSelectorKind } from '@jesscss/core';
import { jessAstGrammar } from './grammar.js';

export interface JessParseOptions {
  readonly allowExtendSelectors?: readonly ExtendSelectorKind[];

  /**
   * Selector kinds accepted by `$apply`. Jess treats `$apply` as a utility-class
   * composition feature by default, so unset means class selectors only.
   */
  readonly allowApplySelectors?: readonly ApplySelectorKind[];
}

/** Structured failure from the public direct Jess parser. */
export class JessParseError extends SyntaxError {
  readonly code = 'parse/syntax-error' as const;
  readonly offset: number;
  readonly expected: readonly string[];

  constructor(offset: number, expected: readonly string[]) {
    const detail = expected.length > 0 ? ` Expected: ${expected.join(', ')}.` : '';
    super(`Jess parser error.${detail}`);
    this.name = 'JessParseError';
    this.offset = offset;
    this.expected = expected;
  }
}

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && 'rules' in value
    && Array.isArray(value.rules);
}

const DEFAULT_APPLY_SELECTOR_KINDS: readonly ApplySelectorKind[] = ['class'];
const DEFAULT_EXTEND_SELECTOR_KINDS: readonly ExtendSelectorKind[] = ['class'];

function selectorPolicyError(message: string): JessParseError {
  return new JessParseError(0, [message]);
}

function isClassSelector(simple: SimpleSelector): boolean {
  return simple.interp === null
    && typeof simple.text === 'string'
    && simple.text.startsWith('.')
    && simple.text.length > 1;
}

function isTermAllowed(term: SelectorTerm, allowed: ReadonlySet<ApplySelectorKind | ExtendSelectorKind>): boolean {
  if (term.type === 'CompoundSelector') {
    return allowed.has('compound')
      || (term.value.length === 1 && isSimpleAllowed(term.value[0]!, allowed));
  }
  return isSimpleAllowed(term, allowed);
}

function isSimpleAllowed(simple: SimpleToken, allowed: ReadonlySet<ApplySelectorKind | ExtendSelectorKind>): boolean {
  if (simple.type === 'PseudoSelector') {
    return allowed.has('simple') || allowed.has('pseudo');
  }
  return (allowed.has('class') && isClassSelector(simple))
    || allowed.has('simple')
    || allowed.has('basic');
}

function isBranchAllowed(branch: SelectorBranch, allowed: ReadonlySet<ApplySelectorKind | ExtendSelectorKind>): boolean {
  return branch.type === 'ComplexSelector' || branch.type === 'RelativeSelector'
    ? allowed.has('complex')
    : isTermAllowed(branch, allowed);
}

function validateSelectorList(label: string, selector: SelectorList, allowedKinds: readonly ExtendSelectorKind[]): void {
  const allowed = new Set(allowedKinds);
  if (!selector.selectors.every(item => isBranchAllowed(item, allowed))) {
    throw selectorPolicyError(`${label} selector is not allowed by allowExtendSelectors.`);
  }
}

function validateApply(node: Apply, allowedKinds: readonly ApplySelectorKind[]): void {
  const allowed = new Set(allowedKinds);
  if (!node.selectors.every(selector => isTermAllowed(selector, allowed))) {
    throw selectorPolicyError('$apply target is not allowed by allowApplySelectors.');
  }
}

function validateRuleset(node: Ruleset, options: Required<Pick<JessParseOptions, 'allowApplySelectors' | 'allowExtendSelectors'>>): void {
  for (const instruction of node.extendInstructions ?? []) {
    validateSelectorList('$extend', instruction.target, options.allowExtendSelectors);
  }
  validateStatements(node.rules, options);
}

function validateStatements(rules: readonly Statement[], options: Required<Pick<JessParseOptions, 'allowApplySelectors' | 'allowExtendSelectors'>>): void {
  for (const node of rules) {
    switch (node.type) {
      case 'Ruleset':
        validateRuleset(node, options);
        break;
      case 'MixinDefinition':
      case 'For':
      case 'AtRuleBlock':
        validateStatements(node.rules, options);
        break;
      case 'If':
        for (const branch of node.branches) {
          validateStatements(branch.rules, options);
        }
        break;
      case 'Apply':
        validateApply(node, options.allowApplySelectors);
        break;
      default:
        break;
    }
  }
}

function validateJessOptions(document: Stylesheet, options: JessParseOptions = {}): void {
  validateStatements(document.rules, {
    allowApplySelectors: options.allowApplySelectors ?? DEFAULT_APPLY_SELECTOR_KINDS,
    allowExtendSelectors: options.allowExtendSelectors ?? DEFAULT_EXTEND_SELECTOR_KINDS
  });
}

/** Parse Jess directly into the canonical AST v2 document. */
export function parse(input: string, options: JessParseOptions = {}): Stylesheet {
  const entry = jessAstGrammar.Stylesheet;
  const trivia = jessAstGrammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError('Jess AST grammar is missing its public document entry.');
  }
  const result = run(
    entry,
    input,
    { trivia }
  );
  if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
    const offset = result.ok
      ? result.unconsumedFrom ?? result.span.end
      : result.span.start;
    const expected = result.expected;
    throw new JessParseError(
      offset,
      expected
    );
  }
  const document = withTriviaMap(
    withSourceSpan(result.value, result.span),
    createTriviaMapFromParseman(input, result.triviaMap)
  );
  validateJessOptions(document, options);
  return document;
}
