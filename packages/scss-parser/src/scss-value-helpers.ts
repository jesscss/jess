/**
 * SCSS value desugaring helpers for the functional grammar builders.
 * Ports productions/helpers.ts without the Chevrotain parser bootstrap.
 */
import {
  Call,
  Reference,
  isNode,
  N,
  type LocationInfo,
  type Node
} from '@jesscss/core';

export function unwrapSingleSequence(n: Node): Node {
  if (isNode(n, N.Sequence) && n.value.length === 1) {
    return n.value[0]!;
  }
  return n;
}

export function toDeclKey(node: Node): string {
  return String(node.valueOf());
}

export function isValidIdentifierKey(key: string): boolean {
  return /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(key);
}

export function makeNamespacedReference(
  parts: string[],
  finalType: 'variable' | 'function' | 'mixin' | 'mixin-ruleset',
  loc: LocationInfo
): Reference {
  let current: Reference = new Reference(parts[0]!, { type: 'variable' }, loc);
  for (let i = 1; i < parts.length; i++) {
    const isFinal = i === parts.length - 1;
    current = new Reference(
      { target: current, key: parts[i]! },
      { type: isFinal ? finalType : 'index' },
      loc
    );
  }
  return current;
}

export function desugarNamespacedCall(call: Call, loc: LocationInfo): Call {
  const { name, args } = call;
  if (typeof name !== 'string') {
    return call;
  }
  if (!name.includes('.')) {
    return call;
  }
  if (name === 'map.get') {
    return call;
  }
  const parts = name.split('.').filter(Boolean);
  if (parts.length < 2) {
    return call;
  }
  const ref = makeNamespacedReference(parts, 'function', loc);
  return new Call({ name: ref, args }, call.options, loc);
}

export function desugarMapLookup(call: Call, loc: LocationInfo): Node {
  const { name, args: argsList } = call;
  if (typeof name !== 'string') {
    return call;
  }
  if (name !== 'map-get' && name !== 'map.get') {
    return call;
  }

  const args = isNode(argsList, N.List) ? argsList.value : [];
  if (args.length < 2) {
    return call;
  }

  const mapExpr = unwrapSingleSequence(args[0]!);
  const keyArgs = args.slice(1).map(a => unwrapSingleSequence(a));

  const initialTarget =
    isNode(mapExpr, N.Reference)
      ? mapExpr
      : isNode(mapExpr, N.Call)
        ? mapExpr
        : undefined;

  if (!initialTarget) {
    return call;
  }

  let currentTarget: Reference | Call = initialTarget;
  for (const keyNode of keyArgs) {
    const keyStr = toDeclKey(keyNode);
    const useDeclaration = isValidIdentifierKey(keyStr);
    currentTarget = new Reference(
      { target: currentTarget, key: useDeclaration ? keyStr : keyNode },
      { type: useDeclaration ? 'declaration' : 'index' },
      loc
    );
  }

  return currentTarget;
}
