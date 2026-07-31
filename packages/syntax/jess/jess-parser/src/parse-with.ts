/**
 * The `parse()` body and the `$apply`/`$extend` selector policy checks, shared
 * by the two AST entries.
 *
 * The grammar table arrives as an argument rather than being chosen from a
 * boolean inside this module: Node does not tree-shake, so a module that names
 * both compiled tables executes both at load time. Each entry imports exactly
 * the one table it parses with, and this module imports none.
 */
import { buildLineIndex, offsetToLineCol, run } from 'parseman';
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

/**
 * Line/column at a bare offset. The leftover-input offset is not the start of
 * any span the run returned — `result.span` covers the text that *was*
 * consumed — so the position has to be derived from the offset itself. Only
 * ever reached on a throw path, so building the index here costs a parse
 * nothing.
 */
function positionAt(input: string, offset: number): { line: number; column: number } {
  const { line, col } = offsetToLineCol(buildLineIndex(input), offset);
  return { line, column: col };
}

/**
 * Line/column for a failure span. The compiled table without line tracking
 * leaves a span's line fields unset, so fall back to deriving them; an error
 * that reports an offset but no line is barely actionable in an editor.
 */
function lineOptions(input: string, span: Span): {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
} {
  if (span.startLine === undefined) {
    return positionAt(input, span.start);
  }
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
  if (!result.ok) {
    throw new JessParseError(result.span.start, result.expected, lineOptions(input, result.span));
  }

  /*
   * `unconsumedFrom` separates two problems that read very differently to an
   * author, and the message must say which. Past the consumed span the parser
   * already had a whole stylesheet and the trailing text is surplus; at the
   * start of it the very first token was never recognised. Do not collapse
   * these into one message.
   */
  if (result.unconsumedFrom !== null) {
    if (result.unconsumedFrom > result.span.start) {
      throw new JessParseError(result.unconsumedFrom, [], {
        message: 'Unexpected Jess input after a complete stylesheet.',
        reason:
          'The parser read a complete Jess stylesheet before this point, so the remaining text sits outside every rule, declaration, and at-rule.',
        fix: 'Delete the trailing text, or remove the extra "}" — over-closing a nested block ends the stylesheet early.',
        ...positionAt(input, result.unconsumedFrom)
      });
    }
    throw new JessParseError(result.unconsumedFrom, [], {
      message: 'Unexpected Jess syntax.',
      reason:
        'The parser could not read this token as the start of a Jess rule, declaration, assignment, or at-rule.',
      fix: 'Remove the token, or rewrite it as a selector block, a "$name: value" assignment, or an at-rule.',
      ...positionAt(input, result.unconsumedFrom)
    });
  }
  if (!isStylesheet(result.value)) {
    throw new JessParseError(result.span.end, [], {
      message: 'Jess parser did not produce a stylesheet.',
      reason:
        'The Jess parser matched the input but returned a value that is not a stylesheet document.',
      fix: 'Report this as a parser bug with the source that triggered it.',
      ...positionAt(input, result.span.end)
    });
  }
  const document = withTriviaMap(
    withSourceSpan(result.value, result.span),
    createTriviaMapFromParseman(input, result.rootTrivia?.index)
  );
  validateJessOptions(document, options);
  return document;
}
