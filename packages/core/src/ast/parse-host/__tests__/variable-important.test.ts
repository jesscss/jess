/**
 * `!important` carried on a variable value — ast/ engine (Less `importantScope`).
 *
 * A variable whose value ends in `!important` (`@v: @c !important`) binds an
 * `Important` wrapper: the importance is a FLAG, not value bytes. Referencing the
 * variable resolves its inner value AND hoists a SINGLE trailing `!important` onto
 * the enclosing declaration — never emitting `!important` inline and never doubling
 * it when the referencing declaration is itself `!important`. Verified against
 * Less 4.x and the `variables` alpha golden (`.variable-important`).
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

describe('variable value !important', () => {
  it('resolves the inner reference and applies !important once', () => {
    expect(render('.x {\n  @c: #888;\n  @iv: @c !important;\n  same-color: @iv;\n}\n')).toBe(
      '.x {\n  same-color: #888 !important;\n}\n',
    );
  });

  it('does not double when the referencing declaration is also !important', () => {
    expect(render('.x {\n  @c: #888;\n  @iv: @c !important;\n  same-again: @iv !important;\n}\n')).toBe(
      '.x {\n  same-again: #888 !important;\n}\n',
    );
  });

  it('hoists a single trailing !important across a multi-value reference', () => {
    expect(render('.x {\n  @c: #888;\n  @iv: @c !important;\n  multi: @iv @iv, #888;\n}\n')).toBe(
      '.x {\n  multi: #888 #888, #888 !important;\n}\n',
    );
  });
});
