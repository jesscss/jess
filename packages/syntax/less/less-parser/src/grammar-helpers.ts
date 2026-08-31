/**
 * Less grammar reducer helpers, hoisted out of `less-parser/src/grammar.ts`.
 *
 * These are the module-private helpers the Less grammar's `node(...)` reducers
 * call. They lived inside `grammar.ts` as free module scope, which is fine for a
 * standalone `composeLeaf(...)` grammar but not for a COMPOSABLE delta: the
 * parseman compose analyzer can only carry a reducer across a package boundary
 * when every name the reducer reads has import provenance. A free module-private
 * helper has none, so `compose([cssBaseRules, rules(lessDelta)])` refused them.
 * Hoisting them into this importable module gives each one a resolvable import,
 * and the analyzer re-emits those imports into the composing module.
 *
 * This is a pure code motion (B0-less): every body is byte-identical to its
 * former in-grammar definition and the helpers keep calling each other exactly
 * as before. These are Less's OWN helpers — promoting the ones that turn out
 * byte-identical to the css/scss/jess helpers into the shared
 * `@jesscss/core/ast` module is a separate, deferred dedup pass (guarded by the
 * open-recursion rule: a helper is only shareable when its whole transitive
 * helper-closure is identical too).
 */

import type { FieldCapture, FieldMap, Span } from 'parseman';
import { any, callArg, condition, dimension, expression, funcCall, ifNode, ifValue, important, interpolation, isForBinding, isSpannedToken, isToken, keyword, list, mixinCall, operation, propertyReference, pseudoSelector, quoted, reference, rule, selectorBranchCanonical, selectorBranchOf, selectorTermOf, semanticGapText, simpleSelector, sourceSpanOf, spaced, valueLayoutOf, variableReference, withSourceSpan, withValueLayout } from '@jesscss/core/ast';
import type { AnonymousMixin, Any, AtRuleBlock, AtRuleStatement, Block, CallArg, Combinator as SelectorCombinator, ComplexSelector, Declaration, Expression, ExtendInstruction, For, ForBinding, FunctionCall, If, IfBranch, IfValueBranch, Important, Interpolation, Keyword, List, Lookup, MixinCall, MixinDefinition, OpaqueAtRuleBlock, Param, Plugin, Quoted, Reference, ReferenceStep, Ruleset, SelectorBranch, SelectorCapture, SelectorList, SelectorTerm, SimpleSelector, SimpleToken, SourceSpan, SpannedToken, Statement, StyleImport, Token, Url, ValueNode, ValueSlot, VariableDeclaration } from '@jesscss/core/ast';
import { requireLessParseState } from './parse-state.js';
import { LessUnsupportedVariableNameError } from './parse-error.js';

type VarRef = Lookup & { readonly name: string };
/** A `Lookup` whose target is named by a nested node — Less `@@name`. */
type IndirectRef = Lookup & { readonly name: ValueNode };
type ChildContainer = { readonly rules: readonly unknown[] };
type InterpolationFact = { readonly ref: ValueNode; readonly src: string };
type InterpolationAccessorFact = { readonly key: ValueNode | number; readonly keyKind: 'var' | 'prop' | 'index'; readonly src: string };
/** A typed continuation of a left-associated public Reference chain. */
type ReferenceTailFact = { readonly step: Reference['steps'][number]; readonly src: string };
type ComplexTailFact = { readonly combinator: ' ' | '>' | '+' | '~' | '|' | '||'; readonly term: SelectorTerm };
type MixinPathSegmentFact = { readonly combinator: ' ' | '>'; readonly selector: string };
type LessEachCallback = { readonly binding: ForBinding; readonly rules: Statement[] };
type MixinGuard = NonNullable<MixinDefinition['guard']>;
type MixinCallArgument = MixinCall['args'][number];

/** One authored FUNCTION-call argument. The same {@link CallArg} a mixin-call
 *  argument is — `fade(@c, @amount: 50%)` and `.m(@amount: 50%)` are one
 *  construct in two callee positions. */
type LessCallArg = CallArg<ValueSlot>;
type CallValue = ValueSlot | MixinCall;
type MixinInteriorItem =
  | { readonly kind: 'binding'; readonly reference: VarRef; readonly default?: CallValue; readonly rest: boolean }
  | { readonly kind: 'anonymous-rest' }
  | { readonly kind: 'positional'; readonly value: CallValue };
type MixinInteriorFact = {
  readonly items: readonly MixinInteriorItem[];
  readonly separators: readonly (',' | ';')[];
  readonly trailingSeparator?: ',' | ';';
};
type MixinReferenceBaseFact = { readonly call: MixinCall; readonly raw: string };
type AttributeMatchFact = { readonly operator: string; readonly value: string; readonly modifier: string | null };
type AttributeNameFact = { readonly namespace: string; readonly name: string };
type ExtendTargetFact = { readonly target: SelectorList; readonly partial: boolean };
type BodyExtendFact = { readonly bodyExtensions: readonly ExtendInstruction[] };
type SelectorBranchFact = { readonly selector: SelectorBranch; readonly extensions: readonly ExtendInstruction[] };
type SelectorListWithExtendsFact = { readonly selector: SelectorList; readonly extensions: readonly ExtendInstruction[] };
type MixinDefinitionFact = {
  readonly params: readonly Param[];
  readonly guard?: MixinGuard;
  readonly rules: readonly Statement[];
  readonly bodySpan?: SourceSpan;
};
type MixinCallFact = { readonly args: readonly MixinCallArgument[]; readonly important: boolean };
type BareMixinCallFact = { readonly important: boolean };
type MixinStatementFact = MixinDefinitionFact | MixinCallFact;
type RulesetTailFact = {
  /** INLINE `:extend()` written on the first branch; its subject is that branch alone. */
  readonly firstExtensions: readonly ExtendTargetFact[];
  readonly branches: readonly SelectorBranchFact[];
  readonly selectorEnd: number;
  readonly guard?: MixinGuard;
  readonly rules: readonly Statement[];
  readonly extensions: readonly ExtendInstruction[];
  readonly bodySpan?: SourceSpan;
  readonly terminated?: true;
};
type CustomValuePart = string | InterpolationFact | Lookup | readonly CustomValuePart[];
type EnclosedNameFact = { readonly name: string };
type FunctionConditionFact = {
  readonly guard: MixinGuard;
  readonly src: string;
  readonly grouped: boolean;
  readonly hasComparison: boolean;

  /** The operand a BARE condition was built from, kept so a following comparison
   *  operator can reclaim it rather than unpick the {@link lessTruth} lowering. */
  readonly bare?: ValueNode;
};
type UnsupportedVariableNameFact = { readonly unsupportedVariableName: string };
type SlashBoundaryFact = { readonly before: string; readonly after: string };
function requireToken(value: unknown): Token {
  if (typeof value !== 'object' || value === null || !('value' in value) || typeof value.value !== 'string') {
    throw new TypeError('Less grammar produced a non-token child.');
  }
  return { value: value.value };
}

function functionNameFromOpener(value: unknown): string {
  const opener = requireToken(value).value;
  if (!opener.endsWith('(')) {
    throw new TypeError('Less function opener lost its glued opening paren.');
  }
  return opener.slice(0, -1);
}

function requireTerminalText(value: unknown): string {
  return typeof value === 'string' ? value : requireToken(value).value;
}

function isUnsupportedVariableNameFact(value: unknown): value is UnsupportedVariableNameFact {
  return typeof value === 'object'
    && value !== null
    && 'unsupportedVariableName' in value
    && typeof value.unsupportedVariableName === 'string';
}

function hasChildren(value: unknown): value is ChildContainer {
  return typeof value === 'object'
    && value !== null
    && 'rules' in value
    && Array.isArray(value.rules);
}

function hasGrammarType(value: unknown, grammarType: string): boolean {
  return typeof value === 'object'
    && value !== null
    && 'grammarType' in value
    && value.grammarType === grammarType;
}

function variableNameTerminalText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (isToken(value)) {
    return value.value;
  }
  if (Array.isArray(value)) {
    let text = '';
    let found = false;
    for (const child of value) {
      const childText = variableNameTerminalText(child);
      if (childText !== undefined) {
        text += childText;
        found = true;
      }
    }
    return found ? text : undefined;
  }
  if (typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'string') {
    return value.value;
  }
  if (hasChildren(value)) {
    return variableNameTerminalText(value.rules);
  }
  return undefined;
}

function unsupportedVariableNameFrom(value: unknown): string | undefined {
  if (isUnsupportedVariableNameFact(value)) {
    return value.unsupportedVariableName;
  }
  if (isTerminalText(value, '-')) {
    return '-';
  }
  if (hasGrammarType(value, 'UnsupportedVariableName') && hasChildren(value)) {
    return variableNameTerminalText(value.rules);
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const unsupported = unsupportedVariableNameFrom(child);
      if (unsupported !== undefined) {
        return unsupported;
      }
    }
    return undefined;
  }
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return unsupportedVariableNameFrom(value.value);
  }
  if (hasChildren(value)) {
    return unsupportedVariableNameFrom(value.rules);
  }
  return undefined;
}

function variableNameText(value: unknown): string {
  return unsupportedVariableNameFrom(value) ?? variableNameTerminalText(value) ?? requireTerminalText(value);
}

function requireSupportedVariableName(value: unknown, start: number, end: number): string {
  const unsupported = unsupportedVariableNameFrom(value);
  if (unsupported !== undefined) {
    throw new LessUnsupportedVariableNameError(start, end, unsupported);
  }
  return variableNameTerminalText(value) ?? requireTerminalText(value);
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Less grammar produced a non-string child.');
  }
  return value;
}

function requireCombinator(value: unknown): SelectorCombinator {
  const text = requireTerminalText(value);
  if (text === '>' || text === '+' || text === '~' || text === '|' || text === '||') {
    return text;
  }
  return ' ';
}

function isTerminalText(value: unknown, text: string): boolean {
  return (typeof value === 'string' && value === text)
    || (typeof value === 'object' && value !== null && 'value' in value && value.value === text);
}

function requireField(fields: FieldMap | undefined, name: string): FieldCapture {
  const field = fields?.[name];
  if (field === undefined || Array.isArray(field)) {
    throw new TypeError(`Less grammar lost required ${name} field.`);
  }
  return field;
}

function requireFields(fields: FieldMap | undefined, name: string): readonly FieldCapture[] {
  const field = fields?.[name];
  if (field === undefined) {
    throw new TypeError(`Less grammar lost required ${name} field.`);
  }
  return Array.isArray(field) ? field : [field];
}

/** Reassemble only grammar-produced terminal values; never slice or rescan input. */
function staticText(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (isQuoted(value)) {
    return value.src;
  }
  // Parseman may retain a terminal capture as its token object when a
  // boundary is wrapped in `field(...)`.  It is still grammar-owned static
  // text; accepting it here avoids treating authored whitespace around a
  // preserved Less slash as a dynamic import fragment.
  if (typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'string') {
    return value.value;
  }
  if (isSlashBoundaryFact(value)) {
    return value.before + '/' + value.after;
  }
  if (Array.isArray(value)) {
    return value.map(staticText).join('');
  }
  throw new TypeError('Less grammar produced a non-static import fragment.');
}

function staticTextWithTriviaGaps(children: readonly unknown[], triviaLog: readonly number[]): string {
  const gapBefore = new Set<number>();
  for (let index = 0; index < lessTriviaEntryCount(triviaLog); index += 1) {
    gapBefore.add(lessTriviaEntryInsertIndex(triviaLog, index));
  }

  let text = '';
  for (let index = 0; index < children.length; index++) {
    if (gapBefore.has(index)) {
      text += ' ';
    }
    text += staticText(children[index]);
  }
  if (gapBefore.has(children.length)) {
    text += ' ';
  }

  return semanticGapText(text);
}

function isQuoted(value: unknown): value is Quoted {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Quoted'
    && 'src' in value
    && typeof value.src === 'string'
    && 'value' in value
    && typeof value.value === 'string'
    && 'quote' in value
    && typeof value.quote === 'string'
    && 'escaped' in value
    && typeof value.escaped === 'boolean';
}

function isInterp(value: unknown): value is Interpolation {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'Interpolation' && 'parts' in value && Array.isArray(value.parts);
}

function isUrl(value: unknown): value is Url {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Url'
    && 'value' in value;
}

function isAny(value: unknown): value is Any {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Any'
    && 'src' in value
    && typeof value.src === 'string';
}

function isStyleImport(value: unknown): value is StyleImport {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'StyleImport'
    && 'name' in value
    && typeof value.name === 'string'
    && 'target' in value
    && (isQuoted(value.target) || isUrl(value.target) || isInterp(value.target))
    && 'options' in value
    && 'alias' in value;
}

function isVarDeclaration(value: unknown): value is VariableDeclaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'VariableDeclaration'
    && 'name' in value
    && typeof value.name === 'string'
    && 'value' in value
    && (isValueSlotValue(value.value) || isMixinCall(value.value));
}

function isVarRef(value: unknown): value is VarRef {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Lookup'
    && 'kind' in value
    && value.kind === 'var'
    && 'name' in value
    && typeof value.name === 'string';
}

function isVarIndirect(value: unknown): value is IndirectRef {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Lookup'
    && 'kind' in value
    && value.kind === 'var'
    && 'name' in value
    && isValueNode(value.name);
}

function isPropRef(value: unknown): value is VarRef {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Lookup'
    && 'kind' in value
    && value.kind === 'prop'
    && 'name' in value
    && typeof value.name === 'string'
    && 'raw' in value
    && typeof value.raw === 'string';
}

function isReference(value: unknown): value is Reference {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'Reference'
    && 'base' in value && isValueNode(value.base)
    && 'steps' in value && Array.isArray(value.steps);
}

function isInterpolationAccessorFact(value: unknown): value is InterpolationAccessorFact {
  return typeof value === 'object' && value !== null
    && 'key' in value && (typeof value.key === 'number' || isValueNode(value.key))
    && 'keyKind' in value && (value.keyKind === 'var' || value.keyKind === 'prop' || value.keyKind === 'index')
    && 'src' in value && typeof value.src === 'string';
}

function requireInterpolationAccessorFact(value: unknown): InterpolationAccessorFact {
  if (!isInterpolationAccessorFact(value)) {
    throw new TypeError('Less grammar produced an invalid accessor fact.');
  }
  return value;
}

function referenceWithBracketLookups(base: ValueNode, raw: string, accessors: readonly unknown[]): ValueNode {
  if (accessors.length === 0) {
    return base;
  }
  const steps: ReferenceStep[] = [];
  for (const child of accessors) {
    const accessor = requireInterpolationAccessorFact(child);
    raw += `[${accessor.src}]`;
    steps.push({ type: 'LookupStep', kind: accessor.keyKind, name: accessor.key });
  }
  return reference(base, steps, raw);
}

/** Source fallback for a grammar fact. This deliberately walks already
 * reduced facts; it never inspects or re-parses source bytes. */
/** One authored call argument re-spelled, KEYWORD INCLUDED. A named argument
 *  whose name were dropped here would re-emit as a positional one — the same
 *  lossy re-derivation the node shape exists to prevent. */
function callArgumentSource(argument: MixinCallArgument): string {
  return `${argument.name === undefined ? '' : `@${argument.name}: `}${mixinArgumentSource(argument.value)}${argument.spread ? '...' : ''}`;
}

function mixinArgumentSource(value: CallValue): string {
  if (isMixinCall(value)) {
    const path = value.path.map((segment, index) => index === 0 ? segment.selector : `${segment.combinator}${segment.selector}`).join('');
    const args = value.args.map(callArgumentSource).join(', ');
    return `${path}${value.name}(${args})${value.important ? ' !important' : ''}`;
  }
  if (Array.isArray(value)) {
    return value.map(part => mixinArgumentSource(part)).join(' ');
  }
  const node = requireValueNode(value);
  switch (node.type) {
    case 'Keyword': case 'Color': case 'Dimension': case 'Any': case 'SelectorCapture': return node.src;
    case 'Quoted': return node.src;
    case 'Lookup': return node.kind === 'var'
      ? `@${typeof node.name === 'string' ? node.name : mixinArgumentSource(node.name)}`
      : node.raw;
    case 'Reference': return node.raw;
    case 'FunctionCall': return `${node.name}(${node.args.map(callArgumentSource).join(', ')})`;
    case 'Block': return `${node.escaped ? '~' : ''}${node.delimiter === 'square' ? '[' : '('}${mixinArgumentSource(node.value)}${node.delimiter === 'square' ? ']' : ')'}`;
    case 'Operation': return `${mixinArgumentSource(node.left)} ${node.operator} ${mixinArgumentSource(node.right)}`;
    case 'Sequence': return node.parts.map(mixinArgumentSource).join(' ');
    case 'List': return node.value.map(mixinArgumentSource).join(node.sep === ',' ? ', ' : node.sep === '/' ? ' / ' : ' ');
    case 'Important': return `${mixinArgumentSource(node.value)} !important`;
    default: throw new TypeError(`Less mixin-reference raw source cannot represent ${node.type}.`);
  }
}

/**
 * Fold only already-reduced grammar facts into a public Reference.  In
 * particular, this never re-reads the source to discover chain structure.
 */
function referenceWithTails(base: ValueNode | MixinCall, baseRaw: string, tails: readonly unknown[]): Reference {
  const steps: ReferenceStep[] = [];
  let raw = baseRaw;
  for (const child of tails) {
    if (typeof child !== 'object' || child === null || !('step' in child) || !('src' in child)) {
      throw new TypeError('Less grammar produced an invalid reference-tail fact.');
    }
    const tail = requireReferenceTailFact(child);
    raw += tail.src;
    steps.push(tail.step);
  }
  return reference(base, steps, raw);
}

function isMixinInteriorItem(value: unknown): value is MixinInteriorItem {
  return typeof value === 'object' && value !== null && 'kind' in value
    && (value.kind === 'binding' || value.kind === 'anonymous-rest' || value.kind === 'positional');
}

function requireMixinInteriorItem(value: unknown): MixinInteriorItem {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    throw new TypeError('Less mixin interior produced an invalid item.');
  }
  if (!isMixinInteriorItem(value)) {
    throw new TypeError('Less mixin interior produced an unknown item kind.');
  }
  return value;
}

function isReferenceTailFact(value: unknown): value is ReferenceTailFact {
  return typeof value === 'object' && value !== null
    && 'step' in value && typeof value.step === 'object' && value.step !== null
    && 'src' in value && typeof value.src === 'string';
}

function requireReferenceTailFact(value: unknown): ReferenceTailFact {
  if (!isReferenceTailFact(value)) {
    throw new TypeError('Less grammar produced an invalid reference-tail fact.');
  }
  return value;
}

function isMixinReferenceBaseFact(value: unknown): value is MixinReferenceBaseFact {
  return typeof value === 'object' && value !== null
    && 'call' in value && isMixinCall(value.call)
    && 'raw' in value && typeof value.raw === 'string';
}

function requireMixinReferenceBaseFact(value: unknown): MixinReferenceBaseFact {
  if (!isMixinReferenceBaseFact(value)) {
    throw new TypeError('Less grammar produced an invalid mixin-reference base fact.');
  }
  return value;
}

function interpolationFactFromChildren(children: readonly unknown[], span: SourceSpan): InterpolationFact {
  const opener = requireToken(children[0]).value;
  const head = opener === '@{'
    ? requireSupportedVariableName(children[1], span.start, span.end)
    : requireToken(children[1]).value;
  let src = `${opener}${head}`;
  for (const child of children.slice(2, -1)) {
    src += `[${requireInterpolationAccessorFact(child).src}]`;
  }
  const ref = referenceWithBracketLookups(
    opener === '@{' ? variableReference(head, 'scoped') : propertyReference(head),
    `${opener === '@{' ? '@' : '$'}${head}`,
    children.slice(2, -1)
  );
  return { ref, src: `${src}}` };
}

function appendInterpolationLiteral(parts: Interpolation['parts'], lit: string): void {
  const previous = parts.at(-1);
  if (previous !== undefined && 'lit' in previous) {
    parts[parts.length - 1] = { lit: previous.lit + lit };
  } else {
    parts.push({ lit });
  }
}

function appendEnclosedLiteral(parts: Interpolation['parts'], lit: string): void {
  if (lit.length === 0) {
    return;
  }
  const last = parts.at(-1);
  if (last !== undefined && 'lit' in last) {
    last.lit += lit;
  } else {
    parts.push({ lit });
  }
}

function enclosedInterpolationFromChildren(children: readonly unknown[]): Interpolation {
  const parts: Interpolation['parts'] = [];
  const append = (child: unknown): void => {
    if (child === undefined || child === null || child === false) {
      return;
    }
    if (isInterpolationFact(child)) {
      parts.push({ ref: child.ref, unquote: true });
    } else if (typeof child === 'object' && child !== null && 'type' in child && child.type === 'Interpolation') {
      if (!isValueNode(child) || child.type !== 'Interpolation') {
        throw new TypeError('Less general-enclosed grammar produced a non-interpolation child.');
      }
      for (const part of child.parts) {
        if ('lit' in part) {
          appendEnclosedLiteral(parts, part.lit);
        } else {
          parts.push(part);
        }
      }
    } else if (Array.isArray(child)) {
      for (const nested of child) {
        append(nested);
      }
    } else if (typeof child === 'string') {
      appendEnclosedLiteral(parts, child);
    } else {
      appendEnclosedLiteral(parts, requireToken(child).value);
    }
  };
  for (const child of children) {
    append(child);
  }
  return interpolation(parts);
}

function isInterpolationFact(value: unknown): value is InterpolationFact {
  return typeof value === 'object' && value !== null
    && 'ref' in value && isValueNode(value.ref)
    && 'src' in value && typeof value.src === 'string';
}

function isSlashBoundaryFact(value: unknown): value is SlashBoundaryFact {
  return typeof value === 'object' && value !== null
    && 'before' in value && typeof value.before === 'string'
    && 'after' in value && typeof value.after === 'string';
}

function requireInterpolationFact(value: unknown): InterpolationFact {
  if (!isInterpolationFact(value)) {
    throw new TypeError('Less grammar produced an invalid interpolation fact.');
  }
  return value;
}

/** Fold grammar-owned interpolation facts, bare variable references, and literal
 * tokens into canonical Interpolation parts.  An optional `leading` literal seeds
 * the run so quote openers stay attached to their following literal segment. */
function interpolationPartsFrom(children: readonly unknown[], unquote: boolean, leading?: string): Interpolation['parts'] {
  const parts: Interpolation['parts'] = [];
  if (leading !== undefined) {
    parts.push({ lit: leading });
  }
  for (const child of children) {
    if (isInterpolationFact(child)) {
      parts.push({ ref: child.ref, unquote });
    } else if (isVarRef(child)) {
      parts.push({ ref: child, unquote });
    } else {
      appendInterpolationLiteral(parts, requireToken(child).value);
    }
  }
  return parts;
}

/** Reduce grammar-produced `separator` field captures into their terminal text. */
function separatorsFromFields(fields: FieldMap | undefined): string[] {
  return fields?.separator === undefined
    ? []
    : requireFields(fields, 'separator').map(separator => staticText(separator.value));
}

function sourceFromState(state: unknown): string | undefined {
  return typeof state === 'object'
    && state !== null
    && 'source' in state
    && typeof state.source === 'string'
    ? state.source
    : undefined;
}

/**
 * Does Less's configured `math:` policy compute THIS operator with no enclosing
 * math context (§12.6b)?
 *
 * - `always` — every operator computes bare.
 * - `parens-division` (Less's default) — everything but `/`, which stays a CSS
 *   separator until a paren or `calc(…)` says otherwise.
 * - `parens` / `strict` — nothing computes bare.
 *
 * The answer is written onto `Operation.mathOutsideParens` and the evaluator
 * reads the node. It is deliberately NOT handed to eval as a mode: a dialect
 * difference is carried by what the lowered node says.
 */
/**
 * Restate one operand of a PRESERVED slash group as arithmetic that does not
 * happen on its own.
 *
 * When the math policy keeps an authored top-level `/` as a slash rather than a
 * division, the whole group is authored bytes — so a neighbouring `+` inside it
 * must not fold either, or `4 / 2 + 5em` prints `4 / 7em`. That suppression
 * used to live at eval, where `serialize.ts` re-entered the slot with
 * `mathMode` forced to `'strict'`; it belongs here, because the shape that
 * causes it is one the GRAMMAR recognised (§12.6b).
 *
 * Only the operation spine is restated. A parenthesized operand is a `Block`,
 * not an `Operation`, and keeps its own math context — which is exactly why
 * `(4px / 2) + 1px` still folds inside the parens.
 */
function withoutBareMath(node: ValueNode): ValueNode {
  if (node.type !== 'Operation' || !node.mathOutsideParens) {
    return node;
  }
  const restated = operation(
    node.operator,
    withoutBareMath(node.left),
    withoutBareMath(node.right),
    node.inMathFunction,
    false
  );
  const span = sourceSpanOf(node);
  return span === undefined ? restated : withSourceSpan(restated, span);
}

function lessMathOutsideParens(state: unknown, operator: string): boolean {
  const { mathMode } = requireLessParseState(state);
  if (mathMode === 'always') {
    return true;
  }
  if (mathMode === 'parens-division') {
    return operator !== '/';
  }
  return false;
}

const lessTriviaKindLabels = ['whitespace', 'lineComment', 'blockComment'] as const;
const LESS_NODE_TRIVIA_STRIDE = 4;

function lessTriviaEntryCount(triviaLog: readonly number[]): number {
  return Math.trunc(triviaLog.length / LESS_NODE_TRIVIA_STRIDE);
}

function lessTriviaEntryStart(triviaLog: readonly number[], index: number): number {
  return triviaLog[index * LESS_NODE_TRIVIA_STRIDE] ?? 0;
}

function lessTriviaEntryEnd(triviaLog: readonly number[], index: number): number {
  return triviaLog[index * LESS_NODE_TRIVIA_STRIDE + 1] ?? 0;
}

function lessTriviaEntryInsertIndex(triviaLog: readonly number[], index: number): number {
  return triviaLog[index * LESS_NODE_TRIVIA_STRIDE + 2] ?? 0;
}

function lessTriviaEntryKind(triviaLog: readonly number[], index: number): typeof lessTriviaKindLabels[number] | undefined {
  const kindIndex = triviaLog[index * LESS_NODE_TRIVIA_STRIDE + 3];
  return kindIndex === undefined ? undefined : lessTriviaKindLabels[kindIndex];
}

function lessTriviaEntryText(triviaLog: readonly number[], source: string, index: number): string {
  return source.slice(lessTriviaEntryStart(triviaLog, index), lessTriviaEntryEnd(triviaLog, index));
}

function lessTriviaEntryHasLineBreak(triviaLog: readonly number[], source: string, index: number): boolean {
  for (const char of lessTriviaEntryText(triviaLog, source, index)) {
    if (char === '\n' || char === '\r') {
      return true;
    }
  }
  return false;
}

function triviaTextAtInsertIndex(
  triviaLog: readonly number[],
  state: unknown,
  insertIndex: number
): string {
  const source = sourceFromState(state);
  if (source === undefined) {
    return '';
  }

  const entryCount = lessTriviaEntryCount(triviaLog);
  const selected: number[] = [];
  let hasBlockComment = false;
  let hasLineBreak = false;
  for (let index = 0; index < entryCount; index += 1) {
    if (lessTriviaEntryInsertIndex(triviaLog, index) !== insertIndex) {
      continue;
    }
    selected.push(index);
    if (lessTriviaEntryKind(triviaLog, index) === 'blockComment') {
      hasBlockComment = true;
    }
    if (lessTriviaEntryHasLineBreak(triviaLog, source, index)) {
      hasLineBreak = true;
    }
  }

  if (!hasBlockComment) {
    return hasLineBreak
      ? selected.map(index => lessTriviaEntryText(triviaLog, source, index)).join('')
      : '';
  }

  const outputEntries = new Set<number>();
  const selectedEntries = new Set(selected);
  for (const index of selected) {
    if (lessTriviaEntryKind(triviaLog, index) !== 'blockComment') {
      continue;
    }
    const previous = index - 1;
    const next = index + 1;
    if (selectedEntries.has(previous) && lessTriviaEntryKind(triviaLog, previous) === 'whitespace') {
      outputEntries.add(previous);
    }
    outputEntries.add(index);
    if (selectedEntries.has(next) && lessTriviaEntryKind(triviaLog, next) === 'whitespace') {
      outputEntries.add(next);
    }
  }
  return selected
    .filter(index => outputEntries.has(index))
    .map(index => lessTriviaEntryText(triviaLog, source, index))
    .join('');
}

function rawLeafText(entry: unknown): string | undefined {
  return typeof entry === 'object'
    && entry !== null
    && '_tag' in entry
    && entry._tag === 'leaf'
    && 'value' in entry
    && typeof entry.value === 'string'
    ? entry.value
    : undefined;
}

/** `sepBy`/`oneOrMoreSep` contribute their items and nothing else, so a list
 * separator is absent from `children` and present in `rawChildren` — which is
 * the array a trivia insert index has always addressed. Locate the k-th
 * separator's `rawChildren` index by the exact text `field('separator')`
 * captured, matched in source order, so trivia can be read against the array it
 * is indexed against rather than against a `children` array that no longer
 * advances in step with it. */
function separatorRawIndexes(
  rawChildren: readonly unknown[],
  separators: readonly string[]
): number[] {
  const indexes: number[] = [];
  let next = 0;
  for (let index = 0; index < rawChildren.length && next < separators.length; index += 1) {
    if (rawLeafText(rawChildren[index]) === separators[next]) {
      indexes.push(index);
      next += 1;
    }
  }
  return indexes;
}

/** Trivia around one separator: what sits before it, then the separator, then
 * what sits between it and the item that follows. `rawIndex + 1` is that item —
 * a `sepBy` separator is always followed immediately by one item entry. */
function separatorWithSurroundingTrivia(
  separator: string,
  rawIndex: number,
  triviaLog: readonly number[],
  state: unknown
): string {
  return triviaTextAtInsertIndex(triviaLog, state, rawIndex)
    + separator
    + triviaTextAtInsertIndex(triviaLog, state, rawIndex + 1);
}

function functionSeparatorsFromFields(
  fields: FieldMap | undefined,
  rawChildren: readonly unknown[],
  triviaLog: readonly number[],
  state: unknown
): string[] {
  const separators = separatorsFromFields(fields);
  if (separators.length === 0) {
    return separators;
  }

  const separatorIndexes = separatorRawIndexes(rawChildren, separators);

  return separators.map((separator, index) => {
    const separatorIndex = separatorIndexes[index];
    return separatorIndex === undefined
      ? separator
      : separatorWithSurroundingTrivia(separator, separatorIndex, triviaLog, state);
  });
}

function hasField(fields: FieldMap | undefined, name: string): boolean {
  return fields?.[name] !== undefined;
}

function commaListWithTriviaFromChildren<T extends ValueSlot>(
  children: readonly unknown[],
  fields: FieldMap | undefined,
  triviaLog: readonly number[],
  state: unknown,
  pick: (child: unknown) => child is T,
  rawChildren: readonly unknown[]
): T | List {
  const values = children.filter(pick);
  if (values.length === 1) {
    return values[0]!;
  }
  const result = list(values, ',');
  const authoredSeparators = separatorsFromFields(fields);
  if (authoredSeparators.length !== values.length - 1) {
    return result;
  }
  const separatorIndexes = separatorRawIndexes(rawChildren, authoredSeparators);
  if (separatorIndexes.length !== authoredSeparators.length) {
    return result;
  }
  const separators = authoredSeparators.map((separator, index) =>
    separatorWithSurroundingTrivia(separator, separatorIndexes[index]!, triviaLog, state));
  return withValueLayout(result, separators);
}

function isGluedValueBoundary(child: unknown): boolean {
  return typeof child === 'object'
    && child !== null
    && 'kind' in child
    && child.kind === 'glued-value-boundary';
}

/** Shared value-term reduction for grammar branches that keep comments in
 * Parseman's trivia log rather than as semantic `Comment` value nodes. */
function valuePieceReducerWithTrivia(
  children: readonly unknown[],
  triviaLog: readonly number[],
  state: unknown
): ValueSlot {
  const values = children
    .filter(child => isValueNode(child) || isTerminalText(child, '/') || isTerminalText(child, '-') || isTerminalText(child, '%'))
    .map(child => isTerminalText(child, '/') || isTerminalText(child, '-') || isTerminalText(child, '%')
      ? keyword(requireTerminalText(child))
      : requireValueNode(child));
  if (values.length === 1) {
    return values[0]!;
  }

  const separators: string[] = [];
  let previousValue = -1;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!(isValueNode(child) || isTerminalText(child, '/') || isTerminalText(child, '-') || isTerminalText(child, '%'))) {
      continue;
    }
    if (previousValue >= 0) {
      const trivia = triviaTextAtInsertIndex(triviaLog, state, index);
      const boundary = children.slice(previousValue + 1, index).some(isGluedValueBoundary);
      separators.push(trivia.length > 0 ? trivia : boundary ? '' : ' ');
    }
    previousValue = index;
  }

  return withValueLayout(values, separators);
}

/** A structural value child stays as-is; a grammar terminal becomes a keyword. */
function keywordOrValue(child: unknown): ValueNode {
  return isValueNode(child) ? child : keyword(requireTerminalText(child));
}

function layoutFromTriviaBoundaries(
  children: readonly unknown[],
  triviaLog: readonly number[],
  state: unknown,
  pick: (child: unknown) => boolean
): string[] {
  const separators: string[] = [];
  let previous = -1;
  for (let index = 0; index < children.length; index += 1) {
    if (!pick(children[index])) {
      continue;
    }
    if (previous >= 0) {
      const trivia = triviaTextAtInsertIndex(triviaLog, state, index);
      separators.push(trivia.length > 0 ? trivia : ' ');
    }
    previous = index;
  }
  return separators;
}

/** Space-join value/terminal children into a single Sequence. */
function spacedFromValueChildren(
  children: readonly unknown[],
  triviaLog: readonly number[] = [],
  state?: unknown
): ValueNode {
  const values = children.map(keywordOrValue);
  if (values.length === 1) {
    return values[0]!;
  }
  const separators = layoutFromTriviaBoundaries(children, triviaLog, state, () => true);
  return spaced(values, separators);
}

function isComplexTailFact(value: unknown): value is ComplexTailFact {
  return typeof value === 'object' && value !== null && 'combinator' in value && 'term' in value;
}

/** Shared `optional(combinator) term` selector-tail reduction: the term
 * and combinator sub-rules vary by selector family, but the fold to a
 * `{ combinator, term }` fact is identical. */
function combinatorTailReducer(children: readonly unknown[]): ComplexTailFact {
  const token = children.find(child => !isSelectorTerm(child));
  const term = children.find(isSelectorTerm)!;
  return { combinator: token === undefined ? ' ' : requireCombinator(token), term };
}

/**
 * Fold an inlined `CompoundSelector (combinator? CompoundSelector)*` child run
 * into the `{ term }, { combinator, term }, …` segment list `selectorBranchOf`
 * consumes. The combinator token is folded inline exactly as the CSS base does
 * — there is no `ComplexTail` wrapper node — so the concrete tree converges to
 * CSS's `ComplexSelector` shape. Recognition-only children (the `not(…)` guard
 * lookaheads) contribute no term and reduce to the descendant default, so they
 * never disturb the fold.
 */
function complexSegmentsFrom(
  children: readonly unknown[]
): [{ combinator?: SelectorCombinator; term: SelectorTerm }, ...Array<{ combinator?: SelectorCombinator; term: SelectorTerm }>] {
  const segments: Array<{ combinator?: SelectorCombinator; term: SelectorTerm }> = [];
  let combinator: SelectorCombinator = ' ';
  for (const child of children) {
    if (isSelectorTerm(child)) {
      segments.push(segments.length === 0 ? { term: child } : { combinator, term: child });
      combinator = ' ';
    } else {
      combinator = requireCombinator(child);
    }
  }
  return [segments[0]!, ...segments.slice(1)];
}

/** Space-separated query clause reduction: keyword/value children join into a
 * Sequence, and a single value collapses to itself. */
function queryClauseReducer(
  children: readonly unknown[],
  triviaLog: readonly number[] = [],
  state?: unknown
): ValueNode {
  const values = children
    .filter(child => child !== undefined && child !== null && child !== false)
    .map(keywordOrValue);
  if (values.length === 1) {
    return values[0]!;
  }
  const separators = layoutFromTriviaBoundaries(
    children,
    triviaLog,
    state,
    child => child !== undefined && child !== null && child !== false
  );
  return spaced(values, separators);
}

function queryComparisonOperators(children: readonly unknown[]): string[] {
  return children
    .filter((child) => {
      const text = typeof child === 'string'
        ? child
        : typeof child === 'object' && child !== null && 'value' in child
          ? child.value
          : null;
      return text === '<' || text === '<=' || text === '=' || text === '>=' || text === '>';
    })
    .map(requireTerminalText);
}

/** Turn grammar-owned custom-property leaves into a canonical value without a source scan. */
function customValueFromParts(parts: readonly CustomValuePart[]): ValueNode {
  const interpolationParts: Interpolation['parts'] = [];
  let hasInterpolation = false;
  const append = (part: CustomValuePart): void => {
    if (typeof part === 'string') {
      appendInterpolationLiteral(interpolationParts, part);
    } else if (Array.isArray(part)) {
      for (const nested of part) {
        append(nested);
      }
    } else if (isInterpolationFact(part)) {
      hasInterpolation = true;
      interpolationParts.push({ ref: part.ref, unquote: true });
    } else if (isVarRef(part)) {
      hasInterpolation = true;
      interpolationParts.push({ ref: part, unquote: false });
    } else {
      throw new TypeError('Less custom value retained an untyped grammar part.');
    }
  };
  for (const part of parts) {
    append(part);
  }
  if (hasInterpolation) {
    return interpolation(interpolationParts);
  }
  // A custom-property value is verbatim `<declaration-value>` text that is never
  // evaluated (css-syntax-3 §7.2), so even a wholly-quoted value stays `Any`
  // rather than being re-typed as a `Quoted` string.
  return any(interpolationParts.map(part => 'lit' in part ? part.lit : '').join(''));
}

function customPartsFromChildren(children: readonly unknown[]): CustomValuePart[] {
  const parts: CustomValuePart[] = [];
  for (const child of children) {
    if (isInterpolationFact(child)) {
      parts.push(child);
    } else if (isVarRef(child)) {
      parts.push(child);
    } else if (Array.isArray(child)) {
      parts.push(customPartsFromChildren(child));
    } else if (typeof child === 'string') {
      parts.push(child);
    } else {
      parts.push(requireToken(child).value);
    }
  }
  return parts;
}

function isValueNode(value: unknown): value is ValueNode {
  // Dispatch once on the discriminant rather than re-running the object guard
  // through each `isX` prefix. Type-only arms return true directly (matching
  // the original union); the four structurally-validated node kinds delegate to
  // their deep guards, preserving identical acceptance.
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  switch (value.type) {
    case 'Keyword':
    case 'Color':
    case 'Dimension':
    case 'Url':
    case 'FunctionCall':
    case 'Sequence':
    case 'List':
    case 'Operation':
    case 'Condition':
    case 'Block':
    case 'Expression':
    case 'Lookup':
    case 'Reference':
    case 'Interpolation':
    case 'Important':
    case 'SelectorCapture':
    case 'AnonymousMixin':
    case 'Collection':
    case 'IfValue':
      return true;
    case 'Quoted':
      return isQuoted(value);
    case 'Any':
      return isAny(value);
    default:
      return false;
  }
}

function valueSlot(value: ValueSlot): ValueSlot {
  // Ordinary adjacent terms are raw recursive ValueSlot arrays.  The
  // variable-declaration reducer uses `variableValueSlot` below for the one
  // Less-specific boundary where a preserved slash must remain available to
  // later math-mode evaluation; declaration/value positions stay raw arrays.
  if (Array.isArray(value)) {
    return value;
  }
  if (isSequence(value)) {
    return value.parts;
  }
  if (isValueNode(value) && value.type === 'Block' && isSequence(value.value)) {
    return { ...value, value: value.value.parts };
  }
  return value;
}

function isSequence(value: ValueSlot): value is Extract<ValueNode, { type: 'Sequence' }> {
  return isValueNode(value) && value.type === 'Sequence';
}

function variableValueSlot(value: unknown): ValueSlot {
  const slot: ValueSlot = Array.isArray(value) ? value as ValueSlot : requireValueNode(value);
  if (Array.isArray(slot)) {
    // A variable-held slash with authored whitespace is one preserved Less
    // arithmetic value.  Keep ordinary adjacent values as the raw recursive
    // array, but retain this semantic boundary so a later operation does not
    // mistake `10px / 2` for a numeric operand and invent `calc(...)`.  Glued
    // slash values remain raw arrays for the existing Less structural shape.
    const layout = valueLayoutOf(slot);
    const hasSlash = slot.some(part =>
      isValueNode(part) && (part.type === 'Keyword' || part.type === 'Any') && part.src.trim() === '/');
    if (hasSlash && layout?.some(separator => separator.length > 0)) {
      const parts: ValueNode[] = [];
      for (const part of slot) {
        if (!isValueNode(part)) {
          return slot;
        }
        parts.push(part);
      }
      return withValueLayout(spaced(parts), layout);
    }
    return slot;
  }
  if (isSequence(slot)) {
    const preservedDivision = slot.parts.some(part =>
      (part.type === 'Keyword' || part.type === 'Any') && part.src.trim() === '/');
    const authoredBoundary = valueLayoutOf(slot)?.some(separator => separator.length > 0) === true;
    return preservedDivision && authoredBoundary ? slot : slot.parts;
  }
  if (isValueNode(slot) && slot.type === 'Block' && isSequence(slot.value)) {
    const preservedDivision = slot.value.parts.some(part =>
      (part.type === 'Keyword' || part.type === 'Any') && part.src.trim() === '/');
    return preservedDivision ? slot : { ...slot, value: slot.value.parts };
  }
  return slot;
}

function isValueSlotValue(value: unknown): value is ValueSlot {
  return Array.isArray(value) ? value.every(isValueSlotValue) : isValueNode(value);
}

/** A reduced {@link LessCallArg}: an argument that carried a `@name:` keyword,
 *  as opposed to the bare value slot a positional argument reduces to. */
function isLessCallArg(value: unknown): value is LessCallArg {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'value' in value
    && 'name' in value
    && isValueSlotValue(value.value);
}

function callWithLayout(
  name: string,
  args: Array<ValueSlot | LessCallArg>,
  separators: string[],
  hasTrailingSeparator: boolean,
  span: SourceSpan
): FunctionCall {
  const call = funcCall(name, args);
  if (separators.length === args.length - 1 || hasTrailingSeparator) {
    withValueLayout(call.args, separators);
  }
  return withSourceSpan(call, span);
}

/**
 * The CONDITION an `if()` / `boolean()` / `not()` / `and()` / `or()` argument
 * states, in Less's own terms.
 *
 * A structured {@link Condition} (the argument carried a comparison, `not(…)`
 * or `and`/`or`) already IS a guard tree. Anything else is a bare operand, and
 * Less's condition asks "is this literally the boolean `true`" — the same
 * {@link lessTruth} rule `when (@x)` uses (§4.4.2). `"a"`, `red`, `0` and even
 * the STRING `"true"` are all false under it.
 */
function lessConditionGuard(arg: ValueSlot): MixinGuard {
  return !Array.isArray(arg) && isValueNode(arg) && arg.type === 'Condition' ? arg.guard : lessTruth(arg);
}

/**
 * Lower Less's `if()` / `boolean()` — SYNTAX wearing call parentheses, never
 * functions (§4.5.3a) — into the jess constructs they mean:
 *
 * ```
 * boolean(<cond>)      ->  $( <cond> )                        an expression boundary
 * not(<cond>)          ->  $( not(<cond>) )                   the native operator
 * and(<c>, <c>, …)     ->  $( (<c>) and (<c>) … )             the native operator
 * or(<c>, <c>, …)      ->  $( (<c>) or (<c>) … )              the native operator
 * if(<cond>, a, b)     ->  $if (<cond>) { a } $else { b }     the VALUE-position $if
 * ```
 *
 * Doing it HERE is the whole point. The condition is lowered by the grammar
 * that knows the dialect, so nothing downstream needs to — core evaluates a
 * guard tree that already means what `.less` meant, and the identical `.scss`
 * spelling lowers to Sass's rule in its own grammar. A dialect switch in the
 * evaluator would be the alternative, and there is no dialect in core.
 *
 * `not` / `and` / `or` land on the native logical operators (§4.5.5) rather than
 * on `fns/` entries, which is the same ruling that puts them in this set at all.
 */
function lowerLogicalCall(call: FunctionCall): ValueNode {
  const args = call.args;
  const first = args[0]?.value;
  if (first === undefined) {
    return call;
  }
  const boundaryCondition = (guard: MixinGuard): Expression =>
    expression(condition(guard, functionConditionSource(call)));

  /* `and`/`or` are n-ary in Less and fold LEFT, so `and(a, b, c)` is
   * `(a and b) and c` — the same order the guard evaluator short-circuits in. */
  const fold = (kind: 'and' | 'or'): MixinGuard =>
    args.slice(1).reduce<MixinGuard>(
      (left, arg) => ({ g: kind, left, right: lessConditionGuard(arg.value) }),
      lessConditionGuard(first)
    );
  switch (call.name.toLowerCase()) {
    case 'boolean':
      return args.length === 1 ? boundaryCondition(lessConditionGuard(first)) : call;
    case 'not':
      return args.length === 1 ? boundaryCondition({ g: 'not', inner: lessConditionGuard(first) }) : call;
    case 'and':
      return boundaryCondition(fold('and'));
    case 'or':
      return boundaryCondition(fold('or'));
    case 'if': {
      if (args.length < 2 || args.length > 3) {
        return call;
      }
      const guard = lessConditionGuard(first);
      const taken: IfValueBranch = { guard, value: args[1]!.value };
      const otherwise = args[2]?.value;
      return ifValue(otherwise === undefined ? [taken] : [taken, { guard: null, value: otherwise }]);
    }
    default:
      return call;
  }
}

/**
 * STATEMENT-position `if(<cond>, {…}, {…});` is the STATEMENT `$if`, not the
 * value form (§4.5.3b, §4.5.6): its arms are rule bodies, so they attach as
 * statements rather than producing a value.
 *
 * Only detached-ruleset arms qualify. `if(true, 1, 2);` returns a VALUE, which
 * lessc 4.6.3 rejects outright ("Dimension node returned by a function is not
 * valid here"); it stays an ordinary call statement rather than being forced
 * into a shape it does not have.
 */
function lowerLogicalCallStatement(call: FunctionCall): FunctionCall | If {
  const args = call.args;
  const first = args[0]?.value;
  if (call.name.toLowerCase() !== 'if' || first === undefined || args.length < 2 || args.length > 3) {
    return call;
  }
  const arms = args.slice(1).map(arm => arm.value);
  if (!arms.every((arm): arm is AnonymousMixin => !Array.isArray(arm) && isValueNode(arm) && arm.type === 'AnonymousMixin')) {
    return call;
  }
  const taken: IfBranch = { guard: lessConditionGuard(first), rules: arms[0]!.rules };
  const otherwise = arms[1];
  return ifNode(otherwise === undefined ? [taken] : [taken, { guard: null, rules: otherwise.rules }]);
}

function functionCallFromChildren(
  children: readonly unknown[],
  fields: FieldMap | undefined,
  span: SourceSpan,
  triviaLog: readonly number[],
  state: unknown,
  rawChildren: readonly unknown[]
): ValueNode {
  const name = functionNameFromOpener(children[0]);
  const args: Array<ValueSlot | LessCallArg> = [];
  for (const child of children.slice(1, -1)) {
    if (isLessCallArg(child) || isValueSlotValue(child)) {
      args.push(child);
    }
  }
  const separators = functionSeparatorsFromFields(fields, rawChildren, triviaLog, state);
  return lowerLogicalCall(callWithLayout(name, args, separators, hasField(fields, 'trailingSeparator'), span));
}

/**
 * The STATEMENT lane's call (`foo();`). {@link lowerLogicalCall} deliberately
 * does not run here: `if(…)` / `boolean(…)` are VALUE-position syntax, and a
 * bare `if(true, 1, 2);` statement is not that construct — lessc 4.6.3 rejects
 * it outright, and the un-lowered call keeps it an ordinary unknown-call
 * statement rather than a value node in a statement slot.
 */
function argumentFunctionFromChildren(
  children: readonly unknown[],
  fields: FieldMap | undefined,
  span: SourceSpan
): FunctionCall {
  const name = functionNameFromOpener(children[0]);
  const args = children.slice(1, -1).filter(
    (child): child is ValueSlot | LessCallArg => isLessCallArg(child) || isValueSlotValue(child)
  );
  return callWithLayout(name, args, separatorsFromFields(fields), hasField(fields, 'trailingSeparator'), span);
}

function requireValueSlot(value: unknown): ValueSlot {
  return Array.isArray(value) ? value as ValueSlot : valueSlot(requireValueNode(value));
}

function requireValueNode(value: unknown): ValueNode {
  if (!isValueNode(value)) {
    throw new TypeError('Less grammar produced a non-value child.');
  }
  return value;
}

function requireKeyword(value: unknown): Keyword {
  const node = requireValueNode(value);
  if (node.type !== 'Keyword') {
    throw new TypeError('Less grammar produced a non-keyword child.');
  }
  return node;
}

function requireMixinCallArgumentValue(value: unknown): MixinCallArgument['value'] {
  if (!isValueSlotValue(value) && !isMixinCall(value)) {
    throw new TypeError('Less grammar produced an invalid mixin-call argument.');
  }
  return value;
}

function isDeclaration(value: unknown): value is Declaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Declaration'
    && 'name' in value
    && (typeof value.name === 'string' || isInterp(value.name))
    && 'value' in value
    && 'value' in value
    && isValueSlotValue(value.value)
    && 'merge' in value
    && (value.merge === null || value.merge === ',' || value.merge === ' ')
    && 'important' in value
    && typeof value.important === 'boolean';
}

function isSelectorList(value: unknown): value is SelectorList {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'SelectorList'
    && 'selectors' in value
    && Array.isArray(value.selectors);
}

function requireSelectorList(value: unknown): SelectorList {
  if (!isSelectorList(value)) {
    throw new TypeError('Less grammar produced a non-selector child.');
  }
  return value;
}

function isComplex(value: unknown): value is ComplexSelector {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'ComplexSelector'
    && 'value' in value
    && Array.isArray(value.value);
}

function isRelative(value: unknown): value is Extract<SelectorBranch, { readonly type: 'RelativeSelector' }> {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'RelativeSelector'
    && 'value' in value
    && Array.isArray(value.value);
}

function isSelectorBranch(value: unknown): value is SelectorBranch {
  return isSelectorTerm(value) || isComplex(value) || isRelative(value);
}

const selectorBranchesFrom = (children: readonly unknown[]): SelectorBranch[] =>
  children.filter(isSelectorBranch);

function branchSegments(branch: SelectorBranch): [{ combinator?: SelectorCombinator; term: SelectorTerm }, ...Array<{ combinator?: SelectorCombinator; term: SelectorTerm }>] {
  if (branch.type !== 'ComplexSelector' && branch.type !== 'RelativeSelector') {
    return [{ term: branch }];
  }
  const segments: Array<{ combinator?: SelectorCombinator; term: SelectorTerm }> = [];
  let combinator: SelectorCombinator = ' ';
  const start = branch.type === 'RelativeSelector' ? 1 : 0;
  for (let index = start; index < branch.value.length; index++) {
    const part = branch.value[index]!;
    if (typeof part === 'string') {
      combinator = part;
    } else {
      segments.push(segments.length === 0 ? { term: part } : { combinator, term: part });
      combinator = ' ';
    }
  }
  return [segments[0]!, ...segments.slice(1)];
}

type MixinPrefixSegment = { readonly combinator: ' ' | '>'; readonly selector: string };

function mixinPrefixFromSelectorBranch(branch: SelectorBranch): readonly MixinPrefixSegment[] | null {
  const prefix: MixinPrefixSegment[] = [];
  for (const segment of branchSegments(branch)) {
    if (segment.combinator !== undefined && segment.combinator !== ' ' && segment.combinator !== '>') {
      return null;
    }
    const tokens = segment.term.type === 'CompoundSelector'
      ? segment.term.value
      : [segment.term];
    for (const token of tokens) {
      const isMixinName = token.text?.startsWith('.') === true || token.text?.startsWith('#') === true;
      if (!isSimpleSelector(token) || token.interp !== null || token.text === null || !isMixinName) {
        return null;
      }
      prefix.push({
        combinator: prefix.length === 0 ? ' ' : segment.combinator ?? ' ',
        selector: token.text
      });
    }
  }
  return prefix.length === 0 ? null : prefix;
}

function mixinCallFromSelectorBranch(
  branch: SelectorBranch,
  args: readonly MixinCallArgument[],
  important: boolean,
  span: SourceSpan
): MixinCall {
  const prefix = mixinPrefixFromSelectorBranch(branch);
  const final = prefix?.at(-1);
  // `prefix === null` already implies `final === undefined`, so the extra
  // conjunct is redundant at runtime; it narrows `prefix` for the spread below.
  if (prefix === null || final === undefined) {
    throw new SyntaxError('Less mixin calls require a class or id selector path.');
  }
  const call = mixinCall(final.selector, args);
  return withSourceSpan({
    ...call,
    ...(prefix.length > 1 ? { path: prefix.slice(0, -1) } : {}),
    ...(important ? { important: true } : {})
  }, span);
}

function mixinDefinitionNameFromSelectorBranch(branch: SelectorBranch): string {
  const prefix = mixinPrefixFromSelectorBranch(branch);
  if (prefix?.length !== 1) {
    throw new SyntaxError('Less mixin definitions require one class or id name.');
  }
  return prefix[0]!.selector;
}

function requiredTokenStart(rawChildren: readonly unknown[], value: string): number {
  const token = rawChildren.find((child): child is SpannedToken =>
    isSpannedToken(child) && child.value === value
  );
  if (token === undefined) {
    throw new TypeError(`Less grammar lost required ${JSON.stringify(value)} token provenance.`);
  }
  return token.span.start;
}

function hasRulesetTerminator(rawChildren: readonly unknown[]): boolean {
  const tail = rawChildren[rawChildren.length - 1];
  return isSpannedToken(tail) && tail.value === ';';
}

function isSelectorTerm(value: unknown): value is SelectorTerm {
  if (isSimpleToken(value)) {
    return true;
  }
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'CompoundSelector'
    && 'value' in value
    && Array.isArray(value.value);
}

function isSimpleSelector(value: unknown): value is SimpleSelector {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'SimpleSelector'
    && 'text' in value
    && 'interp' in value;
}

// Selector-function pseudos whose static argument is retained as a structured
// `SelectorList` (P0). Gated on the pseudo NAME (lowercased, colon-stripped),
// mirroring the CSS grammar. `:global`/`:local` are recognized by
// `staticSelectorPseudoName` but stay opaque text — they are absent here.
// `crossable` (a narrower set) is decided in core.
const STRUCTURED_PSEUDOS = new Set(['is', 'where', 'not', 'has', 'matches']);

function isSimpleToken(value: unknown): value is SimpleToken {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && (value.type === 'SimpleSelector' || value.type === 'PseudoSelector');
}

const selectorTermFromTokens = (tokens: readonly SimpleToken[]): SelectorTerm =>
  selectorTermOf([tokens[0]!, ...tokens.slice(1)]);

function pseudoNameFromHead(head: string): string {
  return head.slice(0, 2) === '::'
    ? head.slice(2)
    : head.slice(0, 1) === ':'
      ? head.slice(1)
      : head;
}

function staticSelectorPseudoFrom(head: string, arg: unknown): SimpleToken {
  if (isSelectorList(arg) && STRUCTURED_PSEUDOS.has(pseudoNameFromHead(head).toLowerCase())) {
    return pseudoSelector(head, arg);
  }
  return simpleSelector(`${head}(${requireSelectorList(arg).selectors.map(selectorBranchCanonical).join(',')})`);
}

function staticNonSelectorPseudoFrom(head: string, arg: string | null): SimpleSelector {
  return arg === null
    ? simpleSelector(head)
    : simpleSelector(`${head}(${arg})`);
}

function isRuleset(value: unknown): value is Ruleset {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Ruleset'
    && 'selector' in value
    && isSelectorList(value.selector)
    && 'rules' in value
    && Array.isArray(value.rules);
}

function isAtRuleBlock(value: unknown): value is AtRuleBlock {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'AtRuleBlock' && 'name' in value && typeof value.name === 'string'
    && 'prelude' in value && 'rules' in value && Array.isArray(value.rules);
}

function isAtRuleStatement(value: unknown): value is AtRuleStatement {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'AtRuleStatement' && 'name' in value && typeof value.name === 'string'
    && 'prelude' in value;
}

function isMixinDefinition(value: unknown): value is MixinDefinition {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'MixinDefinition' && 'name' in value && typeof value.name === 'string'
    && 'params' in value && Array.isArray(value.params) && 'rules' in value && Array.isArray(value.rules);
}

function isMixinCall(value: unknown): value is MixinCall {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'MixinCall' && 'name' in value && typeof value.name === 'string'
    && 'args' in value && Array.isArray(value.args) && 'path' in value && Array.isArray(value.path)
    && 'important' in value && typeof value.important === 'boolean';
}

function isReferenceCall(value: unknown): value is Reference {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'Reference' && 'base' in value && isVarRef(value.base)
    && 'steps' in value && Array.isArray(value.steps)
    && value.steps.length === 1 && value.steps[0]?.type === 'Call';
}

function isParam(value: unknown): value is Param {
  return typeof value === 'object' && value !== null && !('type' in value)
    && ('name' in value || 'pattern' in value || 'rest' in value);
}

function isAttributeNameFact(value: unknown): value is AttributeNameFact {
  return typeof value === 'object' && value !== null
    && 'namespace' in value && typeof value.namespace === 'string'
    && 'name' in value && typeof value.name === 'string';
}

function isExtendInstruction(value: unknown): value is ExtendInstruction {
  return typeof value === 'object' && value !== null
    && 'target' in value && isSelectorList(value.target)
    && 'partial' in value && typeof value.partial === 'boolean';
}

function isExtendTargetFact(value: unknown): value is ExtendTargetFact {
  return typeof value === 'object' && value !== null
    && 'target' in value && isSelectorList(value.target)
    && 'partial' in value && typeof value.partial === 'boolean';
}

function isBodyExtendFact(value: unknown): value is BodyExtendFact {
  return typeof value === 'object' && value !== null
    && 'bodyExtensions' in value && Array.isArray(value.bodyExtensions)
    && value.bodyExtensions.every(isExtendInstruction);
}

function isSelectorBranchFact(value: unknown): value is SelectorBranchFact {
  return typeof value === 'object' && value !== null
    && 'selector' in value && isSelectorBranch(value.selector)
    && 'extensions' in value && Array.isArray(value.extensions)
    && value.extensions.every(isExtendInstruction);
}

function isSelectorListWithExtendsFact(value: unknown): value is SelectorListWithExtendsFact {
  return typeof value === 'object' && value !== null
    && 'selector' in value && isSelectorList(value.selector)
    && 'extensions' in value && Array.isArray(value.extensions)
    && value.extensions.every(isExtendInstruction);
}

function isMixinDefinitionFact(value: unknown): value is MixinDefinitionFact {
  return typeof value === 'object' && value !== null
    && 'params' in value && Array.isArray(value.params) && value.params.every(isParam)
    && 'rules' in value && Array.isArray(value.rules) && value.rules.every(isStatement);
}

function isMixinCallFact(value: unknown): value is MixinCallFact {
  return typeof value === 'object' && value !== null
    && 'args' in value && Array.isArray(value.args) && value.args.every(isMixinCallArgument)
    && 'important' in value && typeof value.important === 'boolean';
}

function isBareMixinCallFact(value: unknown): value is BareMixinCallFact {
  return typeof value === 'object' && value !== null
    && 'important' in value && typeof value.important === 'boolean';
}

function isRulesetTailFact(value: unknown): value is RulesetTailFact {
  return typeof value === 'object' && value !== null
    && 'firstExtensions' in value && Array.isArray(value.firstExtensions) && value.firstExtensions.every(isExtendTargetFact)
    && 'branches' in value && Array.isArray(value.branches) && value.branches.every(isSelectorBranchFact)
    && 'rules' in value && Array.isArray(value.rules) && value.rules.every(isStatement)
    && 'extensions' in value && Array.isArray(value.extensions) && value.extensions.every(isExtendInstruction);
}

function requireSelectorListWithExtendsFact(value: unknown): SelectorListWithExtendsFact {
  if (!isSelectorListWithExtendsFact(value)) {
    throw new TypeError('Less grammar produced a ruleset selector without selector facts.');
  }
  return value;
}

function isMixinPathTail(value: unknown): value is MixinPathSegmentFact {
  return typeof value === 'object' && value !== null && 'combinator' in value
    && (value.combinator === ' ' || value.combinator === '>') && 'selector' in value && typeof value.selector === 'string';
}

function isMixinCallArgument(value: unknown): value is MixinCallArgument {
  /* `name` is ALWAYS present — `undefined` is what positional means — so its
   * absence is a reduced-shape defect, not a positional argument. */
  return typeof value === 'object' && value !== null && 'value' in value && (isValueSlotValue(value.value) || isMixinCall(value.value))
    && 'name' in value && (value.name === undefined || typeof value.name === 'string');
}

function isLessEachCallback(value: unknown): value is LessEachCallback {
  return typeof value === 'object' && value !== null
    && 'binding' in value && isForBinding(value.binding)
    && 'rules' in value && Array.isArray(value.rules) && value.rules.every(isStatement);
}

function mixinArgumentsFromChildren(children: readonly unknown[]): MixinCallArgument[] {
  return children.flatMap(child => Array.isArray(child)
    ? child.filter(isMixinCallArgument)
    : isMixinCallArgument(child) ? [child] : []);
}

function mixinParamsFromInterior(interior: MixinInteriorFact): Param[] {
  return interior.items.map((item) => {
    if (item.kind === 'anonymous-rest') {
      return { rest: true };
    }
    if (item.kind === 'binding') {
      if (item.rest) {
        return { name: item.reference.name, rest: true };
      }
      if (item.default === undefined) {
        return { name: item.reference.name };
      }
      if (!isValueSlotValue(item.default)) {
        throw new SyntaxError('Less mixin parameter defaults must be values.');
      }
      return { name: item.reference.name, default: item.default };
    }
    if (!isValueSlotValue(item.value)) {
      throw new SyntaxError('Less mixin pattern parameters must be values.');
    }
    return { pattern: item.value };
  });
}

function mixinCallArgumentFromInterior(item: MixinInteriorItem): MixinCallArgument {
  if (item.kind === 'anonymous-rest') {
    throw new SyntaxError('Less mixin calls cannot use an anonymous rest argument.');
  }
  if (item.kind === 'binding') {
    if (item.rest) {
      return callArg(item.reference, undefined, true);
    }
    return item.default === undefined
      ? callArg(item.reference)
      : callArg(item.default, item.reference.name);
  }
  return callArg(item.value);
}

function mixinCallArgsFromInterior(interior: MixinInteriorFact): MixinCallArgument[] {
  if (!interior.separators.includes(';')) {
    return interior.items.map(mixinCallArgumentFromInterior);
  }

  const groups: MixinInteriorItem[][] = [[]];
  for (let index = 0; index < interior.items.length; index++) {
    groups.at(-1)!.push(interior.items[index]!);
    if (interior.separators[index] === ';') {
      groups.push([]);
    }
  }
  if (groups.at(-1)?.length === 0) {
    groups.pop();
  }

  return groups.map((group) => {
    const args = group.map(mixinCallArgumentFromInterior);
    if (args.length === 1) {
      return args[0]!;
    }
    if (args.some(argument => argument.name !== undefined || argument.spread)) {
      throw new SyntaxError('Less comma-list mixin argument groups cannot use named or spread arguments.');
    }
    return callArg(list(args.map(argument => requireValueSlot(argument.value)), ','));
  });
}

/**
 * The LESS condition lowering (§4.4.2): `when (@x)` means `$if($x == true)`.
 *
 * Less's bare condition asks "is this literally the boolean `true`" — `0`,
 * `"a"`, `red` and `"true"` are all false — which is a DIFFERENT question from
 * `.jess`'s `$if($x)` (falsy iff `false` / `null` / `""` / `()`, §4.4). So the
 * dialect states its own meaning in plain `.jess` here rather than sharing the
 * truth node, which is what makes `.less` -> `.jess` -> `.css` reachable.
 *
 * `==` is load-bearing: with the loose `=` a `"true"` string would ground
 * against `true` and come out TRUE, which Less says it is not.
 */
function lessTruth(value: ValueSlot): MixinGuard {
  return { g: 'cmp', op: '==', left: value, right: keyword('true') };
}

/** {@link lessTruth} in `when` position — the same lowering, as a MATCH test
 *  (§4.2a), so a `when` tree contains no value-position assertion. `==` never
 *  raises, so this changes no answer; it keeps the invariant readable. */
function lessGuardTruth(value: ValueSlot): MixinGuard {
  return { g: 'match', op: '==', left: value, right: keyword('true') };
}

function isMixinGuard(value: unknown): value is MixinGuard {
  return typeof value === 'object' && value !== null && 'g' in value
    && (value.g === 'cmp' || value.g === 'match' || value.g === 'and' || value.g === 'or' || value.g === 'not'
      || value.g === 'truth' || value.g === 'call' || value.g === 'default');
}

function isDefaultGuardCall(value: FunctionCall): boolean {
  return value.type === 'FunctionCall' && value.name === 'default' && value.args.length === 0;
}

function isFunctionConditionFact(value: unknown): value is FunctionConditionFact {
  return typeof value === 'object' && value !== null && 'guard' in value && 'src' in value
    && typeof value.src === 'string' && isMixinGuard(value.guard)
    && 'grouped' in value && typeof value.grouped === 'boolean'
    && 'hasComparison' in value && typeof value.hasComparison === 'boolean';
}

function guardOperatorText(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('value' in value) || typeof value.value !== 'string') {
    return null;
  }
  const operator = value.value.trim();
  // The guard comparison vocabulary, spelled here in TS because a reducer cannot
  // read a combinator's alternation. It must stay in step with
  // `mixinGuardOperator` / `functionConditionOperator` — and it must NOT
  // be unified with the CSS media-range operator (`g.QueryComparisonOperator`,
  // mediaqueries-4 §4 = `< <= = >= >`): `=~`, `=>` and `=<` are Less guard spellings
  // with no meaning in a media query, and merging the two would widen
  // `@media (width => 600px)` into acceptance.
  return ['>', '<', '>=', '<=', '=>', '=<', '=', '=~'].includes(operator) ? operator : null;
}

function foldMixinGuards(kind: 'and' | 'or', children: readonly unknown[]): MixinGuard {
  const guards = children.filter(isMixinGuard);
  const head = guards[0];
  if (head === undefined) {
    throw new TypeError('Less grammar produced an empty logical guard.');
  }
  let result = head;
  for (let index = 1; index < guards.length; index++) {
    result = { g: kind, left: result, right: guards[index]! };
  }
  return result;
}

function functionConditionSource(value: ValueSlot): string {
  if (Array.isArray(value)) {
    return value.map(part => functionConditionSource(part)).join(' ');
  }
  const node = requireValueNode(value);
  switch (node.type) {
    case 'Keyword': case 'Color': case 'Quoted': case 'Any': case 'Dimension': return node.src;
    case 'Lookup': return node.kind === 'var'
      ? `@${typeof node.name === 'string' ? node.name : functionConditionSource(node.name)}`
      : node.raw;
    case 'FunctionCall': return `${node.name}(${node.args.map(argument => `${argument.name === undefined ? '' : `@${argument.name}: `}${functionConditionSource(argument.value)}`).join(', ')})`;
    case 'Operation': return `${functionConditionSource(node.left)} ${node.operator} ${functionConditionSource(node.right)}`;
    case 'Block': return `${node.delimiter === 'square' ? '[' : '('}${functionConditionSource(node.value)}${node.delimiter === 'square' ? ']' : ')'}`;
    /*
     * A nested `boolean(…)`/`if(…)` already lowered to a computation boundary
     * (`Expression`). It owns no delimiters of its own, so its replay source is
     * the enclosing group's — the same `(inner)` the boundary `Block` spelled
     * before the boundary flag became its own node kind.
     */
    case 'Expression': return `(${functionConditionSource(node.value)})`;
    case 'Sequence': return node.parts.map(functionConditionSource).join(' ');
    case 'Condition': return node.src;
    default: throw new TypeError(`Less function condition cannot preserve ${node.type}.`);
  }
}

function foldFunctionCondition(kind: 'and' | 'or', children: readonly unknown[]): FunctionConditionFact {
  const facts = children.filter(isFunctionConditionFact);
  const first = facts[0];
  if (first === undefined) {
    throw new TypeError('Less function condition lost its first term.');
  }
  let guard = first.guard;
  let src = first.src;
  if (facts.length > 1 && facts.some(fact => fact.hasComparison && !fact.grouped)) {
    throw new TypeError('Less function condition comparisons must be grouped before logical operators.');
  }
  let hasComparison = first.hasComparison;
  for (const right of facts.slice(1)) {
    guard = { g: kind, left: guard, right: right.guard };
    src += ` ${kind} ${right.src}`;
    hasComparison ||= right.hasComparison;
  }
  return { guard, src, grouped: false, hasComparison };
}

function isStatement(value: unknown): value is Statement {
  // Every statement guard gates on a distinct `type`, so dispatch once on the
  // discriminant instead of trying up to thirteen guards sequentially (each of
  // which re-runs the object guard). Behaviour is identical.
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  switch (value.type) {
    case 'StyleImport':
      return isStyleImport(value);
    case 'VariableDeclaration':
      return isVarDeclaration(value);
    case 'Declaration':
      return isDeclaration(value);
    case 'Ruleset':
      return isRuleset(value);
    case 'AtRuleBlock':
      return isAtRuleBlock(value);
    case 'OpaqueAtRuleBlock':
      return typeof value === 'object' && value !== null && 'type' in value && value.type === 'OpaqueAtRuleBlock';
    case 'AtRuleStatement':
      return isAtRuleStatement(value);
    case 'Plugin':
      return true;
    case 'MixinDefinition':
      return isMixinDefinition(value);
    case 'MixinCall':
      return isMixinCall(value);
    case 'Reference':
      return isReferenceCall(value);
    case 'For':
      return isFor(value);
    case 'FunctionCall':
      return isFunctionCall(value);
    default:
      return false;
  }
}

function requireStatementArray(value: unknown): Statement[] {
  if (!Array.isArray(value) || !value.every(isStatement)) {
    throw new TypeError('Less grammar produced an invalid statement list.');
  }
  return value;
}

function isFunctionCall(value: unknown): value is FunctionCall {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'FunctionCall';
}

function isFor(value: unknown): value is For {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'For'
    && 'iterable' in value
    && 'rules' in value
    && Array.isArray(value.rules)
    && 'binding' in value;
}

function requireRulesetBody(children: readonly unknown[]): Statement[] {
  const rules: Statement[] = [];
  for (const child of children) {
    if (!isStatement(child)) {
      throw new TypeError('Less grammar produced a non-ruleset-body child.');
    }
    rules.push(child);
  }
  return rules;
}

/** Retain every callback body fact except an authored empty statement. */
function requireCallbackStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (isTerminalText(child, ';')) {
      continue;
    }
    if (!isStatement(child)) {
      throw new TypeError('Less grammar produced a non-statement callback-body child.');
    }
    statements.push(child);
  }
  return statements;
}

/** Read a grammar-owned `{ … }` body without silently dropping non-body facts. */
function requireValueBlockBody(children: readonly unknown[]): Statement[] {
  const bodyStart = children.findIndex(child => isTerminalText(child, '{'));
  const bodyEnd = children.findIndex((child, index) => index > bodyStart && isTerminalText(child, '}'));
  if (bodyStart < 0 || bodyEnd < 0) {
    throw new TypeError('Less grammar produced a detached ruleset without a delimited body.');
  }
  for (const child of children.slice(bodyEnd + 1)) {
    if (!isTerminalText(child, ';')) {
      throw new TypeError('Less grammar produced an invalid detached-ruleset suffix.');
    }
  }
  return requireCallbackStatements(children.slice(bodyStart + 1, bodyEnd));
}

/** Fold a grammar-produced flat binary chain left-to-right.  Precedence is
 * represented by which production supplies each operand; no source text is
 * recovered or re-parsed here.  Each folded pair records whether Less's
 * configured `math:` policy computes it with no enclosing math context, so the
 * evaluator never reads that policy from ambient config (§12.6b). */
function foldOperation(
  children: readonly unknown[],
  _fields: FieldMap | undefined,
  _span: Span,
  rawChildren: readonly unknown[],
  _triviaLog: readonly number[],
  state: unknown
): ValueNode {
  const first = children.find(isValueNode);
  if (first === undefined) {
    throw new TypeError('Less arithmetic grammar produced no operand.');
  }
  const firstIndex = children.indexOf(first);
  const firstRaw = rawChildren[firstIndex];
  // In AST mode Parseman supplies the original spanned children here. That
  // gives each folded operation its authored range without retaining one span
  // per standalone dimension. A synthetic child can still contribute an
  // existing provenance fact when it has one.
  const firstSpan = isSpannedToken(firstRaw) ? firstRaw.span : sourceSpanOf(first);
  let result = first;
  const start = firstSpan?.start;
  for (let index = children.indexOf(first) + 1; index < children.length; index += 2) {
    const operatorToken = children[index];
    const right = children[index + 1];
    if (operatorToken === undefined || !isValueNode(right)) {
      throw new TypeError('Less arithmetic grammar lost an operator operand.');
    }
    const rightRaw = rawChildren[index + 1];
    const rightSpan = isSpannedToken(rightRaw) ? rightRaw.span : sourceSpanOf(right);
    const operator = requireTerminalText(operatorToken).trim();
    const folded = operation(operator, result, right, false, lessMathOutsideParens(state, operator));
    result = start === undefined || rightSpan === undefined
      ? folded
      : withSourceSpan(folded, { start, end: rightSpan.end });
  }
  return result;
}

export {
  LESS_NODE_TRIVIA_STRIDE,
  STRUCTURED_PSEUDOS,
  appendEnclosedLiteral,
  appendInterpolationLiteral,
  argumentFunctionFromChildren,
  branchSegments,
  callArgumentSource,
  callWithLayout,
  combinatorTailReducer,
  commaListWithTriviaFromChildren,
  complexSegmentsFrom,
  customPartsFromChildren,
  customValueFromParts,
  enclosedInterpolationFromChildren,
  foldFunctionCondition,
  foldMixinGuards,
  foldOperation,
  functionCallFromChildren,
  functionConditionSource,
  functionNameFromOpener,
  functionSeparatorsFromFields,
  guardOperatorText,
  hasChildren,
  hasField,
  hasGrammarType,
  hasRulesetTerminator,
  interpolationFactFromChildren,
  interpolationPartsFrom,
  isAny,
  isAtRuleBlock,
  isAtRuleStatement,
  isAttributeNameFact,
  isBareMixinCallFact,
  isBodyExtendFact,
  isComplex,
  isComplexTailFact,
  isDeclaration,
  isDefaultGuardCall,
  isExtendInstruction,
  isExtendTargetFact,
  isFor,
  isFunctionCall,
  isFunctionConditionFact,
  isGluedValueBoundary,
  isInterp,
  isInterpolationAccessorFact,
  isInterpolationFact,
  isLessCallArg,
  isLessEachCallback,
  isMixinCall,
  isMixinCallArgument,
  isMixinCallFact,
  isMixinDefinition,
  isMixinDefinitionFact,
  isMixinGuard,
  isMixinInteriorItem,
  isMixinPathTail,
  isMixinReferenceBaseFact,
  isParam,
  isPropRef,
  isQuoted,
  isReference,
  isReferenceCall,
  isReferenceTailFact,
  isRelative,
  isRuleset,
  isRulesetTailFact,
  isSelectorBranch,
  isSelectorBranchFact,
  isSelectorList,
  isSelectorListWithExtendsFact,
  isSelectorTerm,
  isSequence,
  isSimpleSelector,
  isSimpleToken,
  isSlashBoundaryFact,
  isStatement,
  isStyleImport,
  isTerminalText,
  isUnsupportedVariableNameFact,
  isUrl,
  isValueNode,
  isValueSlotValue,
  isVarDeclaration,
  isVarIndirect,
  isVarRef,
  keywordOrValue,
  layoutFromTriviaBoundaries,
  lessConditionGuard,
  lessGuardTruth,
  lessMathOutsideParens,
  lessTriviaEntryCount,
  lessTriviaEntryEnd,
  lessTriviaEntryHasLineBreak,
  lessTriviaEntryInsertIndex,
  lessTriviaEntryKind,
  lessTriviaEntryStart,
  lessTriviaEntryText,
  lessTriviaKindLabels,
  lessTruth,
  lowerLogicalCall,
  lowerLogicalCallStatement,
  mixinArgumentSource,
  mixinArgumentsFromChildren,
  mixinCallArgsFromInterior,
  mixinCallArgumentFromInterior,
  mixinCallFromSelectorBranch,
  mixinDefinitionNameFromSelectorBranch,
  mixinParamsFromInterior,
  mixinPrefixFromSelectorBranch,
  pseudoNameFromHead,
  queryClauseReducer,
  queryComparisonOperators,
  rawLeafText,
  referenceWithBracketLookups,
  referenceWithTails,
  requireCallbackStatements,
  requireCombinator,
  requireField,
  requireFields,
  requireInterpolationAccessorFact,
  requireInterpolationFact,
  requireKeyword,
  requireMixinCallArgumentValue,
  requireMixinInteriorItem,
  requireMixinReferenceBaseFact,
  requireReferenceTailFact,
  requireRulesetBody,
  requireSelectorList,
  requireSelectorListWithExtendsFact,
  requireStatementArray,
  requireString,
  requireSupportedVariableName,
  requireTerminalText,
  requireToken,
  requireValueBlockBody,
  requireValueNode,
  requireValueSlot,
  requiredTokenStart,
  selectorBranchesFrom,
  selectorTermFromTokens,
  separatorRawIndexes,
  separatorWithSurroundingTrivia,
  separatorsFromFields,
  sourceFromState,
  spacedFromValueChildren,
  staticNonSelectorPseudoFrom,
  staticSelectorPseudoFrom,
  staticText,
  staticTextWithTriviaGaps,
  triviaTextAtInsertIndex,
  unsupportedVariableNameFrom,
  valuePieceReducerWithTrivia,
  valueSlot,
  variableNameTerminalText,
  variableNameText,
  variableValueSlot,
  withoutBareMath
};

export type {
  AttributeMatchFact,
  AttributeNameFact,
  BareMixinCallFact,
  BodyExtendFact,
  CallValue,
  ChildContainer,
  ComplexTailFact,
  CustomValuePart,
  EnclosedNameFact,
  ExtendTargetFact,
  FunctionConditionFact,
  IndirectRef,
  InterpolationAccessorFact,
  InterpolationFact,
  LessCallArg,
  LessEachCallback,
  MixinCallArgument,
  MixinCallFact,
  MixinDefinitionFact,
  MixinGuard,
  MixinInteriorFact,
  MixinInteriorItem,
  MixinPathSegmentFact,
  MixinPrefixSegment,
  MixinReferenceBaseFact,
  MixinStatementFact,
  ReferenceTailFact,
  RulesetTailFact,
  SelectorBranchFact,
  SelectorListWithExtendsFact,
  SlashBoundaryFact,
  UnsupportedVariableNameFact,
  VarRef
};
