/**
 * `default()` used as a comparison OPERAND in a mixin guard — ast/ engine.
 *
 * `default()` is only the dispatch decision (true iff no non-default def matched).
 * Besides a bare `when (default())` term it may appear inside a comparison operand,
 * `when (@x = default())`: such a def must be dispatched in the SECOND (default-
 * deciding) pass with `default()` bound to the real decision. Verified against Less
 * 4.x and the `mixins-guards-default-func` alpha golden (`guard-default-expr-eq`).
 */
import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

function render(src: string): string {
  const res = renderAstDoc(src, { evaluator: buildEvaluator(makeBuiltinRegistry()), collapseNesting: true });
  if (res.threw) throw res.threw;
  if (res.css === undefined) throw new Error(`no css; parseErrors=${JSON.stringify(res.parseErrors)}`);
  return res.css;
}

const SRC = [
  'g {',
  '  .m(@x) when (@x = true)      {case: @x}',
  '  .m(@x) when (@x = false)     {case: @x}',
  '  .m(@x) when (@x = default()) {default: @x}',
  '  &-true  {.m(true)}',
  '  &-false {.m(false)}',
  '}',
  '',
].join('\n');

describe('default() as a comparison operand', () => {
  it('the @x = default() branch fires only when no non-default def matched', () => {
    // `.m(false)` matches `@x = false` (a non-default), so default() is false and
    // `@x = default()` (false = false) ALSO matches -> both lines emit.
    // `.m(true)` matches `@x = true`, so default() is false and `@x = default()`
    // (true = false) does NOT match -> only `case: true`.
    expect(render(SRC)).toBe(
      [
        'g-true {',
        '  case: true;',
        '}',
        'g-false {',
        '  case: false;',
        '  default: false;',
        '}',
        '',
      ].join('\n'),
    );
  });
});
