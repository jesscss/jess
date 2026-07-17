/**
 * Mixin-call variable UNLOCKING (scope leak) on the direct parse host
 * (`parseToAst` → `serialize`).
 *
 * Less semantics (matches less@4): a `@x:` declared inside a called mixin body
 * becomes visible in the CALLER's scope, evaluated in the CALLEE frame (params
 * bound). Before this the direct host dropped the body's `@x:` on the floor, so a
 * caller reference to a mixin-defined variable threw `variable @x is undefined`
 * (the `scope.less` alpha-corpus THREW — gap E5). The leak is byte-scoped to the
 * calling frame: it does NOT escape to an unrelated sibling block.
 *
 * Expected CSS is real less@4 output (verified against `less-4x`).
 */
import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

function render(src: string): string {
  const res = renderAstDoc(src, { evaluator: buildEvaluator(makeBuiltinRegistry()) });
  expect(res.threw, res.threw?.message).toBeNull();
  expect(res.parseErrors, JSON.stringify(res.parseErrors)).toEqual([]);
  return res.css ?? '';
}

describe('mixin-call variable unlocking (direct host)', () => {
  it('a mixin-defined variable is visible to a later sibling block', () => {
    const src =
      '.setHeight(@h) { @height: 1024px; }\n' +
      '@mainHeight: 50%;\n' +
      '.setHeight(@mainHeight);\n' +
      '.heightIsSet { height: @height; }';
    expect(render(src)).toBe('.heightIsSet {\n  height: 1024px;\n}\n');
  });

  it('the leaked value is snapshotted in the callee frame (param-bound)', () => {
    const src = '.m(@x) { @y: @x; }\n.m(7);\n.out { z: @y; }';
    expect(render(src)).toBe('.out {\n  z: 7;\n}\n');
  });

  it('an outer binding wins over the mixin-unlocked value (v5 outer-binding-wins)', () => {
    const src =
      '@mix: none;\n' +
      '.mixin {\n  @mix: #989;\n}\n' +
      '@mix: blue;\n' +
      '.tiny-scope {\n  color: @mix;\n  .mixin();\n}\n' +
      '.after-scope {\n  color: @mix;\n}';
    // v5 (owner corpus `a0e4e494` "Fix scope value in v5", `scope/scope.css`):
    // the mixin-unlocked `@mix: #989` is a LOW-PRIORITY leak — it no longer hoists
    // over the enclosing `@mix: blue`, so `.tiny-scope` resolves the root binding
    // (`blue`), not the injected `#989`. 4.x (`scope/legacy/scope.css`) emitted
    // `#989` here; that is the dying shape. `.after-scope` (a separate sibling
    // frame) resolves the root `@mix: blue` in both.
    expect(render(src)).toBe(
      '.tiny-scope {\n  color: blue;\n}\n' + '.after-scope {\n  color: blue;\n}\n',
    );
  });
});
