import { describe, expect, it } from 'vitest';
import type { Declaration, FunctionCall, Ruleset } from '@jesscss/core/ast';
import { parse } from '@jesscss/less-parser';

/**
 * Ledger P37: a `{` in a Less function argument is a CURLY BLOCK (a
 * css-values-5 §3.1.1 `{}`-wrapped value list, emitted as written) or a
 * DECLARATION LIST (a detached ruleset). The grammar dispatches at the `{` on
 * the block's shape and parses the chosen arm once.
 *
 * A mixin call and a detached-ruleset call START A STATEMENT, so a block that
 * opens on one is a declaration list even when nothing follows it: reading
 * `{ @r() }` as a curly block emitted `foo({ })`, losing the ruleset.
 */
function argumentKind(source: string): string {
  const sheet = parse(source);
  const rule = sheet.rules.at(-1) as Ruleset;
  const call = (rule.rules[0] as Declaration).value as FunctionCall;
  const value = call.args[0]!.value;
  if (Array.isArray(value) || typeof value !== 'object') {
    return 'slot';
  }
  return value.type === 'Block' ? `Block:${value.delimiter}` : value.type;
}

const CURLY = 'Block:curly';
const DECLARATIONS = 'AnonymousMixin';

const CASES: Array<[name: string, source: string, kind: string]> = [
  ['a value list', 'a { b: foo({ a, b }); }', CURLY],
  ['a single value', 'a { b: foo({ a }); }', CURLY],
  ['a variable-led value list', '@v: 1px;\na { b: foo({ @v, 2px }); }', CURLY],
  ['a call-led value list', 'a { b: foo({ f(x), y }); }', CURLY],
  ['a lone function call with no `;`', 'a { b: foo({ f(x) }); }', CURLY],
  ['hex colours', 'a { b: foo({ #fff, #000 }); }', CURLY],
  ['a colon inside a string', 'a { b: foo({ "x:y", z }); }', CURLY],
  ['a declaration', 'a { b: foo({ v: 1; }); }', DECLARATIONS],
  ['a declaration with no trailing `;`', 'a { b: foo({ a:b }); }', DECLARATIONS],
  ['an empty block', 'a { b: foo({}); }', DECLARATIONS],
  ['a nested rule with a selector list', 'a { b: foo({ h1, h2 { c: d } }); }', DECLARATIONS],
  ['a detached-ruleset call', '@r: { c: d };\na { b: foo({ @r() }); }', DECLARATIONS],
  ['a mixin call', '.m() { c: d }\na { b: foo({ .m() }); }', DECLARATIONS],
  ['a namespaced mixin call', 'a { b: foo({ #ns.m() }); }', DECLARATIONS]
];

describe('Less: a `{` in a function argument is dispatched on its shape (P37)', () => {
  for (const [name, source, kind] of CASES) {
    it(`${name} → ${kind === CURLY ? 'curly block' : 'declaration list'}`, () => {
      expect(argumentKind(source)).toBe(kind);
    });
  }
});
