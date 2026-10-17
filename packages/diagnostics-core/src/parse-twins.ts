import { PROGID_IE_SYNTAX, invalidValuePunctuation, invalidValueSyntaxError, isAnyTokenFunction, nameValueIeSyntax, type InvalidValueSyntax } from '@jesscss/core';
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
  severity: 'error',
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
 * delim holding `.`, `~`, `=`, `|`, `^` or `?`.
 *
 * What the compiler does not enter is not read here either: a custom
 * property, a string, an interpolation, a `var()` / `env()` / `attr()` call,
 * a branch condition (the part of a call argument before its `:`), and a Less
 * or SCSS condition — a comparison, Less's `boolean()` / `not()` / `and()` /
 * `or()`, SCSS's `not(…)` and the first argument of a Less or SCSS `if()`. An
 * SCSS nested property is read part by part. A Less comparison
 * Less gives no meaning (a chain `a=b=c`, or `a==b`) is a run: its operators
 * are delims.
 */
type ValueAtom =
  | { readonly kind: 'ident' | 'delim'; readonly text: string }
  | { readonly kind: 'call' | 'group'; readonly node: CssCstNode }
  | { readonly kind: 'comma' | 'semicolon' | 'colon' | 'other' };

const COMMA: ValueAtom = { kind: 'comma' };
const SEMICOLON: ValueAtom = { kind: 'semicolon' };
const COLON: ValueAtom = { kind: 'colon' };
const OTHER: ValueAtom = { kind: 'other' };
const IDENT_TYPES = new Set(['Keyword', 'KeywordOrInterpolatedValue', 'Identifier']);
const DELIM_TYPES = new Set(['DeclarationAny']);
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
  if (operators.length === 0 || (operators.length === 1 && LESS_COMPARISONS.has(operators[0]!))) {
    out.push(OTHER);
    return;
  }
  for (const child of children) {
    if (child._tag === 'leaf') {
      out.push({ kind: 'delim', text: source.slice(Number(child.span.start), Number(child.span.end)).trim() });
    } else if (isCstNode(child)) {
      valueAtoms(child, 'less', source, out);
    }
  }
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
  for (let i = 0; i < atoms.length && found?.code !== 'css/legacy-ie-syntax'; i++) {
    const atom = atoms[i]!;
    if (isAtom(atom, 'ident') && atom.text.toLowerCase() === 'progid' && isAtom(atoms[i + 1], 'delim', ':')) {
      return PROGID_IE_SYNTAX;
    }
    if (atom.kind === 'delim') {
      found = better(found, invalidValuePunctuation(atom.text));
    } else if (atom.kind === 'group') {
      found = better(found, invalidValueSyntaxInAtoms(valueAtoms(atom.node, language, source, []), language, source));
    } else if (atom.kind === 'call') {
      found = better(found, invalidValueSyntaxInCall(atom.node, language, source));
    }
  }
  return found;
}

function invalidValueSyntaxInCall(node: CssCstNode, language: JessLanguage, source: string): InvalidValueSyntax | undefined {
  const name = callNameOf(node, source);
  if (isAnyTokenFunction(name)) {
    return undefined;
  }
  const inner = valueAtoms(node, language, source, []);
  const conditions = conditionArguments(name, inner.filter(atom => atom.kind === 'comma').length + 1, language);
  let found: InvalidValueSyntax | undefined;
  let from = 0;
  let index = 0;
  for (let at = 0; at <= inner.length && found?.code !== 'css/legacy-ie-syntax'; at++) {
    if (at < inner.length && inner[at]!.kind !== 'comma') {
      continue;
    }
    const arg = inner.slice(from, at);
    const head = arg[0];
    if (conditions === 0 && arg.length === 3 && isAtom(head, 'ident') && isAtom(arg[1], 'delim', '=')) {
      return nameValueIeSyntax(head.text);
    }
    if (index >= conditions) {
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
   * Shapes the strict Less AST rejects by name — a slash-led value (ledger
   * P33) and an uncalled mixin reference (rejected today; ruling OPEN under
   * P33) — are kept as nodes in the tolerant CST, so their twin is reported
   * from the node.
   */
  if (language === 'less' && gt === 'LeadingSeparatorValue') {
    push(
      'parse/leading-separator-value',
      'error',
      'A Less value cannot start with "/".',
      node.span,
      {
        phase: 'parse',
        reason: 'A slash separates two values, so it needs a value before it. A path is a value only inside url() or a string.',
        fix: 'Write the path as url(/path) or as an escaped string such as ~"/path".'
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
}
