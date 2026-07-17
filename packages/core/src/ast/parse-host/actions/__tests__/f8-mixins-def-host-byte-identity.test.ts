import { describe, it, expect } from 'vitest';
import { parseLessFn, lessGrammar } from '@jesscss/less-parser';
import { serialize, Root, MixinDef, Declaration, root as t2root, type ValueNode, type Param } from '../../../index.js';
import { bridgeToAst } from '../../__tests__/bridge.js';
import { parseToAst } from '../../dispatch-host.js';

/**
 * F8 byte-identity: the mixin-definition family produces a
 * `MixinDef` structurally equivalent to the bridge's — name, params
 * (positional/default/rest/pattern), and body all byte-projected.
 *
 * A `MixinDef` serializes to nothing on its own (output comes only when a call
 * expands it — the call family is F9), so the gate is a canonical SIGNATURE of the
 * produced def, byte-compared against the bridge. Param default / pattern values
 * are compared via SERIALIZE (structurally a Word vs the bridge's VarRef may
 * differ while emitting identical bytes — bytes are the contract). The guard is
 * F10's family and excluded on both sides (it never affects a def's emit).
 */
const g = lessGrammar as Record<string, unknown>;

function directDef(src: string): MixinDef {
  const { root } = parseToAst(src, g['Stylesheet'], undefined, { trivia: g['rw'] });
  const def = (root?.children ?? []).find((s): s is MixinDef => s instanceof MixinDef);
  if (!def) throw new Error('f8: no MixinDef produced');
  return def;
}
function bridgeDef(src: string): MixinDef {
  const root = bridgeToAst(parseLessFn(src).tree, src) as unknown as Root;
  const def = (root.children ?? []).find((s): s is MixinDef => s instanceof MixinDef);
  if (!def) throw new Error('f8: bridge produced no MixinDef');
  return def;
}

/** Serialize one value node in isolation (byte projection of a default/pattern). */
function valueCss(v: ValueNode | undefined): string {
  if (v === undefined) return '-';
  return serialize(t2root([new Declaration('_', v)])).css.trim();
}

function paramSig(p: Param): string {
  if (p.rest) return `rest(${p.name ?? ''})`;
  if (p.pattern) return `pat(${valueCss(p.pattern)})`;
  return `bind(${p.name}${p.default ? '=' + valueCss(p.default) : ''})`;
}

/** Canonical signature: name | params | body-css (guard excluded — F10). */
function sig(def: MixinDef): string {
  const bodyCss = serialize(t2root(def.body)).css.trim();
  return `${def.name} || ${def.params.map(paramSig).join(' ; ')} || ${bodyCss}`;
}

// Cases where the bridge is correct — gate direct === bridge.
const cases: Array<[string, string]> = [
  ['no-params', '.m() { color: red }\n'],
  ['one-binding', '.m(@a) { color: @a }\n'],
  ['semicolon-default-num', '.m(@a; @b: 2) { color: @a }\n'],
  ['comma-default-dim', '.m(@a, @b: 2px) { color: @a }\n'],
  ['rest-named', '.m(@rest...) { x: 1 }\n'],
  ['binding-plus-rest', '.m(@a, @rest...) { x: 1 }\n'],
  ['rest-anon', '.m(...) { x: 1 }\n'],
  ['pattern-keyword', '.m(dark) { x: 1 }\n'],
  ['pattern-dim', '.m(2px) { x: 1 }\n'],
  ['pattern-plus-binding', '.m(dark, @a) { x: 1 }\n'],
  ['default-color', '.m(@c: #fff) { color: @c }\n'],
  ['default-named-color', '.m(@a: red) { color: @a }\n'],
  ['multi-decl-body', '.m(@a) { color: @a; width: 10px; }\n'],
  ['nested-ruleset-body', '.box(@a) { color: @a; .inner { width: 1px } }\n'],
  ['id-namespace-head', '#ns() { .inner() { x: 1 } }\n'],
  ['guarded-carried', '.m(@a) when (@a > 0) { x: 1 }\n'],
  ['guarded-default-color', '.m(@a: red) when (iscolor(@a)) { color: @a }\n'],
];

describe('mixin-def host byte-identity (structural) vs bridge', () => {
  for (const [name, src] of cases) {
    it(name, () => {
      const d = sig(directDef(src));
      const b = sig(bridgeDef(src));
      if (d !== b) console.log(`\n--- ${name} ---\nDIRECT: ${JSON.stringify(d)}\nBRIDGE: ${JSON.stringify(b)}`);
      expect(d).toBe(b);
    });
  }
});

/**
 * KNOWN BRIDGE BUG (flagged to owner): a mixin param default that is a KEYWORD or
 * MULTI-TOKEN value (`@d: block`, `@d: solid`, `@d: thin dotted`) gets an OVER-WIDE
 * span in the bridge, so its default serializes to `@d: block` (the whole param)
 * instead of `block`. Typed leaves (color/dim/num) have tight spans and are fine.
 * The direct host derives the default from the `:`-split param bytes, so it is
 * CORRECT for every case — we assert the correct value here rather than match the
 * buggy oracle (per the don't-anchor-to-old-shape rule).
 */
const correctKeywordDefaults: Array<[string, string]> = [
  ['default-keyword-block', '.m(@d: block) { display: @d }\n'],
  ['default-keyword-auto', '.m(@d: auto) { x: @d }\n'],
  ['default-keyword-solid', '.m(@d: solid) { x: @d }\n'],
  ['default-multitoken', '.m(@d: thin dotted) { border: @d }\n'],
];

describe('mixin-def keyword/multi-token defaults (direct correct; bridge buggy)', () => {
  for (const [name, src] of correctKeywordDefaults) {
    it(name, () => {
      const def = directDef(src);
      const p = def.params[0]!;
      const expected = src.slice(src.indexOf(':') + 1, src.indexOf(')')).trim();
      expect(valueCss(p.default)).toBe(`_: ${expected};`);
    });
  }
});
