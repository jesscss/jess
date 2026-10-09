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
import { NO_SPAN, any, block, callArg, generalEnclosedGroup, quoted, condition, inParens, delimiterClose, delimiterOpen, sepGlue, withFirstBranchCondition, expression, funcCall, ifNode, ifValue, interpolation, isForBinding, isSpannedToken, isToken, keyword, list, mixinCall, operation, propertyReference, pseudoSelector, reference, selectorBranchCanonical, selectorTermOf, selist, semanticGapText, simpleSelector, sourceEndOf, sourceSpanOf, sourceStartOf, spaced, triviaTextAt, variableReference, withFunctionScope, withSourceSpan, withValueLayout } from '@jesscss/core/ast';
import type { AnonymousMixin, Any, AtRuleBlock, AtRuleStatement, Block, CallArg, Combinator as SelectorCombinator, ComplexSelector, Declaration, Expression, ExtendInstruction, For, ForBinding, FunctionCall, If, IfBranch, IfValueBranch, Interpolation, Keyword, Lookup, MixinCall, MixinDefinition, Operation, Param, Quoted, Reference, ReferenceStep, Ruleset, SelectorBranch, SelectorList, SelectorTerm, SimpleSelector, SimpleToken, SourceSpan, SpannedToken, Statement, StyleImport, Token, Url, ValueNode, ValueSlot, VariableDeclaration } from '@jesscss/core/ast';
import { functionScopeOf, requireLessParseState } from './parse-state.js';
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
type LessEachCallback = {
  readonly binding: ForBinding;
  readonly rules: Statement[];
  readonly extensions: readonly ExtendInstruction[];
  readonly bodySpan: SourceSpan | undefined;
};
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
type ExtendTargetFact = { readonly target: SelectorList; readonly partial: boolean };
type BodyExtendFact = { readonly bodyExtensions: readonly ExtendInstruction[] };
type SelectorBranchFact = { readonly selector: SelectorBranch; readonly extensions: readonly ExtendInstruction[] };
type SelectorListWithExtendsFact = {
  readonly selector: SelectorList;
  readonly extensions: readonly ExtendInstruction[];
};
type MixinDefinitionFact = {
  readonly params: readonly Param[];
  readonly guard?: MixinGuard;
  readonly rules: readonly Statement[];

  /** Body-form `&:extend()`s the definition carries for its call sites (ledger X16). */
  readonly extensions: readonly ExtendInstruction[];
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

  /**
   * What an enclosing group folds when IT is read as an operand: a bare
   * condition's operand still unfolded, or, on a group of one value, that
   * group's math group (see {@link LessGuardOperand}).
   */
  readonly raw?: ValueNode | LessMathRun;
};
type UnsupportedVariableNameFact = { readonly unsupportedVariableName: string };
type VariableNameFact = {
  readonly variableName: string;
  readonly variableNameSource: string;
};
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

function isVariableNameFact(value: unknown): value is VariableNameFact {
  return typeof value === 'object'
    && value !== null
    && 'variableName' in value
    && typeof value.variableName === 'string'
    && 'variableNameSource' in value
    && typeof value.variableNameSource === 'string';
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
  if (isVariableNameFact(value)) {
    return value.variableNameSource;
  }
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
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return variableNameTerminalText(value.value);
  }
  if (hasChildren(value)) {
    return variableNameTerminalText(value.rules);
  }
  return undefined;
}

function supportedVariableNameFrom(value: unknown): string | undefined {
  if (isVariableNameFact(value)) {
    return value.variableName;
  }
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return supportedVariableNameFrom(value.value);
  }
  return undefined;
}

function unsupportedVariableNameFrom(value: unknown): string | undefined {
  if (isUnsupportedVariableNameFact(value)) {
    return value.unsupportedVariableName;
  }
  if (isLessTerminalText(value, '-')) {
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
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value !== null && 'variableNameSource' in value && typeof value.variableNameSource === 'string') {
    return value.variableNameSource;
  }
  return unsupportedVariableNameFrom(value) ?? variableNameTerminalText(value) ?? requireTerminalText(value);
}

function requireSupportedVariableName(value: unknown, start: number, end: number): string {
  if (typeof value === 'string') {
    return value;
  }
  const unsupported = unsupportedVariableNameFrom(value);
  if (unsupported !== undefined) {
    throw new LessUnsupportedVariableNameError(start, end, unsupported);
  }
  return supportedVariableNameFrom(value)
    ?? variableNameTerminalText(value)
    ?? requireTerminalText(value);
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

function isLessTerminalText(value: unknown, text: string): boolean {
  /*
   * A raw grammar terminal is a string or a `{ value }` token; an AST value
   * node also carries a string `value` (a `Quoted` body is the notable one), so
   * excluding anything with a `type` field keeps a quoted `"/"`/`"-"`/`"%"` from
   * being mistaken for the bare slash/sign/percent operator terminal.
   */
  return (typeof value === 'string' && value === text)
    || (typeof value === 'object' && value !== null && !('type' in value) && 'value' in value && value.value === text);
}

/** The text of a raw grammar terminal ({@link isLessTerminalText}), or `null` for anything else. */
function lessTerminalText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'object' && value !== null && !('type' in value) && 'value' in value && typeof value.value === 'string'
    ? value.value
    : null;
}

/**
 * A terminal spelling the lowercase keyword `word` in any ASCII case: `and`,
 * `or` and `not` are keywords wherever a Less condition is written, and a CSS
 * keyword is ASCII case-insensitive (CSS Values 4 §6.1).
 */
function isLessKeyword(value: unknown, word: string): boolean {
  const text = lessTerminalText(value);
  return text !== null && text.length === word.length && text.toLowerCase() === word;
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
    if (value.interp !== null) {
      throw new TypeError('Less grammar produced a non-static import fragment.');
    }
    return value.src;
  }
  // Parseman may retain a terminal capture as its token object when a
  // boundary is wrapped in `field(...)`.  It is still grammar-owned static
  // text, not a dynamic import fragment.
  if (typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'string') {
    return value.value;
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

/**
 * A generic at-rule prelude: its tokens with one space per gap, trimmed, as
 * bytes. A `@{…}` in it makes the prelude an interpolation over those bytes, as
 * `@{…}` is in every other Less prelude.
 */
function atRulePreludeFrom(children: readonly unknown[], triviaLog: readonly number[]): Any | Interpolation | null {
  if (!children.some(isInterpolationFact)) {
    const text = staticTextWithTriviaGaps(children, triviaLog).trim();
    return text === '' ? null : any(text);
  }
  const gapBefore = new Set<number>();
  for (let index = 0; index < lessTriviaEntryCount(triviaLog); index += 1) {
    gapBefore.add(lessTriviaEntryInsertIndex(triviaLog, index));
  }
  const parts: Interpolation['parts'] = [];
  for (let index = 0; index < children.length; index++) {
    if (gapBefore.has(index)) {
      appendInterpolationLiteral(parts, ' ');
    }
    const child = children[index];
    if (isInterpolationFact(child)) {
      parts.push({ ref: child.ref, unquote: true });
    } else {
      appendInterpolationLiteral(parts, staticText(child));
    }
  }
  const trimmed: Interpolation['parts'] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (!('lit' in part)) {
      trimmed.push(part);
      continue;
    }
    let lit = semanticGapText(part.lit);
    lit = index === 0 ? lit.trimStart() : lit;
    lit = index === parts.length - 1 ? lit.trimEnd() : lit;
    if (lit !== '') {
      trimmed.push({ lit });
    }
  }
  return interpolation(trimmed);
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
    && (isLessValueSlotValue(value.value) || isMixinCall(value.value));
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
    case 'Block': return `${node.escaped ? '~' : ''}${delimiterOpen(node.delimiter)}${mixinArgumentSource(node.value)}${delimiterClose(node.delimiter)}`;
    case 'Branch': return `${mixinArgumentSource(node.condition)}:${Array.isArray(node.value) && node.value.length === 0 ? '' : ` ${mixinArgumentSource(node.value)}`}`;
    case 'Operation': return `${mixinArgumentSource(node.left)} ${node.operator} ${mixinArgumentSource(node.right)}`;
    case 'Sequence': return node.parts.map(mixinArgumentSource).join(' ');
    case 'List': return node.value.map(mixinArgumentSource).join(sepGlue(node.sep));
    case 'Important': return `${mixinArgumentSource(node.value)} !important`;
    default: throw new TypeError(`Less mixin-reference raw source cannot represent ${node.type}.`);
  }
}

/**
 * Fold only already-reduced grammar facts into a public Reference.  In
 * particular, this never re-reads the source to discover chain structure.
 */
/*
 * The three steps of the one lookup/call chain, shared by the tails read after
 * a variable and the tails a delimiter dispatch has already routed: a `[key]`
 * lookup, a `.name` member lookup, an `(args)` call.
 */
function referenceBracketTailFact(children: readonly unknown[]): ReferenceTailFact {
  const accessor = requireInterpolationAccessorFact(children[0]);
  return { step: { type: 'LookupStep', kind: accessor.keyKind, name: accessor.key }, src: `[${accessor.src}]` };
}

function referenceDotTailFact(children: readonly unknown[]): ReferenceTailFact {
  const name = requireToken(children[1]).value;
  return { step: { type: 'LookupStep', kind: 'member', name }, src: `.${name}` };
}

function referenceCallTailFact(children: readonly unknown[]): ReferenceTailFact {
  const args = mixinArgumentsFromChildren(children);
  return { step: { type: 'Call', args }, src: `(${args.map(callArgumentSource).join(', ')})` };
}

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

/**
 * One Less string — `"…"`, `'…'`, `~"…"`, `~'…'` — whether or not it
 * interpolates: the opener at `children[0]`, the closing quote last, and the
 * content between. `src`/`value` are the authored bytes (an `@{…}` hole is its
 * own authored spelling); an interpolating string also carries its content as
 * a template, the delimiters left on the node rather than in the parts.
 */
function quotedFromChildren(children: readonly unknown[], escaped: boolean): Quoted {
  const opener = requireToken(children[0]).value;
  const quote = requireToken(children[children.length - 1]).value;
  const content = children.slice(1, -1);
  let value = '';
  let interpolates = false;
  for (const child of content) {
    if (isInterpolationFact(child)) {
      value += child.src;
      interpolates = true;
    } else {
      value += requireToken(child).value;
    }
  }
  return quoted(
    `${opener}${value}${quote}`,
    value,
    quote,
    escaped,
    interpolates ? interpolation(interpolationPartsFrom(content, true)) : null
  );
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

const LESS_NODE_TRIVIA_STRIDE = 4;

function lessTriviaEntryCount(triviaLog: readonly number[]): number {
  return Math.trunc(triviaLog.length / LESS_NODE_TRIVIA_STRIDE);
}

function lessTriviaEntryInsertIndex(triviaLog: readonly number[], index: number): number {
  return triviaLog[index * LESS_NODE_TRIVIA_STRIDE + 2] ?? 0;
}

/** The layout text of the trivia before raw child `insertIndex` ({@link triviaTextAt}). */
function triviaTextAtInsertIndex(
  triviaLog: readonly number[],
  state: unknown,
  insertIndex: number
): string {
  const source = sourceFromState(state);
  return source === undefined ? '' : triviaTextAt(triviaLog, source, insertIndex);
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

/**
 * Whether a typed import media list holds a `supports()` or `layer()` term. CSS
 * places those conditions before the list (`[ layer ]? [ supports() ]?
 * <media-query-list>`), so one written after it is a misplaced condition, not a
 * query a compile-time import could wrap in `@media`. Reads the list's own terms
 * — clause, then term — never its bytes.
 */
function queryListHasImportCondition(value: ValueNode): boolean {
  const clauses = value.type === 'List' ? value.value : [value];
  for (const clause of clauses) {
    if (!('type' in clause)) {
      continue;
    }
    const terms = clause.type === 'Sequence' ? clause.parts : [clause];
    for (const term of terms) {
      if (term.type === 'FunctionCall') {
        const name = term.name.toLowerCase();
        if (name === 'supports' || name === 'layer') {
          return true;
        }
      }
    }
  }
  return false;
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
    .filter(child => isValueNode(child) || isLessTerminalText(child, '-') || isLessTerminalText(child, '%'))
    .map(child => isLessTerminalText(child, '-') || isLessTerminalText(child, '%')
      ? keyword(requireTerminalText(child))
      : requireValueNode(child));
  if (values.length === 1) {
    return values[0]!;
  }

  const separators: string[] = [];
  let previousValue = -1;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!(isValueNode(child) || isLessTerminalText(child, '-') || isLessTerminalText(child, '%'))) {
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

function lessQueryComparisonOperators(children: readonly unknown[]): string[] {
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
function customValueFromParts(parts: readonly CustomValuePart[], triviaLog: readonly number[] = []): ValueNode {
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
  /*
   * Every gap before a value takes the whitespace that opens it (the declaration
   * gap after `:`, a `var()` fallback's comma), so only a value that opens with a
   * block comment (`--x: /* c *&#47; red`) has a first part that opens with edge
   * whitespace. The comment is trivia, replayed from the value's span; the
   * comment-free value drops that edge whitespace (css-syntax-3 §5.5.6). Any
   * other first part keeps its opening code point, U+00A0 included (§4.2).
   *
   * ponytail: `trimStart()` also drops a non-CSS space (U+00A0, U+FEFF) written
   * directly after an opening comment; exact §4.2 whitespace there needs the
   * grammar to stop the value's first part after its edge whitespace.
   */
  const [first, ...rest] = parts;
  const opensWithComment = lessTriviaEntryCount(triviaLog) > 0 && lessTriviaEntryInsertIndex(triviaLog, 0) === 0;
  if (typeof first === 'string' && opensWithComment) {
    const trimmed = first.trimStart();
    if (trimmed !== '') {
      append(trimmed);
    }
    append(rest);
  } else {
    append(parts);
  }
  if (hasInterpolation) {
    return interpolation(interpolationParts);
  }
  // A custom-property value is verbatim `<declaration-value>` text that is never
  // evaluated (css-syntax-3 §7.2), so even a wholly-quoted value stays `Any`
  // rather than being re-typed as a `Quoted` string.
  return any(interpolationParts.map(part => 'lit' in part ? part.lit : '').join(''));
}

/**
 * A `var()` fallback's trailing whitespace belongs to the call's `)` boundary,
 * not to the fallback (css-variables-1 §3 trims a `<declaration-value>`'s edge
 * whitespace). Comments are kept.
 *
 * ponytail: `trimEnd()` also drops a trailing non-CSS space (U+00A0, U+FEFF)
 * before `)`; exact css-syntax-3 §4.2 whitespace needs the grammar to stop the
 * fallback before its edge whitespace, as `CustomValue` does at its leading edge.
 */
function trimCustomValueEnd(value: ValueNode): ValueNode {
  if (value.type === 'Any') {
    const trimmed = value.src.trimEnd();
    return trimmed === value.src ? value : any(trimmed);
  }
  if (value.type === 'Interpolation') {
    const last = value.parts.at(-1);
    if (last !== undefined && 'lit' in last) {
      const trimmed = last.lit.trimEnd();
      if (trimmed !== last.lit) {
        const parts = value.parts.slice(0, -1);
        if (trimmed !== '') {
          parts.push({ lit: trimmed });
        }
        return interpolation(parts);
      }
    }
  }
  return value;
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
    case 'Branch':
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

function lessValueSlot(value: ValueSlot): ValueSlot {
  // Ordinary adjacent terms are raw recursive ValueSlot arrays.
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
  return lessValueSlot(Array.isArray(value) ? value as ValueSlot : requireValueNode(value));
}

function isLessValueSlotValue(value: unknown): value is ValueSlot {
  return Array.isArray(value) ? value.every(isLessValueSlotValue) : isValueNode(value);
}

/** A reduced {@link LessCallArg}: an argument that carried a `@name:` keyword,
 *  as opposed to the bare value slot a positional argument reduces to. */
function isLessCallArg(value: unknown): value is LessCallArg {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'value' in value
    && 'name' in value
    && isLessValueSlotValue(value.value);
}

function callWithLayout(
  name: string,
  args: Array<ValueSlot | LessCallArg>,
  separators: string[],
  hasTrailingSeparator: boolean,
  span: SourceSpan,
  state: unknown
): FunctionCall {
  const call = withFunctionScope(funcCall(name, args), functionScopeOf(state));
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
 * or `and`/`or`) already IS a guard tree, also inside the paren group a value
 * position reads `(a > b)` as. Anything else is a bare operand, and
 * Less's condition asks "is this literally the boolean `true`" — the same
 * {@link lessTruth} rule `when (@x)` uses (§4.4.2). `"a"`, `red`, `0` and even
 * the STRING `"true"` are all false under it.
 */
function lessConditionGuard(arg: ValueSlot): MixinGuard {
  const grouped = !Array.isArray(arg) && isValueNode(arg) && arg.type === 'Block' && arg.delimiter === 'paren';
  const inner = grouped ? arg.value : arg;
  if (!Array.isArray(inner) && isValueNode(inner) && inner.type === 'Condition') {
    return grouped ? inParens(inner.guard) : inner.guard;
  }
  return lessTruth(arg);
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
 *
 * The lowered `if()` / `boolean()` keeps the call it came from (ledger P36): a
 * document whose built-ins are not ambient (Less modern mode) evaluates that
 * call like any other unimported call instead of the lowering.
 */
function lowerLogicalCall(call: FunctionCall): ValueNode {
  const args = call.args;
  const first = args[0]?.value;
  if (first === undefined) {
    return call;
  }
  const boundaryCondition = (guard: MixinGuard, asCall: FunctionCall | null = null): Expression =>
    expression(condition(guard, functionConditionSource(call)), asCall);

  /* `and`/`or` are n-ary in Less and fold LEFT, so `and(a, b, c)` is
   * `(a and b) and c` — the same order the guard evaluator short-circuits in. */
  const fold = (kind: 'and' | 'or'): MixinGuard =>
    args.slice(1).reduce<MixinGuard>(
      (left, arg) => ({ g: kind, left, right: lessConditionGuard(arg.value), word: call.name, parens: 0 }),
      lessConditionGuard(first)
    );
  switch (call.name.toLowerCase()) {
    case 'boolean':
      return args.length === 1 ? boundaryCondition(lessConditionGuard(first), call) : call;
    case 'not':
      return args.length === 1 ? boundaryCondition({ g: 'not', inner: lessConditionGuard(first), word: call.name, parens: 0 }) : call;
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
      return ifValue(otherwise === undefined ? [taken] : [taken, { guard: null, value: otherwise }], call);
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
  return ifNode(
    otherwise === undefined ? [taken] : [taken, { guard: null, rules: otherwise.rules }],
    call
  );
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
    if (isLessCallArg(child) || isLessValueSlotValue(child)) {
      args.push(child);
    }
  }
  /* [P38] `[condition, BranchRest]` is one branch-list argument. */
  const [condition, rest] = args;
  if (args.length === 2 && condition !== undefined && rest !== undefined && !isLessCallArg(rest)) {
    const branches = withFirstBranchCondition(isLessCallArg(condition) ? [] : condition, rest);
    if (branches !== undefined) {
      if (isLessCallArg(condition)) {
        throw new SyntaxError('A keyword argument cannot be a branch condition.');
      }
      return callWithLayout(name, [branches], [], false, span, state);
    }
  }
  const separators = functionSeparatorsFromFields(fields, rawChildren, triviaLog, state);
  return lowerLogicalCall(callWithLayout(name, args, separators, hasField(fields, 'trailingSeparator'), span, state));
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
  span: SourceSpan,
  _rawChildren: readonly unknown[],
  _triviaLog: readonly number[],
  state: unknown
): FunctionCall {
  const name = functionNameFromOpener(children[0]);
  const args = children.slice(1, -1).filter(
    (child): child is ValueSlot | LessCallArg => isLessCallArg(child) || isLessValueSlotValue(child)
  );
  return callWithLayout(name, args, separatorsFromFields(fields), hasField(fields, 'trailingSeparator'), span, state);
}

function requireValueSlot(value: unknown): ValueSlot {
  return Array.isArray(value) ? value as ValueSlot : lessValueSlot(requireValueNode(value));
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
  if (!isLessValueSlotValue(value) && !isMixinCall(value)) {
    throw new TypeError('Less grammar produced an invalid mixin-call argument.');
  }
  return value;
}

function isLessDeclaration(value: unknown): value is Declaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Declaration'
    && 'name' in value
    && (typeof value.name === 'string' || isInterp(value.name))
    && 'value' in value
    && 'value' in value
    && isLessValueSlotValue(value.value)
    && 'merge' in value
    && (value.merge === null || value.merge === ',' || value.merge === ' ')
    && 'important' in value
    && typeof value.important === 'boolean';
}

function isLessSelectorList(value: unknown): value is SelectorList {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'SelectorList'
    && 'selectors' in value
    && Array.isArray(value.selectors);
}

function requireSelectorList(value: unknown): SelectorList {
  if (!isLessSelectorList(value)) {
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

function isLessSelectorBranch(value: unknown): value is SelectorBranch {
  return isSelectorTerm(value) || isComplex(value) || isRelative(value);
}

const selectorBranchesFrom = (children: readonly unknown[]): SelectorBranch[] =>
  children.filter(isLessSelectorBranch);

function lessBranchSegments(branch: SelectorBranch): [{ combinator?: SelectorCombinator; term: SelectorTerm }, ...Array<{ combinator?: SelectorCombinator; term: SelectorTerm }>] {
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
  for (const segment of lessBranchSegments(branch)) {
    if (segment.combinator !== undefined && segment.combinator !== ' ' && segment.combinator !== '>') {
      return null;
    }
    const tokens = segment.term.type === 'CompoundSelector'
      ? segment.term.value
      : [segment.term];
    for (const token of tokens) {
      if (!isSimpleSelector(token) || token.text === null || (!token.text.startsWith('.') && !token.text.startsWith('#'))) {
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
  if (isLessSimpleToken(value)) {
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

function isLessSimpleToken(value: unknown): value is SimpleToken {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && (value.type === 'SimpleSelector' || value.type === 'PseudoSelector');
}

const lessSelectorTermFromTokens = (tokens: readonly SimpleToken[]): SelectorTerm =>
  selectorTermOf([tokens[0]!, ...tokens.slice(1)]);

function pseudoNameFromHead(head: string): string {
  return head.slice(0, 2) === '::'
    ? head.slice(2)
    : head.slice(0, 1) === ':'
      ? head.slice(1)
      : head;
}

function staticSelectorPseudoFrom(head: string, arg: unknown): SimpleToken {
  if (isLessSelectorList(arg) && STRUCTURED_PSEUDOS.has(pseudoNameFromHead(head).toLowerCase())) {
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
    && isLessSelectorList(value.selector)
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

/** A statement call `@name…(…);`: a variable's lookup/call chain ending in a call. */
function isReferenceCall(value: unknown): value is Reference {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'Reference' && 'base' in value && isVarRef(value.base)
    && 'steps' in value && Array.isArray(value.steps)
    && value.steps.length > 0 && value.steps[value.steps.length - 1]?.type === 'Call';
}

function isParam(value: unknown): value is Param {
  return typeof value === 'object' && value !== null && !('type' in value)
    && ('name' in value || 'pattern' in value || 'rest' in value);
}

function isExtendInstruction(value: unknown): value is ExtendInstruction {
  return typeof value === 'object' && value !== null
    && 'target' in value && isLessSelectorList(value.target)
    && 'partial' in value && typeof value.partial === 'boolean';
}

function isExtendTargetFact(value: unknown): value is ExtendTargetFact {
  return typeof value === 'object' && value !== null
    && 'target' in value && isLessSelectorList(value.target)
    && 'partial' in value && typeof value.partial === 'boolean';
}

function isBodyExtendFact(value: unknown): value is BodyExtendFact {
  return typeof value === 'object' && value !== null
    && 'bodyExtensions' in value && Array.isArray(value.bodyExtensions)
    && value.bodyExtensions.every(isExtendInstruction);
}

/** The shared empty extension list: a selector or body without an extend allocates nothing. */
const NO_EXTENSIONS: readonly ExtendInstruction[] = [];

/**
 * The body-form `&:extend()`s among a ruleset or mixin-definition body's reduced
 * children, in source order; the shared empty list when the body has none, so a body
 * without one allocates nothing.
 */
function bodyExtensionsOf(children: readonly unknown[]): readonly ExtendInstruction[] {
  let out: ExtendInstruction[] | undefined;
  for (const child of children) {
    if (isBodyExtendFact(child) && child.bodyExtensions.length !== 0) {
      (out ??= []).push(...child.bodyExtensions);
    }
  }
  return out ?? NO_EXTENSIONS;
}

/**
 * A selector branch and the inline `:extend(…)` targets that follow it, each of
 * which extends from that branch (an inline extend binds to its own branch).
 */
function selectorBranchFactFrom(children: readonly unknown[]): SelectorBranchFact {
  const subject = children.find(isLessSelectorBranch)!;
  let extensions: ExtendInstruction[] | undefined;
  for (const child of children) {
    if (!Array.isArray(child)) {
      continue;
    }
    for (const target of child) {
      if (isExtendTargetFact(target)) {
        (extensions ??= []).push({ target: target.target, partial: target.partial, subject: selist(subject) });
      }
    }
  }
  return { selector: subject, extensions: extensions ?? NO_EXTENSIONS };
}

/**
 * `SelectorListWithExtends`' reduction: the branches as one selector list, and
 * the inline extends of every branch, in order — the shared empty list when
 * no branch has one.
 */
function selectorListWithExtendsFrom(children: readonly unknown[], span: SourceSpan): SelectorListWithExtendsFact {
  const branches: SelectorBranch[] = [];
  let extensions: ExtendInstruction[] | undefined;
  for (const child of children) {
    if (isSelectorBranchFact(child)) {
      branches.push(child.selector);
      if (child.extensions.length !== 0) {
        (extensions ??= []).push(...child.extensions);
      }
    }
  }
  return { selector: withSourceSpan(selist(...branches), span), extensions: extensions ?? NO_EXTENSIONS };
}

/** A ruleset's extends: its selector's inline ones, then its body's; none when it has neither. */
function rulesetExtensions(selector: readonly ExtendInstruction[], body: readonly ExtendInstruction[]): ExtendInstruction[] | undefined {
  return selector.length === 0 && body.length === 0 ? undefined : [...selector, ...body];
}

function isSelectorBranchFact(value: unknown): value is SelectorBranchFact {
  return typeof value === 'object' && value !== null
    && 'selector' in value && isLessSelectorBranch(value.selector)
    && 'extensions' in value && Array.isArray(value.extensions)
    && value.extensions.every(isExtendInstruction);
}

function isSelectorListWithExtendsFact(value: unknown): value is SelectorListWithExtendsFact {
  return typeof value === 'object' && value !== null
    && 'selector' in value && isLessSelectorList(value.selector)
    && 'extensions' in value && Array.isArray(value.extensions)
    && value.extensions.every(isExtendInstruction);
}

function isMixinDefinitionFact(value: unknown): value is MixinDefinitionFact {
  return typeof value === 'object' && value !== null
    && 'params' in value && Array.isArray(value.params) && value.params.every(isParam)
    && 'rules' in value && Array.isArray(value.rules) && value.rules.every(isStatement)
    && 'extensions' in value && Array.isArray(value.extensions) && value.extensions.every(isExtendInstruction);
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
  return typeof value === 'object' && value !== null && 'value' in value && (isLessValueSlotValue(value.value) || isMixinCall(value.value))
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
      if (!isLessValueSlotValue(item.default)) {
        throw new SyntaxError('Less mixin parameter defaults must be values.');
      }
      return { name: item.reference.name, default: item.default };
    }
    if (!isLessValueSlotValue(item.value)) {
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
      : callArg(item.default, item.reference.name, false, '@');
  }
  return callArg(item.value);
}

function mixinCallArgsFromInterior(interior: MixinInteriorFact): MixinCallArgument[] {
  let hasSemicolon = false;
  for (const separator of interior.separators) {
    if (separator === ';') {
      hasSemicolon = true;
      break;
    }
  }
  if (!hasSemicolon) {
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
 *
 * The comparison is `implied`: the lowering, never what the author wrote, so a
 * written condition writes the operand, and `(1 and 2)` is written as authored,
 * never `(1 == true and 2 == true)` (ledger J20).
 */
function lessTruth(value: ValueSlot): MixinGuard {
  return { g: 'cmp', op: '==', left: value, right: keyword('true'), implied: true, parens: 0 };
}

/** {@link lessTruth} in `when` position — the same lowering, as a MATCH test
 *  (§4.2a), so a `when` tree contains no value-position assertion. `==` never
 *  raises, so this changes no answer; it keeps the invariant readable. */
function lessGuardTruth(value: ValueSlot): MixinGuard {
  return { g: 'match', op: '==', left: value, right: keyword('true'), implied: true, parens: 0 };
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
  switch (operator) {
    case '>':
    case '<':
    case '>=':
    case '<=':
    case '=>':
    case '=<':
    case '=':
    case '=~':
      return operator;
    default:
      return null;
  }
}

/**
 * A bare guard operand, NOT YET FOLDED. A `(` in a guard opens a group that is
 * read once: its content is a guard, and whether the group stays that guard or
 * is a math group in an operand (`((1 + 1) = 2)`) is decided by the token after
 * its `)`. The two fold the same run differently — a math group by
 * {@link lessMathInGroup}, where a slash divides; an operand by
 * {@link lessMathInValue}, under the math policy — so a bare operand stays a run
 * until whatever consumes it decides.
 */
interface LessGuardOperand {
  readonly kind: 'less-guard-operand';
  readonly run: ValueNode | LessMathRun;

  /** A parenthesized group's own guard: the group read as a condition. */
  readonly guard?: MixinGuard;
}

function isLessGuardOperand(value: unknown): value is LessGuardOperand {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'less-guard-operand';
}

/** A bare operand read as a condition: `default()`, a guard call, or its truth. */
function bareOperandGuard(value: ValueNode): MixinGuard {
  if (isFunctionCall(value)) {
    return isDefaultGuardCall(value)
      ? { g: 'default', parens: 0 }
      : { g: 'call', name: value.name, args: value.args.map(arg => requireValueNode(arg.value)), parens: 0 };
  }
  return lessGuardTruth(value);
}

/** A guard term read as a guard. */
function requireGuardTerm(value: unknown, state: unknown): MixinGuard {
  if (isLessGuardOperand(value)) {
    return value.guard ?? bareOperandGuard(lessMathInValue(value.run, state));
  }
  if (isMixinGuard(value)) {
    return value;
  }
  throw new TypeError('Less grammar produced a guard term without a guard.');
}

/**
 * A guard group read as an operand. One value is folded as a math group
 * (`( <run> )`), exactly as a value-position `Paren`; a condition
 * (`((1 = 1) = true)`) is the condition's truth, as the `if()` twin reads it.
 * The parser keeps the shape and evaluation decides whether the operand
 * compares or computes (ledger P42).
 */
function guardGroupValue(inner: unknown, span: SourceSpan, state: unknown): ValueNode {
  if (isLessGuardOperand(inner)) {
    return withSourceSpan(block(lessMathInGroup(inner.run, state)), span);
  }
  const source = sourceFromState(state);
  if (source === undefined) {
    throw new TypeError('Less guard group lost its source.');
  }
  return withSourceSpan(condition(inParens(requireGuardTerm(inner, state)), source.slice(span.start, span.end)), span);
}

/**
 * Continue a math run from `head` — a group read as an operand — over the
 * `<operator> <atom>` pairs after its `)` (`(1 + 1) * 2`), up to a comparison
 * operator, whose index is returned with the unfolded run.
 */
function continueGuardMathRun(
  head: ValueNode,
  children: readonly unknown[],
  rawChildren: readonly unknown[],
  from: number
): { readonly run: ValueNode | LessMathRun; readonly next: number } {
  let next = from;
  while (next < children.length && guardOperatorText(children[next]) === null) {
    next += 2;
  }
  if (next === from) {
    return { run: head, next };
  }
  return { run: mathRunFrom(head, sourceSpanOf(head), children, rawChildren, from, next), next };
}

/**
 * `MixinGuardTerm`'s reduction: `not`? then a `(`-led group — a guard, or, when
 * a math tail or a comparison follows its `)`, an operand — or an operand,
 * then an optional comparison. A bare operand stays a {@link LessGuardOperand}
 * so an enclosing group can still read it as a value.
 */
function mixinGuardTermFrom(
  children: readonly unknown[],
  rawChildren: readonly unknown[],
  state: unknown
): MixinGuard | LessGuardOperand {
  const negated = isLessKeyword(children[0], 'not');
  let index = negated ? 1 : 0;
  let left: ValueNode | LessMathRun;
  let term: MixinGuard | LessGuardOperand | undefined;
  if (isLessTerminalText(children[index], '(')) {
    const open = rawChildren[index];
    const close = rawChildren[index + 2];
    if (!isSpannedToken(open) || !isSpannedToken(close)) {
      throw new TypeError('Less guard group lost its delimiter provenance.');
    }
    const inner = children[index + 1];
    const span = { start: open.span.start, end: close.span.end };
    if (index + 3 === children.length) {
      /* A lone group is transparent as a guard and a math group as a value. */
      term = isLessGuardOperand(inner)
        ? { kind: 'less-guard-operand', run: guardGroupValue(inner, span, state), guard: inParens(requireGuardTerm(inner, state)) }
        : inParens(requireGuardTerm(inner, state));
      return negated ? { g: 'not', inner: requireGuardTerm(term, state), word: requireTerminalText(children[0]), parens: 0 } : term;
    }
    const operand = continueGuardMathRun(guardGroupValue(inner, span, state), children, rawChildren, index + 3);
    left = operand.run;
    index = operand.next;
  } else {
    left = requireMathOperand(children[index]);
    index += 1;
  }
  const operator = guardOperatorText(children[index]);
  if (operator === null) {
    term = { kind: 'less-guard-operand', run: left };
  } else {
    /*
     * GUARD position, so the comparison lowers to the MATCH test (§4.2a).
     * This production family is reached only from `g.MixinGuard` — the
     * `when` clause of a mixin definition or a CSS guard — and both ask
     * whether a definition APPLIES. `.generic(1, true) when (@a < @b)`
     * has no ordering and therefore does not match; lessc 4.6.3 agrees,
     * and so does the owner-maintained expected CSS. Value position keeps
     * the assertion, built separately in `FunctionConditionTerm`.
     */
    term = {
      g: 'match',
      op: operator,
      left: lessMathInValue(left, state),
      right: lessMathInValue(requireMathOperand(children[index + 1]), state),
      implied: false,
      parens: 0
    };
  }
  return negated ? { g: 'not', inner: requireGuardTerm(term, state), word: requireTerminalText(children[0]), parens: 0 } : term;
}

/** One `MathSum` reduction: an operand, or an unfolded run. */
function requireMathOperand(value: unknown): ValueNode | LessMathRun {
  if (isValueNode(value) || isLessMathRun(value)) {
    return value;
  }
  throw new TypeError('Less guard lost its operand.');
}

/**
 * Fold an `and` / `or` chain. A lone term passes through unconverted, so a
 * bare operand reaches an enclosing group still able to be read as a value.
 */
function foldMixinGuards(kind: 'and' | 'or', children: readonly unknown[], state: unknown): MixinGuard | LessGuardOperand {
  let result: MixinGuard | LessGuardOperand | undefined;
  let word: string = kind;
  for (const child of children) {
    if (isMixinGuard(child) || isLessGuardOperand(child)) {
      result = result === undefined
        ? child
        : { g: kind, left: requireGuardTerm(result, state), right: requireGuardTerm(child, state), word, parens: 0 };
    } else if (isLessKeyword(child, kind) || isLessTerminalText(child, ',')) {
      /* The keyword as the author spelled it (`AND`), or the `,` a guard writes `or` as. */
      word = requireTerminalText(child);
    }
  }
  if (result === undefined) {
    throw new TypeError('Less grammar produced an empty logical guard.');
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
    /* A query's `name: value` (an if-test's `supports(x: y)`) is spelled as a query spells it. */
    case 'Operation': return `${functionConditionSource(node.left)}${node.operator === ':' ? '' : ' '}${node.operator} ${functionConditionSource(node.right)}`;
    case 'Block': return `${delimiterOpen(node.delimiter)}${functionConditionSource(node.value)}${delimiterClose(node.delimiter)}`;
    case 'Branch': return `${functionConditionSource(node.condition)}:${Array.isArray(node.value) && node.value.length === 0 ? '' : ` ${functionConditionSource(node.value)}`}`;
    /*
     * An `Expression` owns no delimiters of its own. A nested `boolean(…)`/
     * `if(…)` condition is replayed with the enclosing group's `(inner)`, as
     * the boundary `Block` spelled it before the boundary became its own node
     * kind. A math computation (ledger P35) is replayed with parens only when
     * the author wrote them: a paren group that became the boundary starts
     * before its value does; bare math starts where its value starts.
     */
    case 'Expression': {
      const inner = functionConditionSource(node.value);
      return isValueNode(node.value) && node.value.type !== 'Condition'
        && sourceStartOf(node) === sourceStartOf(node.value)
        ? inner
        : `(${inner})`;
    }
    case 'List': return node.value.map(functionConditionSource).join(sepGlue(node.sep));
    case 'Sequence': return node.parts.map(functionConditionSource).join(' ');
    case 'Condition': return node.src;
    default: throw new TypeError(`Less function condition cannot preserve ${node.type}.`);
  }
}

/** A `FunctionConditionOperand`'s reduction: one run stays unfolded, a space list is a value. */
function functionConditionOperandFrom(children: readonly unknown[], state: unknown): LessGuardOperand | ValueNode {
  const runs = children.filter(isMathOperand);
  if (runs.length === 1) {
    return { kind: 'less-guard-operand', run: runs[0]! };
  }
  if (runs.length === 0) {
    throw new TypeError('Less function condition lost its operand.');
  }
  return spaced(runs.map(run => lessMathInValue(run, state)));
}

/** A `FunctionConditionParen`'s reduction: the inner condition, grouped. */
function functionConditionParenFrom(children: readonly unknown[], span: SourceSpan, state: unknown): FunctionConditionFact {
  const inner = children.find(isFunctionConditionFact);
  if (inner === undefined) {
    throw new TypeError('Less function condition lost its parenthesized operand.');
  }
  const fact = { guard: inParens(inner.guard), src: `(${inner.src})`, grouped: true, hasComparison: inner.hasComparison };
  return inner.raw === undefined || inner.hasComparison
    ? fact
    : { ...fact, raw: guardGroupValue({ kind: 'less-guard-operand', run: inner.raw }, span, state) };
}

/** One side of a value-position comparison, as the value it compares. */
function functionConditionValue(fact: FunctionConditionFact, state: unknown): ValueNode {
  if (fact.bare !== undefined) {
    return fact.bare;
  }
  return fact.raw === undefined || fact.hasComparison ? condition(fact.guard, fact.src) : lessMathInValue(fact.raw, state);
}

/** A condition operand — a `FunctionConditionParen` fact, or an operand reduction — as a fact. */
function functionConditionOperandFact(value: unknown, state: unknown): FunctionConditionFact {
  if (isFunctionConditionFact(value)) {
    return value;
  }
  const bare = isLessGuardOperand(value) ? lessMathInValue(value.run, state) : requireValueNode(value);
  const fact = { guard: lessTruth(bare), src: functionConditionSource(bare), grouped: false, hasComparison: false, bare };
  return isLessGuardOperand(value) ? { ...fact, raw: value.run } : fact;
}

/**
 * `FunctionConditionTerm`'s reduction, the value-position twin of
 * {@link mixinGuardTermFrom}: `not`? then a group — continued by the rest of a
 * math run after its `)` (`((1 + 1) * 2 = 4)`), which makes it an operand — or
 * an operand, then an optional comparison whose sides may be either.
 */
function functionConditionTermFrom(
  children: readonly unknown[],
  rawChildren: readonly unknown[],
  state: unknown
): FunctionConditionFact {
  const negated = isFunctionConditionNot(children[0]);
  const notWord = negated ? requireTerminalText(children[0]) : '';
  let index = negated ? 1 : 0;
  let left = functionConditionOperandFact(children[index], state);
  const groupLed = left.grouped;
  index += 1;
  if (groupLed && index < children.length && guardOperatorText(children[index]) === null) {
    /* A group holding a condition heads the run as the condition's truth (ledger P42). */
    const head = left.raw === undefined || left.hasComparison ? condition(left.guard, left.src) : requireValueNode(left.raw);
    const operand = continueGuardMathRun(head, children, rawChildren, index);
    let src = left.src;
    for (let at = index; at < operand.next; at += 2) {
      src += ` ${requireTerminalText(children[at]).trim()} ${functionConditionSource(requireValueNode(children[at + 1]))}`;
    }
    const bare = lessMathInValue(operand.run, state);
    left = { guard: lessTruth(bare), src, grouped: false, hasComparison: false, bare };
    index = operand.next;
  }
  const operator = guardOperatorText(children[index]);
  if (operator === null) {
    const grouped = left.grouped;
    if (negated) {
      return { guard: { g: 'not', inner: left.guard, word: notWord, parens: 0 }, src: `${notWord}(${left.src})`, grouped, hasComparison: left.hasComparison };
    }
    return { ...left, grouped };
  }
  const right = functionConditionOperandFact(children[index + 1], state);
  const guard: MixinGuard = { g: 'cmp', op: operator, left: functionConditionValue(left, state), right: functionConditionValue(right, state), implied: false, parens: 0 };
  const src = `${left.src} ${operator} ${right.src}`;
  return negated
    ? { guard: { g: 'not', inner: guard, word: notWord, parens: 0 }, src: `${notWord}(${src})`, grouped: false, hasComparison: true }
    : { guard, src, grouped: false, hasComparison: true };
}

function isFunctionConditionNot(value: unknown): boolean {
  return isLessKeyword(value, 'not');
}

/** One `MathSum` reduction among other children. */
function isMathOperand(value: unknown): value is ValueNode | LessMathRun {
  return isValueNode(value) || isLessMathRun(value);
}

/** A `not` token among a group's children; a value child never is one. */
function isParenNot(value: unknown): boolean {
  return !isMathOperand(value) && isFunctionConditionNot(value);
}

/** The `and` / `or` joining two terms of a value paren group, as the author spelled it. */
interface LessParenLogical {
  readonly kind: 'less-paren-logical';
  readonly logical: 'and' | 'or';
  readonly word: string;
}

function isLessParenLogical(value: unknown): value is LessParenLogical {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'less-paren-logical';
}

/** `ParenConditionAnd` / `ParenConditionOr`'s reduction: which keyword, and its spelling. */
function parenLogicalFrom(logical: 'and' | 'or', children: readonly unknown[]): LessParenLogical {
  return { kind: 'less-paren-logical', logical, word: requireTerminalText(children[0]) };
}

/**
 * One term of a value paren group, read by the `FunctionConditionTerm` reducer:
 * `not`?, an operand, and an optional comparison. An operand standing alone that
 * is itself a group around a condition (`((a > b) and (c > d))`) is that
 * condition, grouped, as `FunctionConditionParen` reads `(a > b)`.
 */
function parenConditionTermFrom(children: readonly unknown[], state: unknown): FunctionConditionFact {
  const lead = children.filter(isParenNot);
  const [left, right] = children.filter(isMathOperand);
  if (right !== undefined) {
    const operator = children.find(child => !isMathOperand(child) && guardOperatorText(child) !== null);
    return functionConditionTermFrom([
      ...lead,
      functionConditionOperandFrom([left], state),
      operator,
      functionConditionOperandFrom([right], state)
    ], [], state);
  }
  const value = lessMathInValue(left!, state);
  const inner = value.type === 'Block' && value.delimiter === 'paren' && isValueNode(value.value) && value.value.type === 'Condition'
    ? value.value
    : null;
  return functionConditionTermFrom([
    ...lead,
    inner === null ? value : { guard: inParens(inner.guard), src: functionConditionSource(value), grouped: true, hasComparison: true }
  ], [], state);
}

/**
 * A value-position `Paren`'s reduction: a paren group around its content. One
 * operand is a math group. Anything more is a group around the condition
 * `if()` and `boolean()` read: terms joined by `and`, which binds tighter, and
 * `or`, folded as `FunctionConditionAnd` / `FunctionConditionOr` fold them, so
 * `(a > b)` replays the same condition source whichever production reads it,
 * and a condition written into a value keeps the group's parens.
 */
function lessParenFrom(children: readonly unknown[], span: SourceSpan, state: unknown): ValueNode {
  /* One walk, allocating nothing: one operand and no `not` or keyword is a math group. */
  let operand: ValueNode | LessMathRun | undefined;
  let conditional = false;
  for (const child of children) {
    if (isMathOperand(child)) {
      conditional ||= operand !== undefined;
      operand = child;
    } else if (isLessParenLogical(child) || isFunctionConditionNot(child)) {
      conditional = true;
    }
  }
  if (!conditional && operand !== undefined) {
    return withSourceSpan(block(lessMathInGroup(operand, state)), span);
  }
  const ors: unknown[] = [];
  let ands: unknown[] = [];
  let term: unknown[] = [];
  for (const child of children) {
    if (!isLessParenLogical(child)) {
      term.push(child);
      continue;
    }
    ands.push(parenConditionTermFrom(term, state));
    term = [];
    if (child.logical === 'or') {
      ors.push(foldFunctionCondition('and', ands), child);
      ands = [];
    } else {
      ands.push(child);
    }
  }
  ands.push(parenConditionTermFrom(term, state));
  ors.push(foldFunctionCondition('and', ands));
  const fact = foldFunctionCondition('or', ors);
  return withSourceSpan(block(condition(fact.guard, fact.src)), span);
}

/**
 * Fold an `and` / `or` chain of condition facts, each joined by the keyword
 * before it, kept as the author spelled it (`AND`): a value paren group's
 * {@link LessParenLogical}, or a function condition's keyword token.
 */
function foldFunctionCondition(kind: 'and' | 'or', children: readonly unknown[]): FunctionConditionFact {
  let first: FunctionConditionFact | undefined;
  let guard: MixinGuard | undefined;
  let src = '';
  let hasComparison = false;
  let word: string = kind;
  for (const child of children) {
    if (!isFunctionConditionFact(child)) {
      const text = isLessParenLogical(child) ? child.word : lessTerminalText(child)?.trim();
      if (text !== undefined && text !== null) {
        word = text;
      }
      continue;
    }
    if (first === undefined || guard === undefined) {
      first = child;
      guard = child.guard;
      src = child.src;
      hasComparison = child.hasComparison;
      continue;
    }
    guard = { g: kind, left: guard, right: child.guard, word, parens: 0 };
    src += ` ${word} ${child.src}`;
    hasComparison ||= child.hasComparison;
  }
  if (first === undefined || guard === undefined) {
    throw new TypeError('Less function condition lost its first term.');
  }
  if (guard === first.guard) {
    return first.raw === undefined
      ? { guard, src, grouped: false, hasComparison }
      : { guard, src, grouped: false, hasComparison, raw: first.raw };
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
    case 'ModuleImport':
      return true;
    case 'StyleImport':
      return isStyleImport(value);
    case 'VariableDeclaration':
      return isVarDeclaration(value);
    case 'Declaration':
      return isLessDeclaration(value);
    case 'Ruleset':
      return isRuleset(value);
    case 'AtRuleBlock':
      return isAtRuleBlock(value);
    case 'UnknownAtRuleBlock':
      return typeof value === 'object' && value !== null && 'type' in value && value.type === 'UnknownAtRuleBlock';
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
    case 'If':
      return true;
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
  const statements: Statement[] = [];
  for (const child of children) {
    if (!isStatement(child)) {
      throw new TypeError('Less grammar produced a non-ruleset-body child.');
    }
    statements.push(child);
  }
  return statements;
}

/**
 * A `<general-enclosed>` group from its `Enclosed` content: a call when it has a
 * name, else a paren block. It records its source bytes, as the css base's does,
 * unless it carries `@{…}`.
 */
function enclosedFrom(name: string | undefined, children: readonly unknown[], span: Span, state: unknown): FunctionCall | Block {
  const content = children.find((child): child is Interpolation => typeof child === 'object' && child !== null && 'type' in child && child.type === 'Interpolation');
  if (content === undefined) {
    throw new TypeError('Less general-enclosed lost its grammar-owned content.');
  }
  return generalEnclosedGroup(
    name === undefined ? block(content) : withFunctionScope(funcCall(name, [content]), functionScopeOf(state)),
    span,
    state
  );
}

/** Retain every callback body fact except an authored empty statement. */
function requireCallbackStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (isLessTerminalText(child, ';')) {
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
  const bodyStart = children.findIndex(child => isLessTerminalText(child, '{'));
  const bodyEnd = children.findIndex((child, index) => index > bodyStart && isLessTerminalText(child, '}'));
  if (bodyStart < 0 || bodyEnd < 0) {
    throw new TypeError('Less grammar produced a detached ruleset without a delimited body.');
  }
  for (const child of children.slice(bodyEnd + 1)) {
    if (!isLessTerminalText(child, ';')) {
      throw new TypeError('Less grammar produced an invalid detached-ruleset suffix.');
    }
  }
  return requireCallbackStatements(children.slice(bodyStart + 1, bodyEnd));
}

/**
 * One Less arithmetic run exactly as `MathSum` recognised it — its operands and
 * the operators between them, not yet folded. `MathSum` is the ONE rule that
 * parses every Less math operator, the division slash included (ledger P34);
 * what it does not know is the context it sits in, and the context decides the
 * shape: inside a math group or `calc(…)` a slash divides at product
 * precedence, while in a plain value the configured `math:` policy decides
 * whether it divides at all (P1). So the run is handed to its consumer, which
 * folds it ONCE with the rule for its own position — never folded and then
 * re-associated.
 */
interface LessMathRun {
  readonly kind: 'less-math-run';
  readonly operands: readonly ValueNode[];
  readonly operators: readonly string[];
  readonly spans: ReadonlyArray<SourceSpan | undefined>;
}

function isLessMathRun(value: unknown): value is LessMathRun {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'less-math-run';
}

/** `MathSum`'s reduction: its only operand, or the unfolded run. */
function lessMathRun(
  children: readonly unknown[],
  _fields: FieldMap | undefined,
  _span: Span,
  rawChildren: readonly unknown[]
): ValueNode | LessMathRun {
  const head = requireValueNode(children[0]);
  if (children.length === 1) {
    return head;
  }
  const raw = rawChildren[0];
  return mathRunFrom(head, isSpannedToken(raw) ? raw.span : sourceSpanOf(head), children, rawChildren, 1, children.length);
}

/**
 * A math run from its first operand and the `<operator> <operand>` pairs
 * `children[from..to)` — the ONE assembly of a run, for a `MathSum` and for the
 * run a guard group heads. In AST mode Parseman supplies the original spanned
 * children in `rawChildren`, which gives each folded operation its authored
 * range without retaining one span per standalone dimension.
 */
function mathRunFrom(
  head: ValueNode,
  headSpan: SourceSpan | undefined,
  children: readonly unknown[],
  rawChildren: readonly unknown[],
  from: number,
  to: number
): LessMathRun {
  const operands: ValueNode[] = [head];
  const operators: string[] = [];
  const spans: Array<SourceSpan | undefined> = [headSpan];
  for (let index = from; index < to; index += 2) {
    operators.push(requireTerminalText(children[index]).trim());
    const operand = requireValueNode(children[index + 1]);
    const raw = rawChildren[index + 1];
    operands.push(operand);
    spans.push(isSpannedToken(raw) ? raw.span : sourceSpanOf(operand));
  }
  return { kind: 'less-math-run', operands, operators, spans };
}

/** The `MathSum` child of a production that wraps one math run. */
function requireMathSum(children: readonly unknown[]): ValueNode | LessMathRun {
  for (const child of children) {
    if (isValueNode(child) || isLessMathRun(child)) {
      return child;
    }
  }
  throw new TypeError('Less math production lost its operand.');
}

const LESS_PRODUCT_OPERATORS: ReadonlySet<string> = new Set(['*', '/', '%']);
const LESS_SUM_OPERATORS: ReadonlySet<string> = new Set(['+', '-']);

/**
 * Fold `operands[from..to]` left-associatively, product before sum. Each folded
 * pair records whether Less's configured `math:` policy computes it with no
 * enclosing math context, so the evaluator never reads that policy from ambient
 * config (§12.6b).
 */
function foldLessMath(run: LessMathRun, from: number, to: number, state: unknown): ValueNode {
  if (from === to) {
    return run.operands[from]!;
  }
  let operands: ValueNode[] = run.operands.slice(from, to + 1);
  let spans: Array<SourceSpan | undefined> = run.spans.slice(from, to + 1);
  let operators: string[] = run.operators.slice(from, to);
  for (const tier of [LESS_PRODUCT_OPERATORS, LESS_SUM_OPERATORS]) {
    const nextOperands: ValueNode[] = [operands[0]!];
    const nextSpans: Array<SourceSpan | undefined> = [spans[0]];
    const nextOperators: string[] = [];
    for (let index = 0; index < operators.length; index += 1) {
      const operator = operators[index]!;
      if (!tier.has(operator)) {
        nextOperators.push(operator);
        nextOperands.push(operands[index + 1]!);
        nextSpans.push(spans[index + 1]);
        continue;
      }
      const left = nextOperands.pop()!;
      const leftSpan = nextSpans.pop();
      const rightSpan = spans[index + 1];
      const folded = operation(operator, left, operands[index + 1]!, false, lessMathOutsideParens(state, operator));
      const span = leftSpan === undefined || rightSpan === undefined
        ? undefined
        : { start: leftSpan.start, end: rightSpan.end };
      nextOperands.push(span === undefined ? folded : withSourceSpan(folded, span));
      nextSpans.push(span);
    }
    operands = nextOperands;
    spans = nextSpans;
    operators = nextOperators;
  }
  return operands[0]!;
}

/**
 * A run inside a math context — a parenthesized group or `calc(…)`. Every
 * operator is arithmetic there, the slash included, so the run folds with plain
 * product-before-sum precedence.
 */
function lessMathInGroup(value: ValueNode | LessMathRun, state: unknown): ValueNode {
  return isLessMathRun(value) ? foldLessMath(value, 0, value.operands.length - 1, state) : value;
}

/**
 * A run in a plain value position. The math policy picks the SHAPE of the slash
 * the run already parsed (P1/P34), without re-parsing anything:
 *
 * - where the policy divides a bare slash (`math: always`), the slash is a
 *   division at product precedence like every other operator;
 * - where it does not, the slash binds LOOSEST of the math operators —
 *   everything on each side of it is that side's own math (P35), so
 *   `4 / 2 + 5em` is `4` and `2 + 5em`, and the result is a slash-separated
 *   `List` of the two sides. That list sits INSIDE a space-separated value
 *   (`font: 12px/1.5 Arial` is `[12px / 1.5, Arial]`), where the css slash
 *   rung sits above the space level (`12px / [1.5 Arial]`); which level is
 *   right for Less is an open question for the owner, not decided here.
 */
function lessMathInValue(value: ValueNode | LessMathRun, state: unknown): ValueNode {
  if (!isLessMathRun(value)) {
    return lessComputation(value);
  }
  const last = value.operands.length - 1;
  if (lessMathOutsideParens(state, '/')) {
    return lessComputation(foldLessMath(value, 0, last, state));
  }
  let sides: ValueNode[] | undefined;
  let from = 0;
  for (let index = 0; index < value.operators.length; index += 1) {
    if (value.operators[index] === '/') {
      (sides ??= []).push(lessComputation(foldLessMath(value, from, index, state)));
      from = index + 1;
    }
  }
  const tail = lessComputation(foldLessMath(value, from, last, state));
  if (sides === undefined) {
    return tail;
  }
  sides.push(tail);
  return list(sides, '/');
}

/**
 * Lower one value-position operand that the math policy COMPUTES into an
 * `Expression` — jess's `$( … )` computation boundary, the one place `.jess`
 * does math (ledger P35) — so `.less` and its `.jess` spelling are one shape.
 *
 * - An operation the policy computes with no enclosing context is the whole
 *   computation: ONE `Expression` around the tree, not one per operator.
 * - A parenthesized group whose content is math exists only to open a math
 *   context, so the group IS the computation boundary: `(@a * 2)` is
 *   `$(@a * 2)`. A group around a non-math value (`(foo)`) stays a `Block`,
 *   because there its parens are part of the emitted value.
 * - Anything else is left as it is: a plain operand is not math, and an
 *   operation the policy does not compute (`math: strict`) is not a
 *   computation. Nested groups inside a computation stay `Block`s, exactly as
 *   `.jess` `$( a * (b + c) )` spells them.
 */
function lessComputation(node: ValueNode): ValueNode {
  let inner: ValueNode;
  if (isArithmetic(node) && node.mathOutsideParens) {
    inner = node;
  } else if (isMathGroup(node)) {
    inner = requireMathGroupValue(node);
  } else {
    return node;
  }
  const computation = expression(inner);
  const start = sourceStartOf(node);
  return start === NO_SPAN ? computation : withSourceSpan(computation, { start, end: sourceEndOf(node) });
}

function isMathGroup(node: ValueNode): node is Block {
  return node.type === 'Block'
    && node.delimiter === 'paren'
    && node.escaped !== true
    && isValueNode(node.value)
    && (isArithmetic(node.value) || isMathGroup(node.value));
}

/** An arithmetic `Operation` — not a query feature's `:` or comparison. */
function isArithmetic(node: ValueNode): node is Operation {
  return node.type === 'Operation'
    && (LESS_PRODUCT_OPERATORS.has(node.operator) || LESS_SUM_OPERATORS.has(node.operator));
}

function requireMathGroupValue(node: Block): ValueNode {
  if (!isValueNode(node.value)) {
    throw new TypeError('Less math group lost its operation.');
  }
  return node.value;
}

export {
  LESS_NODE_TRIVIA_STRIDE,
  STRUCTURED_PSEUDOS,
  appendEnclosedLiteral,
  appendInterpolationLiteral,
  argumentFunctionFromChildren,
  lessBranchSegments,
  callArgumentSource,
  callWithLayout,
  combinatorTailReducer,
  selectorBranchFactFrom,
  queryListHasImportCondition,
  complexSegmentsFrom,
  customPartsFromChildren,
  customValueFromParts,
  trimCustomValueEnd,
  enclosedInterpolationFromChildren,
  foldFunctionCondition,
  foldMixinGuards,
  functionConditionOperandFrom,
  functionConditionParenFrom,
  functionConditionTermFrom,
  isLessGuardOperand,
  mixinGuardTermFrom,
  requireGuardTerm,
  isLessMathRun,
  lessMathInGroup,
  lessMathInValue,
  lessParenFrom,
  parenLogicalFrom,
  lessMathRun,
  requireMathSum,
  functionCallFromChildren,
  functionNameFromOpener,
  functionSeparatorsFromFields,
  hasChildren,
  hasField,
  hasGrammarType,
  hasRulesetTerminator,
  interpolationFactFromChildren,
  interpolationPartsFrom,
  isAny,
  isAtRuleBlock,
  isAtRuleStatement,
  isBareMixinCallFact,
  bodyExtensionsOf,
  isBodyExtendFact,
  isComplex,
  isComplexTailFact,
  isLessDeclaration,
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
  enclosedFrom,
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
  isLessSelectorBranch,
  isSelectorBranchFact,
  isLessSelectorList,
  isSelectorListWithExtendsFact,
  isSelectorTerm,
  isSequence,
  isSimpleSelector,
  isLessSimpleToken,
  isStatement,
  isStyleImport,
  isLessKeyword,
  isLessTerminalText,
  isUnsupportedVariableNameFact,
  isUrl,
  isValueNode,
  isLessValueSlotValue,
  isVarDeclaration,
  isVarIndirect,
  isVarRef,
  keywordOrValue,
  layoutFromTriviaBoundaries,
  lessConditionGuard,
  lessMathOutsideParens,
  lessTriviaEntryCount,
  lessTriviaEntryInsertIndex,
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
  quotedFromChildren,
  lessQueryComparisonOperators,
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
  referenceBracketTailFact,
  referenceCallTailFact,
  referenceDotTailFact,
  requireReferenceTailFact,
  requireRulesetBody,
  requireSelectorList,
  requireSelectorListWithExtendsFact,
  rulesetExtensions,
  selectorListWithExtendsFrom,
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
  lessSelectorTermFromTokens,
  separatorRawIndexes,
  separatorWithSurroundingTrivia,
  separatorsFromFields,
  sourceFromState,
  staticNonSelectorPseudoFrom,
  staticSelectorPseudoFrom,
  staticText,
  staticTextWithTriviaGaps,
  atRulePreludeFrom,
  triviaTextAtInsertIndex,
  unsupportedVariableNameFrom,
  valuePieceReducerWithTrivia,
  lessValueSlot,
  variableNameTerminalText,
  variableNameText,
  variableValueSlot
};

export type {
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
  LessGuardOperand,
  LessMathRun,
  UnsupportedVariableNameFact,
  VarRef
};
