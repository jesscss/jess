/**
 * Bare value-position call in statement position (`e('…');`) — ast/ engine.
 *
 * Less evaluates a lone call statement and prints its result bytes as a
 * standalone line (an `Anonymous` at document scope, no trailing `;`). The
 * canonical case is an `e(...)` unquote emitting its inner text — see the
 * `css-escapes` alpha fixture, whose final line is exactly this.
 */
import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

function render(src: string, collapseNesting = true): string {
  const res = renderAstDoc(src, { evaluator: buildEvaluator(makeBuiltinRegistry()), collapseNesting });
  if (res.threw) throw res.threw;
  if (res.css === undefined) throw new Error(`no css; parseErrors=${JSON.stringify(res.parseErrors)}`);
  return res.css;
}

describe('bare call statement', () => {
  it('emits an e() unquote at the document root (flat)', () => {
    expect(render(`.a {\n  color: red;\n}\ne('/* unq */');`)).toBe(
      `.a {\n  color: red;\n}\n/* unq */\n`,
    );
  });

  it('emits an e() unquote at the document root (nested)', () => {
    expect(render(`.a {\n  color: red;\n}\ne('/* unq */');`, false)).toBe(
      `.a {\n  color: red;\n}\n/* unq */\n`,
    );
  });
});
