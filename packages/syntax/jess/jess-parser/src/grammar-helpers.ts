/**
 * Jess grammar reducer helpers, hoisted out of `jess-parser/src/grammar.ts`.
 *
 * These are the module-private helpers the Jess grammar's `node(...)`/`leaf(...)`
 * reducers call. They lived inside `grammar.ts` as free module scope, which is
 * fine for a standalone `composeLeaf(...)` grammar but not for a COMPOSABLE
 * delta: the parseman compose analyzer can only carry a reducer across a package
 * boundary when every name the reducer reads has import provenance. A free
 * module-private helper has none, so `compose([cssBaseRules, rules(jessDelta)])`
 * refused them. Hoisting them into this importable module gives each one a
 * resolvable import, and the analyzer re-emits those imports into the composing
 * module. A relative same-package import is sufficient (proven by B0-less):
 * parseman carries same-package relative-import provenance, not only
 * workspace-package imports.
 *
 * These are Jess's OWN helpers. A helper Jess shares with another dialect lives
 * in `@jesscss/core/ast` (`css-grammar-helpers.ts`) and is imported from there;
 * the bindings below only supply the Jess name and value set it is
 * parameterised by.
 */

import type { FieldCapture, FieldMap } from 'parseman';
import { any, anonymousMixin, appendCustomValueParts as appendCustomValuePartsIn, block, selectorBranchCanonical, customValueFromChildren as customValueFromChildrenIn, declarationReference, interpolation, interpolationFromTemplateChildren as interpolationFromTemplateChildrenIn, isAtRuleBlock, isAtRuleStatement, isExtendInstruction, isFor, isGuardNodeOf, isIf, isInterpolation, isMathOperator, isMixinCall, isMixinDefinition, isModuleImport, isParamArray, isQuoted, isReference, isRuleset, isSelectorBranch, isSimpleToken, isStyleImport, isToken, isUnknownAtRuleBlock, isValueSlotOf, isWhile, keyword, list, lookupStep, operation, cssBaseMathOutsideParens, propertyReference, quoted, reference, requireForBinding as requireForBindingIn, requireGuardNodeOf, requireInterpolation as requireInterpolationIn, requireSelectorList as requireSelectorListIn, requireString as requireStringIn, requireToken as requireTokenIn, selectorTermFromTokens, selist, url, valueSlot, variableDeclaration, variableReference, withBlockBody, sourceSpanOf, withSourceSpan } from '@jesscss/core/ast';
import type { Token, AnonymousMixin, Apply, Declaration, CollectionItem, ExtendInstruction, ForBinding, IfBranch, InterpPart, Interpolation, Keyword, MixinCall, Quoted, Reference, SelectorBranch, SelectorTerm, SelectorList, Statement, Url, ValueNode, ValueSlot, VariableDeclaration, Lookup, GuardNode } from '@jesscss/core/ast';

type ExpressionFact = { readonly value: ValueNode; readonly src: string };
type JessOperatorFact = { readonly value: string; readonly src: string };
type JessReferenceTail = { readonly step: Reference['steps'][number]; readonly src: string };
type JessComplexTail = { readonly combinator: ' ' | '>' | '+' | '~' | '||'; readonly term: SelectorTerm };
type JessQueryFeatureName = { readonly property: Keyword };
type JessAtRuleHeader = { readonly name: string; readonly prelude: ValueNode | null };
type JessMixinCallArgument = MixinCall['args'][number];

/*
 * Core's shared reducer helpers, bound to this grammar: its name is the only
 * part of their error messages that differs between dialects, and
 * `isValueNode` is the value set its guards and value slots accept.
 */
const DIALECT = 'Jess';
const requireToken = (value: unknown): Token => requireTokenIn(value, DIALECT);
const requireString = (value: unknown): string => requireStringIn(value, DIALECT);
const requireInterpolation = (value: unknown): Interpolation => requireInterpolationIn(value, DIALECT);
const requireSelectorList = (value: unknown): SelectorList => requireSelectorListIn(value, DIALECT);
const requireForBinding = (value: unknown): ForBinding => requireForBindingIn(value, DIALECT);
const requireGuardNode = (value: unknown): GuardNode => requireGuardNodeOf(value, isValueNode, DIALECT);
const isJessValueSlotValue = (value: unknown): value is ValueSlot => isValueSlotOf(value, isValueNode);
const interpolationFromTemplateChildren = (children: readonly unknown[]): Interpolation => interpolationFromTemplateChildrenIn(children, DIALECT);
const customValueFromChildren = (children: readonly unknown[]): ValueNode => customValueFromChildrenIn(children, DIALECT);
const appendCustomValueParts = (children: readonly unknown[], parts: Interpolation['parts'], seen: { interpolated: boolean }): void => appendCustomValuePartsIn(children, parts, seen, DIALECT);

function requireFields(fields: FieldMap | undefined, name: string): readonly FieldCapture[] {
  const field = fields?.[name];
  if (field === undefined) {
    throw new TypeError(`Jess grammar lost required ${name} field.`);
  }
  return Array.isArray(field) ? field : [field];
}

function jessCombinator(value: Token): JessComplexTail['combinator'] {
  if (value.value === '>' || value.value === '+' || value.value === '~' || value.value === '||') {
    return value.value;
  }
  return ' ';
}

/*
 * A NESTING leading combinator (`.parent { > .child }`) is one of `>`/`+`/`~`,
 * mirroring css's `relativeSelectorCombinator`. The column combinator `||` is a
 * compound separator, not a relative one, so it is excluded here.
 */
function jessRelativeCombinator(child: unknown): '>' | '+' | '~' {
  if (isToken(child) && (child.value === '>' || child.value === '+')) {
    return child.value;
  }
  return '~';
}

function isExpressionFact(value: unknown): value is ExpressionFact {
  return typeof value === 'object' && value !== null && 'value' in value && 'src' in value;
}

function isJessAtRuleHeader(value: unknown): value is JessAtRuleHeader {
  return typeof value === 'object'
    && value !== null
    && 'name' in value
    && typeof value.name === 'string'
    && 'prelude' in value;
}

function requireJessAtRuleHeader(value: unknown): JessAtRuleHeader {
  if (!isJessAtRuleHeader(value)) {
    throw new TypeError('Jess grammar produced an invalid at-rule header.');
  }
  return value;
}

function isAtRuleNameToken(value: unknown): value is Token {
  return isToken(value)
    && !('type' in value)
    && value.value.startsWith('@');
}

function isJessReferenceTail(value: unknown): value is JessReferenceTail {
  return typeof value === 'object' && value !== null
    && 'step' in value && 'src' in value && typeof value.src === 'string';
}

function requireJessReferenceTail(value: unknown): JessReferenceTail {
  if (!isJessReferenceTail(value)) {
    throw new TypeError('Jess grammar produced an invalid reference tail.');
  }
  return value;
}

function requireKeyword(value: unknown): Keyword {
  if (!isValueNode(value) || value.type !== 'Keyword') {
    throw new TypeError('Jess grammar produced a non-keyword child.');
  }
  return value;
}

function staticSelectorText(selector: SelectorList): string {
  return selector.selectors.map(selectorBranchCanonical).join(', ');
}

function isMixinCallArray(value: unknown): value is MixinCall[] {
  return Array.isArray(value) && value.length > 0 && value.every(isMixinCall);
}

function isExtendInstructionArray(value: unknown): value is ExtendInstruction[] {
  return Array.isArray(value) && value.length > 0 && value.every(isExtendInstruction);
}

function isValueNode(value: unknown): value is ValueNode {
  return typeof value === 'object'
    && value !== null
    && 'type' in value

    /*
     * `Any` is verbatim authored text: the reduced form of a custom-property
     * value, which Jess never evaluates.
     */
    && (value.type === 'Any'
      || value.type === 'Keyword'
      || value.type === 'Null'
      || value.type === 'Quoted'
      || value.type === 'Lookup'
      || value.type === 'Reference'
      || value.type === 'Color'
      || value.type === 'Dimension'
      || value.type === 'SelectorCapture'
      || value.type === 'FunctionCall'
      || value.type === 'Operation'
      || value.type === 'Condition'
      || value.type === 'Interpolation'
      || value.type === 'Sequence'
      || value.type === 'List'
      || value.type === 'Block'
      || value.type === 'Expression'
      || value.type === 'Url'
      || value.type === 'AnonymousMixin'
      || value.type === 'Collection'
      || value.type === 'Range');
}

function isValueNodeArray(value: unknown): value is ValueNode[] {
  return Array.isArray(value) && value.every(isValueNode);
}

function requireValueSlot(value: unknown): ValueSlot {
  return isValueNodeArray(value) ? value : valueSlot(requireValueNode(value));
}

function isJessMixinCallArgument(value: unknown): value is JessMixinCallArgument {
  /* `name` is ALWAYS present — `undefined` is what positional means — so its
   * absence is a reduced-shape defect, not a positional argument. */
  return typeof value === 'object' && value !== null && 'value' in value && isJessValueSlotValue(value.value)
    && 'name' in value && (value.name === undefined || typeof value.name === 'string');
}

function requireValueNode(value: unknown): ValueNode {
  if (!isValueNode(value)) {
    throw new TypeError('Jess grammar produced a non-value child.');
  }
  return value;
}

function isInterpolationLiteral(part: InterpPart): part is { readonly lit: string } {
  return 'lit' in part;
}

function requireExpressionFact(value: unknown): ExpressionFact {
  if (typeof value !== 'object' || value === null || !('value' in value) || !('src' in value)
    || typeof value.src !== 'string' || !isValueNode(value.value)) {
    throw new TypeError('Jess grammar produced an invalid expression fact.');
  }
  return { value: value.value, src: value.src };
}

/*
 * An arithmetic/comparison operator boundary carries two facts: the operator
 * symbol itself and the exact authored bytes around it. They are identical for a
 * plain whitespace-flanked operator token, and differ only when the boundary
 * also carries a block comment, which the operator-boundary productions recognize
 * as grammar structure rather than trimming out of a token.
 */
function requireJessOperatorFact(value: unknown): JessOperatorFact {
  if (typeof value === 'object' && value !== null && 'value' in value && 'src' in value
    && typeof value.value === 'string' && typeof value.src === 'string') {
    return { value: value.value, src: value.src };
  }
  const token = requireToken(value);
  return { value: token.value.trim(), src: token.value };
}

function foldExpression(children: readonly unknown[]): ExpressionFact {
  let fact = requireExpressionFact(children[0]);
  for (let index = 1; index < children.length; index += 2) {
    const operator = requireJessOperatorFact(children[index]);
    const right = requireExpressionFact(children[index + 1]);
    fact = {
      value: operation(
        operator.value,
        fact.value,
        right.value,
        false,
        cssBaseMathOutsideParens(operator.value)
      ),
      src: `${fact.src}${operator.src}${right.src}`
    };
  }
  return fact;
}

/**
 * A {@link Lookup} name is `string | ValueNode` now that `@@indirect` is spelled
 * as a node-valued name; a literal name is its own spelling, a node-valued one
 * defers to the expression printer.
 */
function lookupNameSource(name: string | ValueNode): string {
  return typeof name === 'string' ? name : expressionSource(name);
}

function expressionSource(value: ValueNode): string {
  switch (value.type) {
    case 'Keyword': case 'Null': case 'Color': case 'Dimension': case 'Quoted': case 'Any': return value.src;
    case 'Lookup': return value.kind === 'var'
      ? `${value.scope === 'scoped' ? '^' : '$'}${lookupNameSource(value.name)}`
      : value.raw;
    case 'Reference': return value.raw;
    case 'Operation': return `${expressionSource(value.left)} ${value.operator} ${expressionSource(value.right)}`;
    case 'Expression': return `$(${referenceArgSource(value.value)})`;
    case 'Condition': return value.src;
    case 'Interpolation': return value.parts.map(part => 'lit' in part ? part.lit : expressionSource(part.ref)).join('');
    default: throw new TypeError(`Jess expression cannot preserve source for ${value.type}.`);
  }
}

/**
 * Fold one logical rung left-associatively (§4.5.5). The result is an
 * `Operation` carrying the word itself as its operator — the node that means
 * "return one of these operands, short-circuiting" — so the transpiled `.jess`
 * still reads `$a or $default` rather than a rewritten `$if` that duplicates
 * the operand and no direct author would write.
 */
function foldLogicalExpression(kind: 'and' | 'or', children: readonly unknown[]): ExpressionFact {
  const facts = children.filter(isExpressionFact);
  let fact = requireExpressionFact(facts[0]);
  for (let index = 1; index < facts.length; index += 1) {
    const right = facts[index]!;
    fact = {
      value: operation(kind, fact.value, right.value, false, cssBaseMathOutsideParens(kind)),
      src: `${fact.src} ${kind} ${right.src}`
    };
  }
  return fact;
}

function referenceBaseSource(value: ValueNode): string {
  switch (value.type) {
    case 'Lookup':
      if (value.kind === 'var') {
        return `${value.scope === 'scoped' ? '^' : '$'}${lookupNameSource(value.name)}`;
      }
      if (value.kind === 'entry') {
        return value.raw;
      }
      throw new TypeError(`Jess expression reference cannot start from ${value.type}.`);
    default: throw new TypeError(`Jess expression reference cannot start from ${value.type}.`);
  }
}

/** A member step is a `LookupStep` whose name is a literal — the old `DotLookup`. */
function isMemberStep(step: JessReferenceTail['step'] | undefined): boolean {
  return step?.type === 'LookupStep' && typeof step.name === 'string';
}

function declarationMemberReferenceFromVariableBase(
  base: Lookup,
  tails: readonly JessReferenceTail[]
): Reference | null {
  if (base.scope !== 'live' || base.name === 'type' || !isMemberStep(tails[0]?.step)) {
    return null;
  }

  /* The `$ns` the author wrote is the base's source: a failed member read reports there. */
  const span = sourceSpanOf(base);
  const root = declarationReference('$');
  return reference(
    span === undefined ? root : withSourceSpan(root, span),
    [
      lookupStep('member', base.name),
      ...tails.map(tail => tail.step)
    ],
    `$${lookupNameSource(base.name)}${tails.map(tail => tail.src).join('')}`
  );
}

function interpolationFromChildren(
  children: readonly unknown[],
  span?: { readonly start: number; readonly end: number }
): Interpolation {
  const first = requireToken(children[1]).value;
  if (first === '$') {
    const ref = variableReference(
      requireToken(children[2]).value,
      'live'
    );
    if (span) {
      withSourceSpan(
        ref,
        span
      );
    }
    return interpolation([{ ref: variableReference(
      ref,
      'live'
    ), unquote: true }]);
  }
  if (children.length === 3) {
    const ref = variableReference(
      first,
      'live'
    );
    if (span) {
      withSourceSpan(
        ref,
        span
      );
    }
    return interpolation([{ ref, unquote: true }]);
  }
  const text = first === '"' || first === '\'' ? requireToken(children[2]).value : first;
  return interpolation([{ ref: propertyReference(
    text,
    tokenSource(children)
  ), unquote: true }]);
}

/**
 * Reduce a `${…}` interpolation. BARE-vs-BRACKETED selects the namespace:
 *
 * - `${foo}`      → the VARIABLE `$foo`
 * - `${[foo]}`    → a LOOKUP, i.e. the PROPERTY `foo` declared in scope
 * - `${["a b"]}`  → the same lookup; the quotes are only escaping, because
 *                   `a b` is not a valid identifier. `[foo]` and `["foo"]` are
 *                   the same plain-string key (ledger P14), so quoting never
 *                   carries meaning here.
 * - `${[$k]}`     → a lookup whose key is computed from `$k`.
 */
function dollarBraceInterpolation(
  children: readonly unknown[],
  span?: { readonly start: number; readonly end: number }
): Interpolation {
  if (requireToken(children[1]).value !== '[') {
    const ref = variableReference(
      requireToken(children[1]).value,
      'live'
    );
    if (span) {
      withSourceSpan(
        ref,
        span
      );
    }
    return interpolation([{ ref, unquote: true }]);
  }
  const head = requireToken(children[2]).value;
  if (head === '$') {
    const named = variableReference(
      requireToken(children[3]).value,
      'live'
    );
    if (span) {
      withSourceSpan(
        named,
        span
      );
    }
    return interpolation([{ ref: variableReference(
      named,
      'live'
    ), unquote: true }]);
  }
  const name = head === '"' || head === '\'' ? requireToken(children[3]).value : head;
  return interpolation([{ ref: propertyReference(
    name,
    tokenSource(children)
  ), unquote: true }]);
}

/*
 * The authored-ish source of one reference-call argument, used only to rebuild a
 * `Reference.raw` fallback string. It never feeds recognition, and it never
 * throws: a value with no direct spelling contributes nothing rather than
 * failing the parse.
 */
function referenceArgSource(value: JessMixinCallArgument['value']): string {
  if (Array.isArray(value)) {
    return value.map(referenceArgSource).join(' ');
  }
  if (!isValueNode(value)) {
    return '';
  }
  switch (value.type) {
    case 'Keyword': case 'Null': case 'Color': case 'Dimension': case 'Quoted': case 'Any': return value.src;
    case 'Lookup': return value.kind === 'var'
      ? `${value.scope === 'scoped' ? '$^' : '$'}${lookupNameSource(value.name)}`
      : value.raw;
    case 'Reference': return value.raw;
    case 'FunctionCall': return `${value.name}(${value.args.map(arg => referenceArgSource(arg.value)).join(value.modern ? ' ' : ', ')})`;
    case 'Operation': case 'Condition': case 'Interpolation': return expressionSource(value);
    case 'Expression': return `$(${referenceArgSource(value.value)})`;
    case 'Block': return `${value.escaped === true ? '~' : ''}${value.delimiter === 'square' ? '[' : '('}${referenceArgSource(value.value)}${value.delimiter === 'square' ? ']' : ')'}`;
    case 'Sequence': return value.parts.map(referenceArgSource).join(' ');
    case 'List': return value.value.map(referenceArgSource).join(value.sep === ',' ? ', ' : ' / ');
    case 'Url': return `url(${referenceArgSource(value.value)})`;
    case 'SelectorCapture': return value.src;
    default: return '';
  }
}

function tokenSource(children: readonly unknown[]): string {
  return children.map(requireToken).map(token => token.value).join('');
}

function sourceFromState(state: unknown): string | undefined {
  return typeof state === 'object'
    && state !== null
    && 'source' in state
    && typeof state.source === 'string'
    ? state.source
    : undefined;
}

function interpolationValue(child: unknown): Interpolation {
  if (isInterpolation(child)) {
    return child;
  }
  const fact = requireExpressionFact(child);
  if (!isInterpolation(fact.value)) {
    throw new TypeError('Jess quoted expression produced a non-interpolation fact.');
  }
  return fact.value;
}

function quotedInterpolationFromChildren(children: readonly unknown[]): Quoted | Interpolation {
  const open = requireToken(children[0]);
  if (children.length === 3 && !isInterpolation(children[1])) {
    const content = requireToken(children[1]);
    return quoted(
      `${open.value}${content.value}${open.value}`,
      content.value,
      open.value,
      false
    );
  }
  const parts: Interpolation['parts'] = [{ lit: open.value }];
  for (const child of children.slice(
    1,
    -1
  )) {
    if (isInterpolation(child) || isExpressionFact(child)) {
      parts.push(...interpolationValue(child).parts);
    } else {
      parts.push({ lit: requireToken(child).value });
    }
  }
  parts.push({ lit: open.value });
  return interpolation(parts);
}

/*
 * `~"…"` drops its quotes, so an escaped string that carries interpolation is
 * exactly the Interpolation of its content — the `~` and both quote tokens are
 * authored escape syntax, not output bytes, and never become literal parts.
 */
function escapedInterpolationFromChildren(children: readonly unknown[]): Interpolation {
  const parts: Interpolation['parts'] = [];
  for (const child of children.slice(
    2,
    -1
  )) {
    if (isInterpolation(child)) {
      parts.push(...child.parts);
    } else {
      parts.push({ lit: requireToken(child).value });
    }
  }
  return interpolation(parts);
}

function quotedExpressionFact(children: readonly unknown[]): ExpressionFact {
  const value = quotedInterpolationFromChildren(children);
  const src = children.map(child =>
    isExpressionFact(child)
      ? requireExpressionFact(child).src
      : isInterpolation(child)
        ? (() => {
            throw new TypeError('Jess expression quote lost interpolation source.');
          })()
        : requireToken(child).value).join('');
  return { value, src };
}

function reduceColonFeature(children: readonly unknown[], lostMessage: string): ValueNode {
  const propertyName = children
    .filter(isToken)
    .map(requireToken)
    .find(token => token.value !== '(' && token.value !== ')' && token.value !== ':' && token.value.trim().length > 0)?.value;
  if (propertyName === undefined) {
    throw new TypeError(lostMessage);
  }
  const value = children.find(isValueNode);
  return value === undefined
    ? block(keyword(propertyName))
    : block(operation(
        ':',
        keyword(propertyName),
        value,
        false,
        cssBaseMathOutsideParens(':')
      ));
}

function jessFunctionOpenName(child: unknown): string {
  const value = requireToken(child).value;
  return value.endsWith('(') ? value.slice(0, -1) : value;
}

function requireStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (!isVarDeclaration(child) && !isMixinDefinition(child) && !isMixinCall(child) && !isApply(child) && !isReference(child) && !isRuleset(child) && !isFor(child) && !isIf(child) && !isWhile(child) && !isJessDeclaration(child) && !isStyleImport(child) && !isModuleImport(child) && !isAtRuleBlock(child) && !isAtRuleStatement(child) && !isUnknownAtRuleBlock(child)) {
      throw new TypeError('Jess grammar produced a non-statement child.');
    }
    statements.push(child);
  }
  return statements;
}

/*
 * Block bodies whose grammar admits array-producing arms (`$extend`) and a bare
 * `;` arm: flatten mixin-call arrays, drop other arrays and stray tokens.
 */
function collectBlockStatements(children: readonly unknown[], open: number): Statement[] {
  return requireStatements(children.slice(
    open,
    -1
  )
    .flatMap(child => isMixinCallArray(child) ? child : Array.isArray(child) ? [] : [child])
    .filter(child => !isToken(child)));
}

/*
 * Nested-scope bodies (mixin/for/if) whose grammar produces no array or bare
 * token arms other than mixin-call expansion: flatten mixin-call arrays only.
 */
function collectBodyStatements(children: readonly unknown[], open: number): Statement[] {
  return requireStatements(children.slice(
    open,
    -1
  )
    .flatMap(child => isMixinCallArray(child) ? child : [child]));
}

function requireStatementList(value: unknown): Statement[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Jess grammar produced a non-statement list.');
  }
  return requireStatements(value);
}

function isIfBranch(value: unknown): value is IfBranch {
  return typeof value === 'object' && value !== null
    && 'guard' in value && (value.guard === null || isGuardNodeOf(value.guard, isValueNode))
    && 'rules' in value && Array.isArray(value.rules);
}

function requireIfBranch(value: unknown): IfBranch {
  if (!isIfBranch(value)) {
    throw new TypeError('Jess grammar produced an invalid conditional branch.');
  }
  return { guard: value.guard, rules: requireStatementList(value.rules) };
}

function requireIfBranchArray(value: unknown): IfBranch[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Jess grammar produced an invalid conditional branch list.');
  }
  return value.map(requireIfBranch);
}

function requireIfBranchTuple(value: IfBranch[]): [IfBranch, ...IfBranch[]] {
  const first = value[0];
  if (first === undefined) {
    throw new TypeError('Jess grammar produced an empty conditional branch list.');
  }
  return [first, ...value.slice(1)];
}

function isApply(value: unknown): value is Apply {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Apply';
}

function isUrl(value: unknown): value is Url {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Url'
    && 'value' in value
    && isValueNode(value.value);
}

function urlFromChildren(children: readonly unknown[]): Url {
  if (children.length === 2) {
    return url(any(''));
  }
  const body = children[1];
  return isValueNode(body) ? url(body) : url(any(requireToken(body).value));
}

function requireLiteralQuoted(value: unknown): Quoted {
  if (!isQuoted(value)) {
    throw new TypeError('Jess module syntax requires a literal quoted path.');
  }
  return value;
}

function isJessDeclaration(value: unknown): value is Declaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Declaration'
    && 'name' in value
    && (typeof value.name === 'string' || isInterpolation(value.name))
    && 'value' in value
    && (isValueNode(value.value)
      || (Array.isArray(value.value) && value.value.every(isValueNode)));
}

function isCollectionItem(value: unknown): value is CollectionItem {
  if (typeof value !== 'object' || value === null || !('type' in value) || !('value' in value)) {
    return false;
  }
  if (value.type === 'CollectionSpread') {
    return isJessValueSlotValue(value.value);
  }
  return value.type === 'CollectionEntry'
    && 'key' in value
    && isJessValueSlotValue(value.key)
    && isJessValueSlotValue(value.value);
}

function requireExactToken(value: unknown, expected: string): void {
  if (requireToken(value).value !== expected) {
    throw new TypeError(`Jess grammar produced ${requireToken(value).value} where ${expected} was required.`);
  }
}

function isVarDeclaration(value: unknown): value is VariableDeclaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'VariableDeclaration'
    && 'name' in value
    && typeof value.name === 'string'
    && 'value' in value
    && isJessValueSlotValue(value.value);
}

/*
 * Shared guard reducers. `$if` and mixin guards recognize the same GuardNode
 * shapes through distinct combinator arms, so the logical and truth reductions
 * are identical and shared here. COMPARISON is the one rung where the two
 * positions genuinely differ (§4.2a) and it gets a reducer each, below.
 */
function reduceGuardTruth(children: readonly unknown[]): GuardNode {
  return { g: 'truth', value: requireExpressionFact(children[0]).value };
}

/*
 * The two comparison POSITIONS (§4.2a). `$if` asserts — a groundless relational
 * pair raises, because the author asked which value is greater and there is no
 * answer. A mixin `when` clause TESTS — a groundless pair means this definition
 * does not apply, which is an answer, and raising there would turn a non-match
 * into a hard compile stop. Same operands, same ground; only the verdict on a
 * groundless pair differs, so they are two `g` spellings over one shape rather
 * than one node plus an eval-time context read.
 */
function reduceIfCompare(children: readonly unknown[]): GuardNode {
  return {
    g: 'cmp',
    op: requireToken(children[1]).value.trim(),
    left: requireExpressionFact(children[0]).value,
    right: requireExpressionFact(children[2]).value
  };
}
function reduceGuardCompare(children: readonly unknown[]): GuardNode {
  return {
    g: 'match',
    op: requireToken(children[1]).value.trim(),
    left: requireExpressionFact(children[0]).value,
    right: requireExpressionFact(children[2]).value
  };
}
function reduceGuardAnd(children: readonly unknown[]): GuardNode {
  let result = requireGuardNode(children[0]);
  for (let index = 2; index < children.length; index += 2) {
    result = { g: 'and', left: result, right: requireGuardNode(children[index]) };
  }
  return result;
}
function reduceGuardOr(children: readonly unknown[]): GuardNode {
  let result = requireGuardNode(children[0]);
  for (let index = 2; index < children.length; index += 2) {
    result = { g: 'or', left: result, right: requireGuardNode(children[index]) };
  }
  return result;
}
function reduceVarDeclaration(children: readonly unknown[]): VariableDeclaration {
  const operatorIndex = children.findIndex(child => isToken(child)
    && (child.value === ':' || child.value === '?:' || child.value === ':=' || child.value === '::='));
  if (operatorIndex < 1) {
    throw new TypeError('Jess variable declaration lost its assignment operator.');
  }
  const operator = requireToken(children[operatorIndex]).value;
  const lookup = operatorIndex === 3 ? 'scoped' as const : 'live' as const;
  const write = operator === '?:'
    ? { mode: 'if-absent' as const, scope: lookup }
    : operator === ':='
      ? { mode: 'reassign' as const, scope: lookup }
      : operator === '::='
        ? { mode: 'reassign-or-declare' as const, scope: lookup }
        : { mode: 'declare' as const };
  return variableDeclaration(
    requireToken(children[operatorIndex - 1]).value,
    valueSlot(requireValueSlot(children[operatorIndex + 1])),
    write
  );
}

/*
 * Every block-bodied lambda spelling reduces the same way: an `AnonymousMixin`
 * over the body statements, carrying the declared params. The `params` field is
 * OMITTED for an empty list so the plain `@{ … }` block keeps the monomorphic
 * shape core's value paths already expect. The body span records where the
 * block's comments are, so a call replays them.
 */
function reduceLambda(
  children: readonly unknown[],
  _fields: unknown,
  _span: unknown,
  rawChildren: readonly unknown[]
): AnonymousMixin {
  const bodyOpen = children.findIndex(child => isToken(child) && child.value === '{');
  if (bodyOpen < 0) {
    throw new TypeError('Jess grammar produced a lambda without a body.');
  }
  const params = children.find(isParamArray) ?? [];
  return withBlockBody(anonymousMixin(
    collectBodyStatements(
      children,
      bodyOpen + 1
    ),
    params.length > 0 ? params : undefined
  ), rawChildren);
}

/*
 * Shared selector reducers. The static and dynamic selector families differ only
 * in their recognition arms (static excludes interpolation); the compound,
 * complex, tail, and list reductions are structurally identical.
 */
function reduceCompound(children: readonly unknown[]): SelectorTerm {
  return selectorTermFromTokens(children.filter(isSimpleToken));
}
function reduceSelectorTail(children: readonly unknown[]): SelectorBranch {
  return children.find(isSelectorBranch)!;
}
function reduceSelectorList(children: readonly unknown[]): SelectorList {
  return selist(...children.filter(isSelectorBranch));
}

/*
 * Operands and operator characters, in authored order, with the operators'
 * padding interleaved. The pads are their own terms, so an operator no longer
 * sits a constant distance from its operand and the fold reads the shape rather
 * than a fixed stride — and a pad can hold a comment whose own `/` and `*` would
 * defeat any attempt to recover the operator from the padded text.
 */
function dollarValueFromChildren(
  children: readonly unknown[],
  _fields: unknown,
  span: { readonly start: number; readonly end: number }
): ValueNode {
  const base = requireValueNode(children[0]);
  if (children.length === 1) {
    if (base.type !== 'Lookup' || base.kind !== 'var') {
      throw new TypeError('Jess reference base must be a variable reference.');
    }
    return base;
  }
  const rest = children.slice(1);
  if (base.type === 'Lookup' && base.kind === 'entry') {
    const name = requireToken(rest[0]).value;
    const tails = rest.slice(1).map(requireJessReferenceTail);
    return withSourceSpan(reference(
      base,
      [
        lookupStep('member', name),
        ...tails.map(tail => tail.step)
      ],
      `${base.raw}.${name}${tails.map(tail => tail.src).join('')}`
    ), span);
  }
  if (base.type !== 'Lookup' || base.kind !== 'var') {
    throw new TypeError('Jess reference base must be a variable reference.');
  }
  if (isJessReferenceTail(rest[0])) {
    const tails = rest.map(requireJessReferenceTail);
    const memberReference = declarationMemberReferenceFromVariableBase(base, tails);
    return withSourceSpan(memberReference ?? reference(
      base,
      tails.map(tail => tail.step),
      `${base.scope === 'scoped' ? '$^' : '$'}${lookupNameSource(base.name)}${tails.map(tail => tail.src).join('')}`
    ), span);
  }
  if (rest.some(child => isToken(child) && child.value === '/')) {
    return list(
      [base, requireValueNode(rest.at(-1))],
      '/'
    );
  }
  throw new TypeError('Jess dollar value matched an unknown continuation.');
}

function foldCalcOperation(children: readonly unknown[]): ValueNode {
  const first = children.find(isValueNode);
  if (first === undefined) {
    throw new TypeError('Jess calc grammar requires an operand.');
  }
  let result = first;
  let operator: string | undefined;
  for (let index = children.indexOf(first) + 1; index < children.length; index += 1) {
    const child = children[index];
    if (isValueNode(child)) {
      if (operator === undefined) {
        throw new TypeError('Jess calc grammar lost an operator operand.');
      }

      /*
       * `inMathFunction` is TRUE for every pair this fold builds: the ladder is
       * reachable only from a css-values-4 §10 math function, so an operation
       * arriving here was AUTHORED inside one. The flag records that positional
       * fact and nothing more — whether it then folds is decided downstream,
       * together with `unitMode` and `mathMode`.
       */
      result = operation(
        operator,
        result,
        child,
        true,
        cssBaseMathOutsideParens(operator)
      );
      operator = undefined;
      continue;
    }
    if (child === undefined || child === null) {
      continue;
    }
    const text = requireToken(child).value;
    if (isMathOperator(text)) {
      operator = text;
    }
  }
  if (operator !== undefined) {
    throw new TypeError('Jess calc grammar lost an operator operand.');
  }
  return result;
}

export {
  requireToken,
  requireFields,
  jessCombinator,
  jessRelativeCombinator,
  isExpressionFact,
  isJessAtRuleHeader,
  requireJessAtRuleHeader,
  isAtRuleNameToken,
  isJessReferenceTail,
  requireSelectorList,
  requireJessReferenceTail,
  requireString,
  requireInterpolation,
  requireKeyword,
  staticSelectorText,
  isMixinCallArray,
  isExtendInstructionArray,
  isValueNode,
  isValueNodeArray,
  isJessValueSlotValue,
  requireValueSlot,
  isJessMixinCallArgument,
  requireValueNode,
  requireGuardNode,
  isInterpolationLiteral,
  interpolationFromTemplateChildren,
  appendCustomValueParts,
  customValueFromChildren,
  requireExpressionFact,
  requireJessOperatorFact,
  foldExpression,
  lookupNameSource,
  expressionSource,
  foldLogicalExpression,
  referenceBaseSource,
  isMemberStep,
  declarationMemberReferenceFromVariableBase,
  interpolationFromChildren,
  dollarBraceInterpolation,
  referenceArgSource,
  tokenSource,
  sourceFromState,
  interpolationValue,
  quotedInterpolationFromChildren,
  escapedInterpolationFromChildren,
  quotedExpressionFact,
  reduceColonFeature,
  jessFunctionOpenName,
  requireStatements,
  collectBlockStatements,
  collectBodyStatements,
  requireStatementList,
  isIfBranch,
  requireIfBranch,
  requireIfBranchArray,
  requireIfBranchTuple,
  requireForBinding,
  isApply,
  isUrl,
  urlFromChildren,
  requireLiteralQuoted,
  isJessDeclaration,
  isCollectionItem,
  requireExactToken,
  isVarDeclaration,
  reduceGuardTruth,
  reduceIfCompare,
  reduceGuardCompare,
  reduceGuardAnd,
  reduceGuardOr,
  reduceVarDeclaration,
  reduceLambda,
  reduceCompound,
  reduceSelectorTail,
  reduceSelectorList,
  dollarValueFromChildren,
  foldCalcOperation
};

export type {
  ExpressionFact,
  JessOperatorFact,
  JessReferenceTail,
  JessComplexTail,
  JessQueryFeatureName,
  JessAtRuleHeader,
  JessMixinCallArgument
};
