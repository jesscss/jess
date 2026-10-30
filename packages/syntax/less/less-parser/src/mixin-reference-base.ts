import { mixinCall } from '@jesscss/core/ast';
import type { MixinCall } from '@jesscss/core/ast';
import { isLessTerminalText, isMixinPathTail, mixinArgumentsFromChildren, requireToken } from './grammar-helpers.js';
import type { MixinReferenceBaseFact } from './grammar-helpers.js';
import { callArgumentSource } from './mixin-reference-source.js';

/**
 * The mixin a reference names, from its head, path tails and optional `(args)`:
 * the base `MixinReferenceBase` builds for a called or looked-up reference
 * (`#ns.m()`, `#ns.m[key]`) and `MixinReferenceValue` for a bare one
 * (`@foo: #ns.m;`).
 */
export function mixinReferenceBaseFrom(children: readonly unknown[]): MixinReferenceBaseFact {
  const head = requireToken(children[0]).value;
  const tails = children.filter(isMixinPathTail);
  const terminal = tails.at(-1);
  const call = mixinCall(terminal?.selector ?? head, mixinArgumentsFromChildren(children));
  const path: MixinCall['path'] = [{ combinator: ' ', selector: head }, ...tails.slice(0, -1)];
  const withPath = tails.length === 0 ? call : { ...call, path };
  const hasCall = children.some(child => isLessTerminalText(child, '('));
  const raw = `${head}${tails.map(tail => `${tail.combinator}${tail.selector}`).join('')}${hasCall ? `(${withPath.args.map(callArgumentSource).join(', ')})` : ''}`;
  return { call: withPath, raw };
}
