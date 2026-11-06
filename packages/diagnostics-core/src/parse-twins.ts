import { ERR, PROGID_IE_SYNTAX, makeJessError, invalidValuePunctuation, invalidValueSyntaxError, nameArguments, nameValueIeSyntax, type InvalidValueSyntax } from '@jesscss/core';
import type { CssCstNode } from '@jesscss/css-parser/cst-host';
import {
  CUSTOM_DECLARATION_TYPES,
  CUSTOM_PROPERTY_VALUE_TYPES,
  DECLARATION_TYPES,
  FUNCTION_TYPES,
  RULESET_TYPES,
  absoluteEnd,
  absoluteStart,
  cstChildrenOf,
  isCstNode
} from './cst-node.js';
import type { JessLanguage } from './types.js';

/** Reports one parse-phase diagnostic at a CST span. */
type ParseTwinPusher = (
  code: string,
  severity: 'error' | 'warning',
  message: string,
  span: CssCstNode['span'],
  details: { readonly phase: 'parse'; readonly reason: string; readonly fix: string }
) => void;

/*
 * Legacy IE syntax and invalid value punctuation, read from the CST: the
 * editor twin of the compiler's declaration check (`invalidValueSyntaxIn`,
 * `@jesscss/core`). A declaration value is read as a flat run of atoms — an
 * identifier, a delim, a call, a paren group, a `,` / `;` / `:` separator, or
 * any other value — through the containers each dialect nests them in, so the
 * forms read the same in all four CSTs: `progid` then a `:` delim; a call
 * argument that is exactly an identifier, an `=` delim and one value; and a
 * delim holding `.`, `~`, `=`, `|`, `^`, `?`, `:`, `<`, `>`, `$`, `%` or `&`.
 *
 * What the compiler does not enter is not read here either: a custom
 * property, a string, an interpolation, the name argument of a `var()` /
 * `env()` / `attr()` call (its fallback is a value),
 * a branch condition (the part of a call argument before its `:`), and a Less
 * or SCSS condition — a comparison, Less's `boolean()` / `not()` / `and()` /
 * `or()`, SCSS's `not(…)` and the first argument of a Less or SCSS `if()`. An
 * SCSS nested property is read part by part. A Less comparison
 * Less gives no meaning (a chain `a=b=c`, or `a==b`) is a run: its operators
 * are delims.
 */
type ValueAtom =
  | { readonly kind: 'ident' | 'delim' | 'comparison'; readonly text: string }
  | { readonly kind: 'call' | 'group'; readonly node: CssCstNode }
  | { readonly kind: 'comma' | 'semicolon' | 'colon' | 'other' };

const COMMA: ValueAtom = { kind: 'comma' };
const SEMICOLON: ValueAtom = { kind: 'semicolon' };
const COLON: ValueAtom = { kind: 'colon' };
const OTHER: ValueAtom = { kind: 'other' };
const IDENT_TYPES = new Set(['Keyword', 'KeywordOrInterpolatedValue', 'Identifier']);
const DELIM_TYPES = new Set(['DeclarationAny', 'VarFallbackPunctuation']);
const OPAQUE_TYPES = new Set([
  ...DECLARATION_TYPES,
  ...CUSTOM_DECLARATION_TYPES,
  ...CUSTOM_PROPERTY_VALUE_TYPES,
  ...RULESET_TYPES,
  'CustomValue',
  'Quoted',
  'Interpolation',
  'InterpolatedValue'
]);

/* Less's guard comparison operators (`guardOperatorText` in the Less grammar). */
const LESS_COMPARISONS = new Set(['>', '<', '>=', '<=', '=>', '=<', '=', '=~']);

/*
 * A Less paren group's operator: the whole delim run at that point, as the
 * grammar's `functionConditionOperator` reads it (`<`, `>` and `=`, with a
 * `~` only after a final `=`). Only a Less spelling compares; any other
 * (`==`, `<>`) is a delim.
 */
function isLessOperatorRun(text: string): boolean {
  const run = text.endsWith('=~') ? text.slice(0, -1) : text;
  return run !== '' && [...run].every(char => char === '<' || char === '>' || char === '=');
}

function valueAtoms(node: CssCstNode, language: JessLanguage, source: string, out: ValueAtom[]): ValueAtom[] {
  for (const child of cstChildrenOf(node)) {
    if (child._tag === 'leaf') {
      const text = source.slice(Number(child.span.start), Number(child.span.end)).trim();
      if (text === ',') {
        out.push(COMMA);
      } else if (text === ';') {
        out.push(SEMICOLON);
      } else if (text === ':') {
        out.push(COLON);
      } else if (language === 'less' && isLessOperatorRun(text)) {
        out.push(LESS_COMPARISONS.has(text) ? { kind: 'comparison', text } : { kind: 'delim', text });
      }
      continue;
    }
    if (!isCstNode(child)) {
      continue;
    }
    const gt = child.grammarType;
    const children = cstChildrenOf(child);
    if (language === 'less' && gt === 'FunctionCondition') {
      lessConditionAtoms(child, source, out);
    } else if (FUNCTION_TYPES.has(gt)) {
      out.push({ kind: 'call', node: child });
    } else if (OPAQUE_TYPES.has(gt) || (language === 'scss' && children.some(isScssNot))) {
      out.push(OTHER);
    } else if (children.some(grandchild => grandchild._tag === 'leaf' && grandchild.value === '(')) {
      out.push({ kind: 'group', node: child });
    } else if (children.some(isCstNode)) {
      valueAtoms(child, language, source, out);
    } else if (IDENT_TYPES.has(gt) || DELIM_TYPES.has(gt)) {
      out.push({ kind: IDENT_TYPES.has(gt) ? 'ident' : 'delim', text: source.slice(absoluteStart(child), absoluteEnd(child)) });
    } else {
      out.push(OTHER);
    }
  }
  return out;
}

/* SCSS's `not` operator: what it applies to is SCSS's condition. */
function isScssNot(child: CssCstNode['rules'][number]): boolean {
  return child._tag === 'leaf' && child.value.trim().toLowerCase() === 'not';
}

/*
 * A Less call argument's condition: one comparison, `not`, a group and an
 * `and` / `or` are Less's condition; a single term Less gives no comparison
 * meaning (more than one operator, or one Less does not spell) is the run of
 * its operands with its operators as delims.
 */
function lessConditionAtoms(node: CssCstNode, source: string, out: ValueAtom[]): void {
  let term: CssCstNode | undefined = node;
  for (const kind of ['FunctionConditionOr', 'FunctionConditionAnd', 'FunctionConditionTerm']) {
    const nodes: CssCstNode[] = cstChildrenOf(term).filter(isCstNode);
    term = nodes.length === 1 && nodes[0]!.grammarType === kind && cstChildrenOf(term).length === 1 ? nodes[0] : undefined;
    if (term === undefined) {
      out.push(OTHER);
      return;
    }
  }
  const children = cstChildrenOf(term);
  const operators: string[] = [];
  for (const child of children) {
    if (child._tag === 'leaf') {
      const operator = source.slice(Number(child.span.start), Number(child.span.end)).trim();
      if (operator.toLowerCase() === 'not') {
        out.push(OTHER);
        return;
      }
      operators.push(operator);
    } else if (isCstNode(child) && child.grammarType !== 'FunctionConditionOperand') {
      out.push(OTHER);
      return;
    }
  }
  const atoms: ValueAtom[] = [];
  for (const child of children) {
    if (child._tag === 'leaf') {
      atoms.push({ kind: 'delim', text: source.slice(Number(child.span.start), Number(child.span.end)).trim() });
    } else if (isCstNode(child)) {
      valueAtoms(child, 'less', source, atoms);
    }
  }
  const operandDelims = atoms.filter(atom => atom.kind === 'delim').length > operators.length;
  if (operators.length === 0 || (operators.length === 1 && LESS_COMPARISONS.has(operators[0]!) && !operandDelims)) {
    out.push(OTHER);
    return;
  }
  out.push(...atoms);
}

function isAtom(atom: ValueAtom | undefined, kind: 'ident' | 'delim', text?: string): atom is { kind: 'ident' | 'delim'; text: string } {
  return atom?.kind === kind && (text === undefined || ('text' in atom && atom.text === text));
}

function callNameOf(node: CssCstNode, source: string): string {
  const start = absoluteStart(node);
  const open = source.indexOf('(', start);
  return open === -1 || open > absoluteEnd(node) ? '' : source.slice(start, open).trim().toLowerCase();
}

/*
 * How many leading arguments of a call are a dialect condition: the first of a
 * lowered `if()`, or every one of Less's `boolean()` / `not()` / `and()` /
 * `or()`.
 */
function conditionArguments(name: string, args: number, language: JessLanguage): number {
  if (language === 'less') {
    if (name === 'and' || name === 'or' || ((name === 'boolean' || name === 'not') && args === 1)) {
      return args;
    }
    return name === 'if' && args >= 2 && args <= 3 ? 1 : 0;
  }
  return language === 'scss' && name === 'if' && args === 3 ? 1 : 0;
}

function better(found: InvalidValueSyntax | undefined, next: InvalidValueSyntax | undefined): InvalidValueSyntax | undefined {
  return found === undefined || next?.code === 'css/legacy-ie-syntax' ? next ?? found : found;
}

function invalidValueSyntaxInAtoms(atoms: readonly ValueAtom[], language: JessLanguage, source: string): InvalidValueSyntax | undefined {
  let found: InvalidValueSyntax | undefined;
  const run = isComparisonRun(atoms);
  for (let i = 0; i < atoms.length && found?.code !== 'css/legacy-ie-syntax'; i++) {
    const atom = atoms[i]!;
    if (isAtom(atom, 'ident') && atom.text.toLowerCase() === 'progid' && isAtom(atoms[i + 1], 'delim', ':')) {
      return PROGID_IE_SYNTAX;
    }
    if (atom.kind === 'delim' || (run && atom.kind === 'comparison')) {
      found = better(found, invalidValuePunctuation(atom.text));
    } else if (atom.kind === 'group') {
      found = better(found, invalidValueSyntaxInAtoms(valueAtoms(atom.node, language, source, []), language, source));
    } else if (atom.kind === 'call') {
      found = better(found, invalidValueSyntaxInCall(atom.node, language, source));
    }
  }
  return found;
}

/*
 * A Less paren group's comparison is Less's when it is one comparison of two
 * plain values; a chain, or a side holding a delim, is the CSS run it is, its
 * operators delims (ledger N18), as the compiler reads it.
 */
function isComparisonRun(atoms: readonly ValueAtom[]): boolean {
  const comparisons = atoms.filter(atom => atom.kind === 'comparison').length;
  return comparisons > 1 || (comparisons === 1 && atoms.some(atom => atom.kind === 'delim'));
}

function invalidValueSyntaxInCall(node: CssCstNode, language: JessLanguage, source: string): InvalidValueSyntax | undefined {
  const name = callNameOf(node, source);
  const names = nameArguments(name);
  const inner = valueAtoms(node, language, source, []);
  const conditions = conditionArguments(name, inner.filter(atom => atom.kind === 'comma').length + 1, language);
  let found: InvalidValueSyntax | undefined;
  let from = 0;
  let index = 0;
  for (let at = 0; at <= inner.length && found?.code !== 'css/legacy-ie-syntax'; at++) {
    if (at < inner.length && inner[at]!.kind !== 'comma') {
      continue;
    }
    const arg = index === 0 ? branchColon(inner.slice(from, at)) : fallbackColon(inner.slice(from, at), name, language);
    const head = arg[0];
    if (conditions === 0 && index >= names && arg.length === 3 && isAtom(head, 'ident') && isAtom(arg[1], 'delim', '=')) {
      return nameValueIeSyntax(head.text);
    }
    if (index >= names + conditions) {
      found = better(found, invalidValueSyntaxInAtoms(branchValues(arg), language, source));
    }
    from = at + 1;
    index++;
  }
  return found;
}

/*
 * An SCSS nested property, read as the compiler reads its parts: each member
 * in order, a nested one depth-first. The compiler reports a part at the
 * outermost declaration, so only the outermost reports (`inDeclaration` is
 * false there).
 */
function invalidValueSyntaxInNestedProperty(node: CssCstNode, language: JessLanguage, source: string): InvalidValueSyntax | undefined {
  for (const child of cstChildrenOf(node)) {
    if (!isCstNode(child)) {
      continue;
    }
    const nested = child.grammarType === 'NestedPropertyMember'
      ? cstChildrenOf(child).find(member => isCstNode(member) && member.grammarType === 'NestedPropertyDeclaration')
      : undefined;
    const found = nested !== undefined && isCstNode(nested)
      ? invalidValueSyntaxInNestedProperty(nested, language, source)
      : invalidValueSyntaxInAtoms(valueAtoms(child, language, source, []), language, source);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/*
 * A first argument's `:` delim after its first atom is its branch colon (ledger
 * P38, in every dialect), where the dialect does not yet build the branch
 * (`.jess`, jess#297).
 */
function branchColon(arg: ValueAtom[]): ValueAtom[] {
  for (let i = 1; i < arg.length; i++) {
    if (isAtom(arg[i], 'delim', ':')) {
      arg[i] = COLON;
      break;
    }
  }
  return arg;
}

/*
 * An SCSS `var()`, `env()` or `attr()` fallback is a value: a `:` after a name
 * there is no keyword argument's (only a `$` variable names one) but css's
 * delim, as the compiler reads it (`var(--x, a:b)`).
 */
const FALLBACK_CALLS = new Set(['var', 'env', 'attr']);

function fallbackColon(arg: ValueAtom[], name: string, language: JessLanguage): ValueAtom[] {
  if (language !== 'scss' || !FALLBACK_CALLS.has(name)) {
    return arg;
  }
  for (let i = 1; i < arg.length; i++) {
    if (arg[i]!.kind === 'colon' && arg[i - 1]!.kind === 'ident') {
      arg[i] = { kind: 'delim', text: ':' };
    }
  }
  return arg;
}

/* An argument without its branch conditions: in each `;` group, what comes before a `:`. */
function branchValues(arg: readonly ValueAtom[]): readonly ValueAtom[] {
  if (!arg.some(atom => atom.kind === 'colon')) {
    return arg;
  }
  const values: ValueAtom[] = [];
  let group: ValueAtom[] = [];
  for (const atom of [...arg, SEMICOLON]) {
    if (atom.kind === 'colon') {
      group = [];
    } else if (atom.kind === 'semicolon') {
      values.push(...group, SEMICOLON);
      group = [];
    } else {
      group.push(atom);
    }
  }
  return values;
}

/**
 * The editor twins of errors the compiler raises on a parsed shape: reported
 * from the tolerant CST node, so the rest of the document keeps its
 * diagnostics.
 */
export function pushParseTwinDiagnostics(
  node: CssCstNode,
  language: JessLanguage,
  source: string,
  inDeclaration: boolean,
  push: ParseTwinPusher
): void {
  const gt = node.grammarType;
  pushSelectorCaptureTwin(node, language, source, push);
  pushForgivenSelectorItemTwin(node, source, push);
  if (SUPPORTS_BLOCK_TYPES.has(gt)) {
    pushInvalidSupportsConditionTwin(node, source, push);
  } else if (gt === 'ImportStatement') {
    pushInvalidImportSupportsTwin(node, source, push);
  }

  /*
   * Less v5 removes executable backtick values, but the tolerant CST keeps the
   * complete legacy construct as one node. Report from that node so editors
   * underline exactly the removed expression and retain the rest of the tree.
   * The compiler's strict AST entry throws the matching parser error before
   * evaluation; this path is the non-halting editor/diagnostic twin.
   */
  if (language === 'less' && gt === 'BacktickJavaScript') {
    push(
      'parse/unsupported-inline-javascript',
      'error',
      'Inline JavaScript was removed in Less v5. Move it to a module loaded with @use.',
      node.span,
      {
        phase: 'parse',
        reason: 'Backtick JavaScript expressions cannot be enabled or evaluated.',
        fix: 'Move it to a module loaded with @use.'
      }
    );
  }

  /* Legacy IE syntax and invalid value punctuation: the compiler fails at the declaration, so the editor underlines the declaration. */
  const found = DECLARATION_TYPES.has(gt) && !source.startsWith('--', absoluteStart(node))
    ? invalidValueSyntaxInAtoms(valueAtoms(node, language, source, []), language, source)
    : gt === 'NestedPropertyDeclaration' && !inDeclaration ? invalidValueSyntaxInNestedProperty(node, language, source) : undefined;
  if (found !== undefined) {
    const error = invalidValueSyntaxError(found, { meta: { what: found.what, fix: found.fix } });
    push(found.code, 'error', error.message, node.span, {
      phase: 'parse',
      reason: error.reason,
      fix: error.fix
    });
  }

  /*
   * Shapes the strict AST rejects by name — a separator-led value (ledger P33)
   * and a Less uncalled mixin reference (rejected today; ruling OPEN under
   * P33) — are kept as nodes in the tolerant CST, so their twin is reported
   * from the node.
   */
  if ((language === 'scss' || language === 'jess') && gt === 'LeadingSeparatorValue') {
    const lead = cstChildrenOf(node)[0];
    const error = ERR.leadingSeparatorValue(lead?._tag === 'leaf' && lead.value === '/' ? '/' : '*');
    push('parse/leading-separator-value', 'error', error.message, node.span, { phase: 'parse', reason: error.reason, fix: error.fix });
  }
  if (language === 'jess' && gt === 'Stylesheet') {
    pushBareArithmeticTwins(node, source, push);
  }

  /* Less keeps its own text for a separator-led value until its parser takes the shared one. */
  if (language === 'less' && gt === 'LeadingSeparatorValue') {
    const lead = cstChildrenOf(node)[0];
    const slash = lead?._tag === 'leaf' && lead.value === '/';
    push(
      'parse/leading-separator-value',
      'error',
      `A Less value cannot start with "${slash ? '/' : '*'}".`,
      node.span,
      {
        phase: 'parse',
        reason: slash
          ? 'A slash separates two values, so it needs a value before it. A path is a value only inside url() or a string.'
          : 'A `*` multiplies two values, so it needs a value before it.',
        fix: slash
          ? 'Write the path as url(/path) or as an escaped string such as ~"/path".'
          : 'Write the value it multiplies before it, or remove it.'
      }
    );
  }
  if (language === 'less' && gt === 'UncalledMixinReference') {
    const name = source.slice(absoluteStart(node), absoluteEnd(node));
    push(
      'parse/uncalled-mixin-reference',
      'error',
      'A mixin reference is not a value.',
      node.span,
      {
        phase: 'parse',
        reason: 'In a value, a mixin reference must be called or looked up; on its own it has no value.',
        fix: `Call it as ${name}() to use its result, or write ~"${name}" to keep it as text.`
      }
    );
  }
  if (language === 'less' && gt === 'MixinReferenceImportant') {
    const error = makeJessError({ code: 'parse/important-on-mixin-reference', phase: 'parse' });
    push(error.code, 'error', error.message, node.span, { phase: 'parse', reason: error.reason, fix: error.fix });
  }
}

/* The at-rules whose prelude is a `SupportsPrelude` (css and SCSS, Less, `.jess`). */
const SUPPORTS_BLOCK_TYPES = new Set(['QueryAtRuleBlock', 'SupportsBlock', 'SupportsAtRuleBlock']);

/* A CST child's authored text. */
function childText(child: CssCstNode['children'][number], source: string): string {
  return source.slice(Number(child.span.start), Number(child.span.end));
}

/*
 * The identifier a supports condition term reads as an operand: a
 * `SupportsInParens` that opens with an identifier (`selector (a)`, `color`),
 * or any term that is no `SupportsInParens` (a connective out of place).
 */
function operandIdentifier(term: CssCstNode['children'][number], source: string): string | undefined {
  if (term._tag !== 'node' || term.grammarType !== 'SupportsInParens') {
    return childText(term, source);
  }
  const head = cstChildrenOf(term)[0];
  return head?._tag === 'node' && head.grammarType === 'Keyword' ? childText(head, source) : undefined;
}

/*
 * The CST twin of the compiler's `@supports` prelude check
 * (`checkedSupportsPrelude`, `@jesscss/core`; owner 2026-10-22): one
 * condition, `not` and one operand or operands joined by one of `and` / `or`,
 * and the first identifier out of place, or the `,` of a list.
 */
function strayIdentifierIn(prelude: CssCstNode, source: string): string | undefined {
  const conditions = cstChildrenOf(prelude).filter(child => child._tag === 'node');
  if (conditions.length !== 1) {
    return ',';
  }
  return strayIdentifierInCondition(conditions[0]!, source);
}

function strayIdentifierInCondition(condition: CssCstNode, source: string): string | undefined {
  const terms = cstChildrenOf(condition);
  const head = terms[0];
  const first = terms.length === 2 && head !== undefined && !(head._tag === 'node' && head.grammarType === 'SupportsInParens') && childText(head, source).toLowerCase() === 'not' ? 1 : 0;
  let connective: string | undefined;
  for (let index = first; index < terms.length; index++) {
    const term = terms[index]!;
    if ((index - first) % 2 === 0) {
      const name = operandIdentifier(term, source);
      if (name !== undefined) {
        return name;
      }
      continue;
    }
    const name = childText(term, source).toLowerCase();
    if ((name !== 'and' && name !== 'or') || (connective !== undefined && connective !== name)) {
      return childText(term, source);
    }
    connective = name;
  }
  return (terms.length - first) % 2 === 0 ? childText(terms[terms.length - 1]!, source) : undefined;
}

/* The editor twin of `css/invalid-supports-condition`, at the at-rule, where the compiler reports it. */
function pushInvalidSupportsConditionTwin(node: CssCstNode, source: string, push: ParseTwinPusher): void {
  const prelude = cstChildrenOf(node)[1];
  if (prelude?._tag !== 'node' || prelude.grammarType !== 'SupportsPrelude') {
    return;
  }
  pushInvalidSupportsCondition(node, strayIdentifierIn(prelude, source), push);
}

/*
 * The same twin for a CSS `@import`'s `supports(…)` condition, which only
 * SCSS structures (`ImportTail` > `ImportQualifier` > `ImportSupports`), at
 * the import, where the compiler reports it (`checkedImportTarget`).
 */
function pushInvalidImportSupportsTwin(node: CssCstNode, source: string, push: ParseTwinPusher): void {
  const tail = cstChildrenOf(node).find(child => child._tag === 'node' && child.grammarType === 'ImportTail');
  const qualifier = tail?._tag === 'node' ? cstChildrenOf(tail)[0] : undefined;
  if (qualifier?._tag !== 'node' || qualifier.grammarType !== 'ImportQualifier') {
    return;
  }
  for (const supports of cstChildrenOf(qualifier)) {
    if (supports._tag !== 'node' || supports.grammarType !== 'ImportSupports') {
      continue;
    }
    const condition = cstChildrenOf(supports).find(child => child._tag === 'node' && child.grammarType === 'SupportsCondition');
    if (condition?._tag === 'node') {
      pushInvalidSupportsCondition(node, strayIdentifierInCondition(condition, source), push);
    }
  }
}

function pushInvalidSupportsCondition(node: CssCstNode, what: string | undefined, push: ParseTwinPusher): void {
  if (what !== undefined) {
    const error = ERR.invalidSupportsCondition({ meta: { what } });
    push('css/invalid-supports-condition', 'error', error.message, node.span, { phase: 'parse', reason: error.reason, fix: error.fix });
  }
}

/*
 * A `:is()` / `:where()` item that is not a selector (Selectors 4 §16.1, owner
 * 2026-10-20), in every dialect: the compiler keeps it as written and warns
 * (`forgivingSelectorItem`, `@jesscss/core`); the editor underlines the item.
 * An item is kept when it has a rest past its selector, when its selector opens
 * with a combinator, or when it is empty beside another item.
 */
function pushForgivenSelectorItemTwin(node: CssCstNode, source: string, push: ParseTwinPusher): void {
  if (node.grammarType !== 'ForgivingSelectorList') {
    return;
  }
  const items = cstChildrenOf(node).filter(child => isCstNode(child) && child.grammarType === 'ForgivingSelectorItem').filter(isCstNode);
  for (const item of items) {
    const parts = cstChildrenOf(item).filter(isCstNode);
    const selector = parts[0]?.grammarType === 'RelativeSelector' ? parts[0] : undefined;
    const relative = selector !== undefined && cstChildrenOf(selector)[0]?._tag === 'leaf';
    const kept = parts.some(part => part.grammarType === 'ForgivingSelectorRest') || relative || (parts.length === 0 && items.length > 1);
    if (!kept) {
      continue;
    }
    const at = trimmedSpan(item, source);
    const written = source.slice(at.start, at.end);
    const warning = makeJessError({ severity: 'warn', code: 'css/forgiving-selector-item', phase: 'parse', meta: { item: written === '' ? 'An empty item' : `\`${written}\`` } });
    push('css/forgiving-selector-item', 'warning', warning.message, at, { phase: 'parse', reason: warning.reason, fix: warning.fix });
  }
}

/* A CST node's span without the CSS whitespace at its edges (css-syntax-3 §4.2; U+00A0 is not whitespace there). */
function trimmedSpan(node: CssCstNode, source: string): { start: number; end: number } {
  const written = source.slice(absoluteStart(node), absoluteEnd(node));
  const unled = written.replace(/^[ \t\n\r\f]+/u, '');
  const start = absoluteStart(node) + written.length - unled.length;
  return { start, end: start + unled.replace(/[ \t\n\r\f]+$/u, '').length };
}

/*
 * Selector capture (ledger P49), `.less` and `.jess` only: a `selector(…)` whose
 * argument is not a selector list parses as its own CST node, and the compiler
 * fails on it; the editor underlines the argument.
 */
/* A CST operand `$( … )` would compute with: a number or a variable. */
const ARITHMETIC_OPERAND_TYPES = new Set(['Num', 'Dimension', 'Percentage', 'DollarValue']);

/* The operand a run component holds, through its one-child `ValueTerm` / `ValueAtom` wrappers. */
function isArithmeticOperand(node: CssCstNode | undefined): boolean {
  let current = node;
  while (current !== undefined && (current.grammarType === 'ValueTerm' || current.grammarType === 'ValueAtom')) {
    const nodes = cstChildrenOf(current).filter(isCstNode);
    current = nodes.length === 1 ? nodes[0] : undefined;
  }
  return current !== undefined && ARITHMETIC_OPERAND_TYPES.has(current.grammarType);
}

/* What the compiler does not check for arithmetic: a group or a function's arguments (ledger P18(a)), and text it does not read as a run. */
const NOT_ARITHMETIC_TYPES = new Set(['ParenValue', 'SquareValue', 'CallComponent', 'CallArgument', 'VarCall', 'CustomDeclaration']);

/*
 * `.jess` arithmetic outside `$( … )` (ledger P17): the compiler's error at a
 * `*` between two numbers or variables at a value's top level (not in a
 * group or a function's arguments), reported at the `*`. Read once, from the
 * document root.
 */
function pushBareArithmeticTwins(root: CssCstNode, source: string, push: ParseTwinPusher): void {
  const error = ERR.arithmeticOutsideExpression();
  const stack: CssCstNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const parts = cstChildrenOf(node).filter(isCstNode);
    if (node.grammarType === 'ValueSpaceGroup') {
      parts.forEach((part, index) => {
        if (part.grammarType === 'DeclarationAny' && source.slice(absoluteStart(part), absoluteEnd(part)) === '*'
          && isArithmeticOperand(parts[index - 1]) && isArithmeticOperand(parts[index + 1])) {
          push('parse/arithmetic-outside-expression', 'error', error.message, part.span, { phase: 'parse', reason: error.reason, fix: error.fix });
        }
      });
    }
    for (const part of parts) {
      if (!NOT_ARITHMETIC_TYPES.has(part.grammarType)) {
        stack.push(part);
      }
    }
  }
}

function pushSelectorCaptureTwin(
  node: CssCstNode,
  language: JessLanguage,
  source: string,
  push: ParseTwinPusher
): void {
  if (language !== 'less' && language !== 'jess') {
    return;
  }
  if (node.grammarType !== 'SelectorCapture') {
    return;
  }
  const problem = firstSelectorCaptureProblem(node, source);
  if (problem === undefined && cstChildrenOf(node).some(isCstNode)) {
    return;
  }

  /*
   * The first argument the capture, or a selector pseudo in it, could not read
   * as a selector list, as the compiler reports it; the whole call when the
   * argument holds nothing, the whole pseudo when its argument does.
   */
  const error = ERR.selectorCaptureArgument();
  const at = problem === undefined
    ? node.span
    : problem.grammarType === 'InvalidSelectorCaptureArgument'
      ? { ...problem.span, end: absoluteStart(problem) + source.slice(absoluteStart(problem), absoluteEnd(problem)).trimEnd().length }
      : problem.grammarType === 'ForgivingSelectorItem' ? trimmedSpan(problem, source) : problem.span;
  push('parse/selector-capture-argument', 'error', error.message, at, { phase: 'parse', reason: error.reason, fix: error.fix });
}

/*
 * In source order, the first rest a capture's selector list could not read,
 * or the first selector pseudo in it whose parens hold no node (`:is()`, or
 * a comment alone, which only a capture reads; a bare `:hover` has no parens).
 */
function firstSelectorCaptureProblem(capture: CssCstNode, source: string): CssCstNode | undefined {
  const stack = cstChildrenOf(capture).filter(isCstNode).reverse();
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    const children = cstChildrenOf(node).filter(isCstNode);
    if (node.grammarType === 'InvalidSelectorCaptureArgument' || (
      node.grammarType === 'PseudoSelector' && children.length === 0 && source.charAt(absoluteEnd(node) - 1) === ')'
    )) {
      return node;
    }
    if (node.grammarType === 'ForgivingSelectorItem' && holdsInterpolation(node)) {
      return innermostInterpolatedItem(node);
    }
    stack.push(...children.reverse());
  }
  return undefined;
}

/* Whether a CST subtree reads an interpolation, which a capture cannot hold. */
function holdsInterpolation(node: CssCstNode): boolean {
  return cstChildrenOf(node).some(child => isCstNode(child) && (child.grammarType.includes('Interpolat') || child.grammarType === 'DollarBrace' || holdsInterpolation(child)));
}

/* The innermost `:is()` / `:where()` item holding the interpolation, as the compiler reports it. */
function innermostInterpolatedItem(item: CssCstNode): CssCstNode {
  const stack = cstChildrenOf(item).filter(isCstNode);
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.grammarType === 'ForgivingSelectorItem' && holdsInterpolation(node)) {
      return innermostInterpolatedItem(node);
    }
    stack.push(...cstChildrenOf(node).filter(isCstNode));
  }
  return item;
}
