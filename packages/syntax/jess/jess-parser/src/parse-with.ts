/**
 * The `parse()` body and the `$apply`/`$extend` selector policy checks, shared
 * by the two AST entries.
 *
 * The grammar table arrives as an argument rather than being chosen from a
 * boolean inside this module: Node does not tree-shake, so a module that names
 * both compiled tables executes both at load time. Each entry imports exactly
 * the one table it parses with, and this module imports none.
 */
import { run } from 'parseman';
import type { Span } from 'parseman';
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
import type { jessGrammar } from './grammar/ast.js';
import { JessParseError } from './parse-error.js';
import { commentTriviaLabels } from './trivia-labels.js';

/** The rule map both compiled Jess AST variants expose. */
export type JessAstGrammar = typeof jessGrammar;

export interface JessParseOptions {
  readonly allowExtendSelectors?: readonly ExtendSelectorKind[];

  /**
   * Selector kinds accepted by `$apply`. Jess treats `$apply` as a utility-class
   * composition feature by default, so unset means class selectors only.
   */
  readonly allowApplySelectors?: readonly ApplySelectorKind[];
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

function validateRuleset(node: Ruleset, options: Required<JessParseOptions>): void {
  for (const instruction of node.extendInstructions ?? []) {
    validateSelectorList('$extend', instruction.target, options.allowExtendSelectors);
  }
  validateStatements(node.rules, options);
}

function validateStatements(rules: readonly Statement[], options: Required<JessParseOptions>): void {
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

function lineOptions(span: Span): {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
} {
  return {
    line: span.startLine,
    column: span.startColumn,
    endLine: span.endLine,
    endColumn: span.endColumn
  };
}

export function parseWith(grammar: JessAstGrammar, input: string, options: JessParseOptions = {}): Stylesheet {
  const entry = grammar.Stylesheet;
  const trivia = grammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError('Jess AST grammar is missing its public document entry.');
  }
  const result = run(
    entry,
    input,
    { trivia, rootTrivia: { select: commentTriviaLabels } }
  );
  if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
    const failureSpan = result.ok ? undefined : result.span;
    const offset = failureSpan?.start ?? (result.ok
      ? result.unconsumedFrom ?? result.span.end
      : result.span.start);
    const expected = result.expected;
    throw new JessParseError(
      offset,
      expected,
      failureSpan === undefined ? {} : lineOptions(failureSpan)
    );
  }
  const document = withTriviaMap(
    withSourceSpan(result.value, result.span),
    createTriviaMapFromParseman(input, result.rootTrivia?.index)
  );
  validateJessOptions(document, options);
  return document;
}
