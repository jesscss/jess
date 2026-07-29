/**
 * SCSS call-site lowering: a user `@function f(...)` was lowered (in the grammar)
 * to a `$var`-bound value lambda (`AnonymousMixin` with `params`). A CALL to that
 * function — `f(2)` — parses as an ordinary `FunctionCall`, indistinguishable at
 * the leaf from a builtin Sass call (`darken(...)`). This post-parse pass rewrites
 * every `FunctionCall` whose name is a USER-defined `@function` into the shared
 * `$f(args)` invoke form (a `Reference` with a `Call` step on the bound variable),
 * so it reaches the general "call a value-lambda" evaluator path. Builtin Sass
 * functions are left as `FunctionCall`s and continue to route to `fns`.
 *
 * User-function names are collected from the WHOLE document first (Sass hoists and
 * effectively globalises function definitions), so a call may precede its `@function`.
 * The only SCSS construct that binds an `AnonymousMixin` to a `$var` is `@function`,
 * so "a VariableDeclaration whose value is an AnonymousMixin" is an exact marker.
 */
import { reference, variableReference } from '@jesscss/core/ast';
import type { CallArg, FunctionCall, Stylesheet, ValueNode, ValueSlot } from '@jesscss/core/ast';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFunctionCall(value: unknown): value is FunctionCall {
  return isRecord(value) && value.type === 'FunctionCall'
    && typeof value.name === 'string' && Array.isArray(value.args);
}

/** A non-array value slot is a single value node. */
function isValueNode(slot: ValueSlot): slot is ValueNode {
  return !Array.isArray(slot);
}

function isStylesheet(value: unknown): value is Stylesheet {
  return isRecord(value) && value.type === 'Stylesheet' && Array.isArray(value.rules);
}

/** Collect every user `@function` name: a VariableDeclaration bound to an
 *  AnonymousMixin (the only SCSS shape that produces one). */
function collectUserFunctionNames(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectUserFunctionNames(
        child,
        into
      );
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  if (node.type === 'VariableDeclaration' && typeof node.name === 'string'
    && isRecord(node.value) && node.value.type === 'AnonymousMixin') {
    into.add(node.name);
  }
  for (const key of Object.keys(node)) {
    collectUserFunctionNames(
      node[key],
      into
    );
  }
}

/** Best-effort authored spelling of a call argument, for a Reference `raw`
 *  fallback (only ever emitted if the invoke fails to resolve). */
function argRaw(slot: ValueSlot): string {
  if (!isValueNode(slot)) {
    return slot.map(argRaw).join(' ');
  }
  if (slot.type === 'VariableReference') {
    return `$${slot.name}`;
  }
  if ('src' in slot && typeof slot.src === 'string') {
    return slot.src;
  }
  return '';
}

/** Deep-transform the tree, rewriting user-function `FunctionCall`s (post-order,
 *  so nested user calls inside the args lower first). Non-AST scalars pass through. */
function rewrite(node: unknown, userFns: Set<string>): unknown {
  if (Array.isArray(node)) {
    return node.map(child => rewrite(
      child,
      userFns
    ));
  }
  if (!isRecord(node)) {
    return node;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node)) {
    out[key] = rewrite(
      node[key],
      userFns
    );
  }
  if (isFunctionCall(out) && userFns.has(out.name)) {
    const args: CallArg[] = out.args.map(value => ({ value }));
    const raw = `${out.name}(${out.args.map(argRaw).join(', ')})`;
    return reference(
      variableReference(
        out.name,
        'live'
      ),
      [{ type: 'Call', args }],
      raw
    );
  }
  return out;
}

/**
 * Rewrite user-`@function` call sites in a parsed SCSS document to `$f(args)`
 * lambda invokes. Returns the document unchanged when it defines no user function.
 */
export function lowerUserFunctionCalls(sheet: Stylesheet): Stylesheet {
  const userFns = new Set<string>();
  collectUserFunctionNames(
    sheet.rules,
    userFns
  );
  if (userFns.size === 0) {
    return sheet;
  }
  const lowered = rewrite(
    sheet,
    userFns
  );
  if (!isStylesheet(lowered)) {
    throw new TypeError('SCSS user-function lowering did not preserve the Stylesheet root.');
  }
  return lowered;
}
