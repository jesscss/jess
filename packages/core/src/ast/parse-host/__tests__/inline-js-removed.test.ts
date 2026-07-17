/**
 * Inline JavaScript (backticks) was removed in Less v5 (see the memory note
 * `backtick-js-removed-v5`). The Parseman grammar has no backtick token, so the
 * ast/ render path would otherwise emit the raw `` `…` `` bytes verbatim. The
 * whole-doc driver guards the source the same way `LessParser.parse` does and
 * surfaces the IDENTICAL migration diagnostic (reused from `@jesscss/less-parser`)
 * instead. Mirrors `packages/less-parser/test/values.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { INLINE_JS_UNSUPPORTED_MESSAGE } from '@jesscss/less-parser';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';
import { renderAstDoc } from './whole-doc-driver.js';

const render = (src: string) => renderAstDoc(src, { evaluator: buildEvaluator(makeBuiltinRegistry()) });

describe('inline JavaScript removed (ast/ render)', () => {
  it('errors with the @use migration message instead of emitting raw backticks', () => {
    const res = render('.eval {\n  js: `42`;\n}\n');
    expect(res.css).toBeUndefined();
    expect(res.threw).not.toBeNull();
    expect(res.threw?.message).toBe(INLINE_JS_UNSUPPORTED_MESSAGE);
  });

  it('errors on an escaped (`~\\`…\\``) inline-JS value too', () => {
    const res = render('.scope {\n  escaped: ~`2 + 5 + \'px\'`;\n}\n');
    expect(res.css).toBeUndefined();
    expect(res.threw?.message).toBe(INLINE_JS_UNSUPPORTED_MESSAGE);
  });

  it('does NOT flag a backtick inside a comment', () => {
    const res = render('// see `foo` in docs\n.a {\n  color: red;\n}\n');
    expect(res.threw).toBeNull();
    expect(res.css).toContain('color: red');
  });
});
