/**
 * Guard family: the `when (…)` mixin/qualified-rule guard grammar
 * (`Guard`/`GuardOr`/`GuardAnd`/`GuardTerm`/`GuardInParens`/`GuardDefault`) →
 * this engine's own boolean `GuardNode` structure (`guard.ts`).
 *
 * P0 — the parser already hands the guard fully STRUCTURED (precedence resolved:
 * `or` loops over `and`, parens nest a fresh `GuardOr`, `not` prefixes a term),
 * so this family never re-parses bytes: it folds the built child GuardNodes and
 * reads comparison operands as the value nodes the value families already built.
 * It mirrors the bridge's `bridgeGuard` shape exactly, so a direct-host guard is
 * byte-identical to a bridged one — tree2 owns the boolean structure and delegates
 * only the leaf comparison / type-predicate truth to the injected value evaluator.
 *
 * A `GuardNode` is a plain discriminated object (`{ g: … }`), NOT a tree2 `Node`;
 * the mixin-def family reads it off its children via `isGuardNode` (a `'g' in x`
 * test), so guard nodes coexist with value/leaf children without a wrapper type.
 */
import * as t2 from '../../index.js';
import type { BuildAction, BuildArgs } from '../host-context.js';
import { isLeaf, type Leaf } from './interp.js';

/** A built `GuardNode` child (vs a value node / leaf): a `{ g: … }` object. */
function isGuardNode(x: unknown): x is t2.GuardNode {
  return !!x && typeof x === 'object' && !t2.isNode(x) && 'g' in (x as object);
}

/** The value node the value families built for a guard operand. */
function isValueNode(x: unknown): x is t2.ValueNode {
  return t2.isNode(x);
}

function leafText(x: unknown): string | undefined {
  return isLeaf(x) ? (x as Leaf).value : undefined;
}

/** Less normalizes the guard comparison aliases `=<`→`<=` and `=>`→`>=` before
 *  the comparison reaches evaluation; the direct grammar keeps them verbatim. */
function normalizeCmpOp(op: string): string {
  if (op === '=<') return '<=';
  if (op === '=>') return '>=';
  return op;
}

const CMP_OPS = new Set(['>', '<', '>=', '<=', '=', '=<', '=>']);

/** `default()` → the dispatch-decided default guard. */
function buildGuardDefault(): t2.GuardNode {
  return { g: 'default' };
}

/** `GuardDefault` | `'(' GuardOr ')'` → the single inner GuardNode. */
function buildGuardInParens(args: BuildArgs): t2.GuardNode | undefined {
  return args.children.find(isGuardNode);
}

/**
 * A single guard term: optional `not`, then EITHER a parenthesized guard
 * (a built `GuardInParens` GuardNode child) OR a leaf condition —
 * `operand [compareOp operand]` (a comparison) / a lone `FunctionCall`
 * (a type predicate) / a lone value (truthiness).
 *
 * Operands arrive EITHER as a value node the value families built (a `numeric`,
 * `Color`, `Call`, `Reference`, …) OR — for a bare keyword operand routed through
 * the grammar's `anyValue` fallback (`@t = success`) — as a raw literal leaf,
 * which is lifted to a `Word` so it materializes exactly like the same keyword
 * would as a call argument (both byte-flatten through `any(bytes)`).
 */
function buildGuardTerm(args: BuildArgs): t2.GuardNode | undefined {
  let negate = false;
  let op: string | undefined;
  const operands: t2.ValueNode[] = [];
  let sub: t2.GuardNode | undefined;

  for (const child of args.children) {
    if (isGuardNode(child)) {
      sub = child;
      continue;
    }
    if (isValueNode(child)) {
      operands.push(child);
      continue;
    }
    const lv = leafText(child);
    if (lv === undefined) continue;
    if (lv === 'not') negate = true;
    // A comparison-operator leaf is the term's `op`, never an operand. The
    // call-argument condition grammar (`CondArg…`) emits the operator leaf twice
    // for a single comparison (`2 = 1` → `[2, =, =, 1]`); the `when`-guard grammar
    // emits it once. Recording the FIRST and dropping any further op leaf handles
    // both without re-deriving structure — an operator is categorically not an operand.
    else if (CMP_OPS.has(lv)) { if (op === undefined) op = lv; }
    else operands.push(t2.any(lv));
  }

  // Parenthesized / default sub-guard already built into a GuardNode.
  if (sub !== undefined) return negate ? { g: 'not', inner: sub } : sub;

  let g: t2.GuardNode | undefined;
  if (op !== undefined && operands.length >= 2) {
    g = { g: 'cmp', op: normalizeCmpOp(op), left: operands[0]!, right: operands[1]! };
  } else if (operands.length === 1) {
    // A single-operand condition is a TRUTH test on the operand's evaluated value —
    // faithful to less.js, which evaluates any bare operand (a variable, OR a
    // function call like `iscolor(@x)` / `boolean(true)`) and checks its truthiness.
    // Routing a function call through `truth` (value eval) — not a predicate-only
    // `call`/typeCheck — is what makes a logical fn nested in a condition
    // (`not(boolean(true))`) evaluate through the value engine's logical-fn dispatch.
    g = { g: 'truth', value: operands[0]! };
  }
  if (g === undefined) return undefined;
  return negate ? { g: 'not', inner: g } : g;
}

/** Fold a run of built child GuardNodes left-associatively under one connective. */
function foldGuards(args: BuildArgs, connective: 'and' | 'or'): t2.GuardNode | undefined {
  const parts = args.children.filter(isGuardNode);
  if (parts.length === 0) return undefined;
  let acc = parts[0]!;
  for (let i = 1; i < parts.length; i++) acc = { g: connective, left: acc, right: parts[i]! };
  return acc;
}

const buildGuardAnd = (args: BuildArgs): t2.GuardNode | undefined => foldGuards(args, 'and');
const buildGuardOr = (args: BuildArgs): t2.GuardNode | undefined => foldGuards(args, 'or');

/** `Guard` = `when GuardOr` → the built GuardOr node. */
function buildGuard(args: BuildArgs): t2.GuardNode | undefined {
  return args.children.find(isGuardNode);
}

export const GUARD_ACTIONS: readonly BuildAction[] = [
  { type: 'GuardDefault', build: buildGuardDefault },
  { type: 'GuardInParens', build: buildGuardInParens },
  { type: 'GuardTerm', build: buildGuardTerm },
  { type: 'GuardAnd', build: buildGuardAnd },
  { type: 'GuardOr', build: buildGuardOr },
  { type: 'Guard', build: buildGuard },
  // [condition-grammar] The name-independent condition-argument grammar
  // (`CondArgOr`/`CondArgAnd`/`CondArgTerm`, and `CondArgParen` tagged
  // `GuardInParens`) is the SAME boolean grammar `when (…)` guards use, lifted into
  // a call-argument position — `if(@a > 0, …)` / `boolean(not(2 < 1))`. It folds to
  // the identical `GuardNode` structure through the identical builders, so a
  // condition arg and a guard are byte-for-byte the same tree; `buildCall` wraps the
  // resulting `GuardNode` in a `Condition` value node for the logical fns to consume.
  { type: 'CondArgTerm', build: buildGuardTerm },
  { type: 'CondArgAnd', build: buildGuardAnd },
  { type: 'CondArgOr', build: buildGuardOr },
];
