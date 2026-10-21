/*
 * `.jess`'s spelling of an `IfValue` (ledger P38), apart from the printer so
 * the printer stays one reviewable size. The printer lends what it already
 * spells: a value, a `$( … )` boundary, a guard and a string template.
 */
import { hasCssTest, isIfTestCall, type GuardNode } from './guard-node.js';
import type { Expression, IfValue, Interpolation, ValueSlot } from './nodes.js';

/** The `.jess` spellings an `if()` is built from. */
export interface IfSpeller {
  readonly value: (slot: ValueSlot) => string;
  readonly expression: (node: Expression) => string;
  readonly guard: (node: GuardNode) => string;
  readonly template: (node: Interpolation) => string;
  readonly gap: (nodeType: string, reason: string) => string;
}

/**
 * `IfValue`, as `.jess`'s CSS `if()`: a branch list whose compile-time
 * conditions are `$( … )`, whose CSS tests are written as authored, and whose
 * unconditioned branch is `else`. Sass's `if($condition, $if-true, $if-false)`
 * is the same node, so it is spelled `if($($condition): $if-true; else:
 * $if-false)`. A Less `if()` keeps the call it was lowered from (ledger P36),
 * which this spelling does not.
 */
export function jessIf(node: IfValue, p: IfSpeller): string {
  if (node._asCall !== null) {
    return p.gap('IfValue', 'a Less `if()` lowered from a call (ledger P36): its call has no `.jess` spelling here');
  }
  const branches = node.branches.map(branch => jessBranch(branch.guard === null ? 'else' : condition(branch.guard, p), p.value(branch.value)));
  return `${node.name}(${branches.join('; ')}${node.trailingSemicolon ? ';' : ''})`;
}

/**
 * An `if()` condition: a part with no CSS test is decided at compile time, so
 * it is one `$( … )` (a truth test of a `$( … )` is that expression, as in
 * Sass's `if($a == 1, …)`); a CSS test is its authored text, and `and`, `or`
 * and `not` join them as written.
 */
function condition(node: GuardNode, p: IfSpeller): string {
  const parens = (s: string): string => `${'('.repeat(node.parens)}${s}${')'.repeat(node.parens)}`;
  if (!hasCssTest(node)) {
    return parens(node.g === 'truth' && !Array.isArray(node.value) && 'type' in node.value && node.value.type === 'Expression'
      ? p.expression(node.value)
      : `$(${p.guard({ ...node, parens: 0 })})`);
  }
  switch (node.g) {
    case 'css':
      return parens(cssTest(node.value, p));
    case 'and':
    case 'or':
      return parens(`${condition(node.left, p)} ${node.word} ${condition(node.right, p)}`);
    case 'not':
      return parens(`${node.word} ${condition(node.inner, p)}`);
    default:
      return p.gap('GuardNode', `a \`${node.g}\` condition holding a CSS test`);
  }
}

/**
 * A CSS test as `.jess` reads it, the structure css builds: a `media()`,
 * `supports()` or `style()` call over query syntax (a feature's `:` and
 * comparisons, paren groups, `and` / `or` / `not` as keywords) whose values are
 * `.jess` values, a `$name` among them. A `style()` value is a custom
 * property's, so text in it stays text and `${name}` interpolates.
 */
function cssTest(value: ValueSlot, p: IfSpeller): string {
  if (!('type' in value)) {
    return value.map(part => cssTest(part, p)).join(' ');
  }
  switch (value.type) {
    case 'Any':
      return value.src.includes('${') || value.src.includes('$[') || value.src.includes('$(')
        ? p.gap('Any', 'a CSS test holding `${`, `$[` or `$(`, which `.jess` reads as a `$` form')
        : value.src;
    case 'Interpolation':
      return isLiteralTemplate(value) ? value.parts.map(part => ('lit' in part ? part.lit : '')).join('') : p.template(value);
    case 'Operation':
      return `${cssTest(value.left, p)}${value.operator === ':' ? '' : ' '}${value.operator} ${cssTest(value.right, p)}`;
    case 'Block':
      return value.delimiter === 'paren' && value.escaped !== true ? `(${cssTest(value.value, p)})` : p.value(value);

    /*
     * A test is query syntax; a `<general-enclosed>` call in it (`selector(:has(a))`)
     * is its authored content. Any other call is a value, the printer's.
     */
    case 'FunctionCall':
      return value.args.every(arg => isLiteralTemplate(arg.value)) || isIfTestCall(value)
        ? `${value.name}(${value.args.map(arg => cssTest(arg.value, p)).join(', ')})`
        : p.value(value);
    default:
      return p.value(value);
  }
}

/** A branch argument, `condition: value`, the colon the branch's own (ledger P38); an omitted value keeps the bare colon. */
export const jessBranch = (condition: string, value: string): string => (value === '' ? `${condition}:` : `${condition}: ${value}`);

/** A template of literal text alone: a `<general-enclosed>` call's authored content, written as it was. */
function isLiteralTemplate(value: ValueSlot): boolean {
  return 'type' in value && value.type === 'Interpolation' && value.parts.every(part => 'lit' in part);
}
