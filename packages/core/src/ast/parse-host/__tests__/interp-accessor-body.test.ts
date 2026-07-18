import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * §4.1 interpolation-body accessor: `@{map[key]}` interpolation resolves end-to-end on
 * the DIRECT ast/ host (`parseToAst` → `serialize`).
 *
 * The grammar STRUCTURES the `@{…}` body into a `LessInterp` node (head + `[key]`
 * accessor leaves); the host `LessInterp` action builds the SAME `MapAccessor` value
 * node the value-position `@map[key]` path produces, so the interp part's ref flows
 * through `evalInterp`/`evalMapAccessor` and resolves. The zero-accessor `@{name}`
 * stays a plain variable ref (byte-identical). A `.`-call in the body is NOT accepted
 * (read-only) and is a HARD parse error.
 */
function render(src: string): string {
  const res = renderAstDoc(src, { evaluator: buildEvaluator(makeBuiltinRegistry()) });
  expect(res.threw, res.threw?.message).toBeNull();
  expect(res.parseErrors, JSON.stringify(res.parseErrors)).toEqual([]);
  return res.css ?? '';
}

describe('interp body accessor `@{map[key]}` resolves (direct ast/ host)', () => {
  it('value-position `@map[key]` still resolves (baseline the interp mirrors)', () => {
    expect(render('@m: { p: blue; }\na { color: @m[p]; }\n')).toContain('color: blue');
  });

  it('`@{m[p]}` in a SELECTOR resolves to the looked-up member', () => {
    expect(render('@m: { p: blue; }\n.@{m[p]} { color: red; }\n')).toContain('.blue {');
  });

  it('`@{m[p]}` in an escaped STRING value resolves', () => {
    expect(render('@m: { p: blue; }\na { color: ~"@{m[p]}"; }\n')).toContain('color: blue');
  });

  it('`@{m[p]}` in a quoted STRING value resolves (keeps quotes)', () => {
    expect(render('@m: { p: blue; }\na { content: "x-@{m[p]}-y"; }\n')).toContain('content: "x-blue-y"');
  });

  it('`@{m[p]}` in a custom-property VALUE resolves', () => {
    expect(render('@m: { p: blue; }\na { --c: @{m[p]}; }\n')).toContain('--c: blue');
  });

  it('`@{m[p]}` in an at-rule PRELUDE resolves', () => {
    expect(render('@m: { p: blue; }\n@foo @{m[p]} { a { color: red; } }\n')).toContain('@foo blue {');
  });

  it('zero-accessor `@{name}` stays a plain variable ref (byte-identical)', () => {
    expect(render('@n: foo;\n.@{n} { color: red; }\n')).toContain('.foo {');
    expect(render('@n: foo;\na { content: "x@{n}y"; }\n')).toContain('content: "xfooy"');
  });

  it('a `.`-call in the interp body is a HARD parse error (read-only body)', () => {
    const res = renderAstDoc('@m: 1;\n.@{m.call()} { color: red; }\n', {
      evaluator: buildEvaluator(makeBuiltinRegistry()),
    });
    expect(res.parseErrors.length, JSON.stringify(res.parseErrors)).toBeGreaterThan(0);
  });
});
