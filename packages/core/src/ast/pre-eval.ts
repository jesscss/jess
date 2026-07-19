/**
 * [plugin/P3] Pre-eval visitor pre-walk (AST-native-plugins design, Lane 3).
 *
 * A Less `@plugin` may register a REPLACING pre-eval visitor (`isPreEvalVisitor`)
 * that rewrites nodes BEFORE evaluation — e.g. `plugin-preeval`'s `visitVariable`
 * turns `@replace` into a literal. The `ast/` engine has no eval phase distinct from
 * serialize (the single pass evaluates + emits in one walk), so a pre-eval rewrite
 * cannot fold into it. Instead the driver (`render-doc`) runs THIS optional
 * structural pre-walk over the built AST value nodes between import resolution and
 * `serialize`, feeding each value node through the registered visitor edges.
 *
 * Ownership split (per design): CORE owns the STRUCTURAL traversal (it knows the
 * `ast/` node shapes) and fires ONE generic edge per value node; the CONSUMER shim
 * (`@jesscss/plugin-less`) owns the per-type switch (`visitVariable`/…) and the
 * Less-tree node conversion inside each {@link PreEvalVisitor}. The pass is HARD-gated
 * by the caller on `visitors.length > 0`, so a document with no pre-eval visitor
 * (every real document) never enters here — byte- and cost-identical.
 *
 * Semantics: a visitor is applied at node ENTER; a returned replacement SUBSTITUTES
 * the node and its subtree is NOT descended into (matching a Less `isReplacing`
 * visitor); `undefined`/`void` leaves the node, and the walk descends into its value
 * children. Nodes are rebuilt only when a child actually changes, so an untouched
 * subtree keeps object identity (and its serializer memo fields).
 */
import type { Statement } from './nodes.js';
import type {
  AtRuleBlock,
  AtRuleStatement,
} from './at-rule.js';
import type {
  ValueNode,
  Interp,
  InterpPart,
  Rule,
  Declaration,
  VarDeclaration,
  MixinDef,
  MixinCall,
  For,
  DetachedRuleset,
  SpacedValue,
  List,
  Sequence,
  Important,
  Operation,
  FunctionCall,
  Paren,
  VarIndirect,
  MapAccessor,
  Param,
} from './nodes.js';
import type { CallArg } from './mixin-dispatch.js';
import type { PreEvalVisitor } from './value-eval.js';

/**
 * Run the pre-eval visitor pre-walk over a statement list, returning a NEW list with
 * every replaced value node substituted. The single entry point the driver calls.
 */
export function preWalkStatements(statements: Statement[], visitors: readonly PreEvalVisitor[]): Statement[] {
  return mapArray(statements, (s) => walkStatement(s, visitors));
}

/** Map an array, returning the SAME reference when no element changed. */
function mapArray<T>(arr: T[], fn: (item: T) => T): T[] {
  let changed = false;
  const out = arr.map((item) => {
    const next = fn(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? out : arr;
}

function walkStatement(stmt: Statement, visitors: readonly PreEvalVisitor[]): Statement {
  switch (stmt.type) {
    case 'Rule': {
      const body = mapArray(stmt.body, (s) => walkStatement(s, visitors));
      return body === stmt.body ? stmt : ({ ...stmt, body } as Rule);
    }
    case 'Declaration': {
      const value = walkValue(stmt.value, visitors);
      return value === stmt.value ? stmt : ({ ...stmt, value } as Declaration);
    }
    case 'VarDeclaration': {
      const value = stmt.value.type === 'MixinCall'
        ? walkMixinCall(stmt.value, visitors)
        : walkValue(stmt.value, visitors);
      return value === stmt.value ? stmt : ({ ...stmt, value } as VarDeclaration);
    }
    case 'MixinDef': {
      const body = mapArray(stmt.body, (s) => walkStatement(s, visitors));
      const params = mapArray(stmt.params, (p) => walkParam(p, visitors));
      return body === stmt.body && params === stmt.params ? stmt : ({ ...stmt, body, params } as MixinDef);
    }
    case 'MixinCall':
      return walkMixinCall(stmt, visitors);
    case 'For': {
      const iterable = stmt.iterable.type === 'MixinCall'
        ? walkMixinCall(stmt.iterable, visitors)
        : walkValue(stmt.iterable, visitors);
      const rules = mapArray(stmt.rules, (s) => walkStatement(s, visitors));
      return iterable === stmt.iterable && rules === stmt.rules ? stmt : ({ ...stmt, iterable, rules } as For);
    }
    case 'AtRuleBlock': {
      const prelude = stmt.prelude ? walkValue(stmt.prelude, visitors) : stmt.prelude;
      const body = mapArray(stmt.body, (s) => walkStatement(s, visitors));
      return prelude === stmt.prelude && body === stmt.body ? stmt : ({ ...stmt, prelude, body } as AtRuleBlock);
    }
    case 'AtRuleStatement': {
      const prelude = stmt.prelude ? walkValue(stmt.prelude, visitors) : stmt.prelude;
      return prelude === stmt.prelude ? stmt : ({ ...stmt, prelude } as AtRuleStatement);
    }
    case 'FunctionCall':
      return walkValue(stmt, visitors) as Statement;
    // Comment / DetachedCall / RawInline / StyleImport carry no value children.
    default:
      return stmt;
  }
}

function walkMixinCall(call: MixinCall, visitors: readonly PreEvalVisitor[]): MixinCall {
  const args = mapArray(call.args, (a) => {
    const value = walkValue(a.value, visitors);
    return value === a.value ? a : ({ ...a, value } as CallArg);
  });
  return args === call.args ? call : { ...call, args };
}

function walkParam(param: Param, visitors: readonly PreEvalVisitor[]): Param {
  let out = param;
  if (param.default) {
    const d = walkValue(param.default, visitors);
    if (d !== param.default) out = { ...out, default: d };
  }
  if (param.pattern) {
    const p = walkValue(param.pattern, visitors);
    if (p !== param.pattern) out = { ...out, pattern: p };
  }
  return out;
}

/**
 * Apply the visitor edges to a value node (ENTER), then descend into its children.
 * A returned replacement short-circuits (no descent into the substituted subtree).
 */
function walkValue(node: ValueNode, visitors: readonly PreEvalVisitor[]): ValueNode {
  let cur = node;
  for (const v of visitors) {
    const r = v(cur);
    if (r && r !== cur) return r;
  }
  return descend(cur, visitors);
}

/** Recurse into a value node's value children, rebuilding only when one changes. */
function descend(node: ValueNode, visitors: readonly PreEvalVisitor[]): ValueNode {
  switch (node.type) {
    case 'SpacedValue': {
      const parts = mapArray(node.parts, (p) => walkValue(p, visitors));
      return parts === node.parts ? node : ({ ...node, parts } as SpacedValue);
    }
    case 'List': {
      const items = mapArray(node.items, (p) => walkValue(p, visitors));
      return items === node.items ? node : ({ ...node, items } as List);
    }
    case 'Sequence': {
      const parts = mapArray(node.parts, (p) => walkValue(p, visitors));
      return parts === node.parts ? node : ({ ...node, parts } as Sequence);
    }
    case 'Important': {
      const inner = walkValue(node.inner, visitors);
      return inner === node.inner ? node : ({ ...node, inner } as Important);
    }
    case 'Operation': {
      const left = walkValue(node.left, visitors);
      const right = walkValue(node.right, visitors);
      return left === node.left && right === node.right ? node : ({ ...node, left, right } as Operation);
    }
    case 'FunctionCall': {
      const args = mapArray(node.args, (p) => walkValue(p, visitors));
      return args === node.args ? node : ({ ...node, args } as FunctionCall);
    }
    case 'Paren': {
      const inner = walkValue(node.inner, visitors);
      return inner === node.inner ? node : ({ ...node, inner } as Paren);
    }
    case 'VarIndirect': {
      const nameRef = walkValue(node.nameRef, visitors);
      return nameRef === node.nameRef ? node : ({ ...node, nameRef } as VarIndirect);
    }
    case 'MapAccessor': {
      const base = walkValue(node.base, visitors);
      const key = typeof node.key === 'number' ? node.key : walkValue(node.key, visitors);
      return base === node.base && key === node.key ? node : ({ ...node, base, key } as MapAccessor);
    }
    case 'Interp': {
      const parts = mapArray(node.parts, (p) => walkInterpPart(p, visitors));
      return parts === node.parts ? node : ({ ...node, parts } as Interp);
    }
    case 'DetachedRuleset': {
      const body = mapArray(node.body, (s) => walkStatement(s, visitors));
      return body === node.body ? node : ({ ...node, body } as DetachedRuleset);
    }
    // Keyword / Color / Quoted / Any / SelectorCapture / Dimension / VarRef /
    // PropRef / Condition are leaves for value-node traversal.
    default:
      return node;
  }
}

function walkInterpPart(part: InterpPart, visitors: readonly PreEvalVisitor[]): InterpPart {
  if ('ref' in part) {
    const ref = walkValue(part.ref, visitors);
    return ref === part.ref ? part : { ...part, ref };
  }
  return part;
}
