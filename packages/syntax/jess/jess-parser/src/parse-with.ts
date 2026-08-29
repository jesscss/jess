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
  simpleSelectorIsPlaceholder,
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

/*
 * A placeholder is admitted by DEFAULT alongside `class`. The policy exists to
 * keep extend targets to shapes whose fold-in is predictable, and a placeholder
 * is the most predictable target there is: it exists ONLY to be extended and
 * matches no element. Denying it by default while allowing `.class` would make
 * the one purpose-built extend target the one shape you had to opt into. It
 * stays a named kind rather than an unconditional bypass so a project that
 * narrows the policy can still narrow this too.
 *
 * `$apply` keeps its class-only default — it is utility-class composition, and
 * a placeholder carries no utility classes to apply.
 */
const DEFAULT_EXTEND_SELECTOR_KINDS: readonly ExtendSelectorKind[] = ['class', 'placeholder'];

function selectorPolicyError(message: string): JessParseError {
  return new JessParseError(0, [message]);
}

function isClassSelector(simple: SimpleSelector): boolean {
  return simple.interp === null
    && typeof simple.text === 'string'
    && simple.text.startsWith('.')
    && simple.text.length > 1;
}

/**
 * A lone parent-ref target (`&`). Admitted only on the extend path: `$extend &`
 * parses and no-op-matches at eval, mirroring Less `:extend(&)`. `$apply` stays
 * class-only — a parent-ref carries no utility class to compose.
 *
 * The parser admits `&` because it is a legitimate simple-selector SHAPE; that
 * `$extend &` can only ever no-op (a selector cannot extend itself) is a SEMANTIC
 * fact, not a parse concern. TODO(eval-warn): emit an eval/lint warning for a
 * bare parent-ref extend target — deferred, tracked separately.
 */
function isBareParentRef(simple: SimpleToken): boolean {
  return simple.type === 'SimpleSelector' && simple.interp === null && simple.text === '&';
}

function isTermAllowed(
  term: SelectorTerm,
  allowed: ReadonlySet<ApplySelectorKind | ExtendSelectorKind>,
  isExtend: boolean
): boolean {
  if (term.type === 'CompoundSelector') {
    return allowed.has('compound')
      || (term.value.length === 1 && isSimpleAllowed(term.value[0]!, allowed, isExtend));
  }
  return isSimpleAllowed(term, allowed, isExtend);
}

function isSimpleAllowed(
  simple: SimpleToken,
  allowed: ReadonlySet<ApplySelectorKind | ExtendSelectorKind>,
  isExtend: boolean
): boolean {
  if (isExtend && isBareParentRef(simple)) {
    return true;
  }
  if (simple.type === 'PseudoSelector') {
    return allowed.has('simple') || allowed.has('pseudo');
  }
  return (allowed.has('class') && isClassSelector(simple))
    || (allowed.has('placeholder') && simpleSelectorIsPlaceholder(simple))
    || allowed.has('simple')
    || allowed.has('basic');
}

function isBranchAllowed(
  branch: SelectorBranch,
  allowed: ReadonlySet<ApplySelectorKind | ExtendSelectorKind>,
  isExtend: boolean
): boolean {
  return branch.type === 'ComplexSelector' || branch.type === 'RelativeSelector'
    ? allowed.has('complex')
    : isTermAllowed(branch, allowed, isExtend);
}

function validateSelectorList(label: string, selector: SelectorList, allowedKinds: readonly ExtendSelectorKind[]): void {
  const allowed = new Set(allowedKinds);
  if (!selector.selectors.every(item => isBranchAllowed(item, allowed, true))) {
    throw selectorPolicyError(`${label} selector is not allowed by allowExtendSelectors.`);
  }
}

function validateApply(node: Apply, allowedKinds: readonly ApplySelectorKind[]): void {
  const allowed = new Set(allowedKinds);
  if (!node.selectors.every(selector => isTermAllowed(selector, allowed, false))) {
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
   * author, and the message must say which: the parser already had a whole
   * stylesheet and the trailing text is surplus, versus the very first token
   * was never recognised. Do not collapse these into one message.
   *
   * "after a complete stylesheet" has to be earned by actually having parsed
   * something. Keyed on parsed rules, not on the consumed span: leading trivia
   * advances the span end without producing a single rule, so a span test
   * calls `"\n  !broken"` a complete stylesheet, which is simply false. Rules
   * are also independent of whether a dialect's root span covers trailing
   * trivia, which is a convention the four parsers do not share.
   */
  if (result.unconsumedFrom !== null) {
    if (isStylesheet(result.value) && result.value.rules.length > 0) {
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
