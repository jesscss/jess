/**
 * Nested mixin DEFINITIONS inside a rule body: `.name(args) [guard] { … }`.
 *
 * declarationList previously modelled only MixinCall (no body), so a nested
 * definition fell through to the silent recovery arm and its body was lost. The
 * strict NestedMixinDefinition rule (requires the `()` arg list AND a `{}` body,
 * so it can't match a plain declaration or a `.name {}` ruleset) parses it into a
 * real Mixin node with its declarations.
 */
import { describe, test, expect } from 'vitest';
import { parseLessFn } from '../src/functional-parser.js';
import { serializeTypes } from '@jesscss/core';

describe('nested mixin definitions', () => {
  test('.vars() { … } inside a ruleset parses into a Mixin with its body', () => {
    const r = parseLessFn('.ns1 {\n  foo: bar;\n  .vars() {\n    sub: value;\n  }\n}');
    expect(r.errors).toHaveLength(0);
    const ser = serializeTypes(r.tree);
    expect(ser).toContain('(Mixin');
    expect(ser).toContain('\'.vars\'');
    expect(ser).toContain('\'sub\'');      // the body declaration survives
  });

  test('a guarded nested definition `.m(@a) when (@a) { … }` parses', () => {
    const r = parseLessFn('.outer {\n  .m(@a) when (@a > 0) {\n    x: @a;\n  }\n}');
    expect(r.errors).toHaveLength(0);
    expect(serializeTypes(r.tree)).toContain('(Mixin');
  });

  test('a plain declaration is NOT misparsed as a mixin definition', () => {
    const r = parseLessFn('.a {\n  width: calc(1px + 2px);\n}');
    expect(r.errors).toHaveLength(0);
    const ser = serializeTypes(r.tree);
    expect(ser).toContain('(Declaration');
    expect(ser).not.toContain('(Mixin');
  });
});
