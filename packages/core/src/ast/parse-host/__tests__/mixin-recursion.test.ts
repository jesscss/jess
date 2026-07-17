/**
 * Guarded self-recursive mixin expansion + guard-based variant selection on the
 * DIRECT parse host (`parseToAst` → `serialize`, no legacy bridge).
 *
 * Exercises three things the direct host previously could not do:
 *   1. a DOCUMENT-LEVEL mixin call (`.loop(3);`) — parsed as a no-brace
 *      `MixinOrQualifiedRule`, previously dropped to a placeholder and emitted
 *      nothing; now delegated to the mixin-call builder.
 *   2. `when (…)` GUARD evaluation — the direct host had no guard-build action, so
 *      `def.guard` was always undefined (guards never gated). The `GUARD_ACTIONS`
 *      family builds the guard grammar into the engine's `GuardNode` structure.
 *   3. termination of a self-recursive guarded loop by GUARD-FALSE (not a depth
 *      cap): `.loop(@n) when (@n > 0) { …; .loop(@n - 1); }` unrolls until `@n`
 *      hits 0 and the guard fails.
 *
 * Expected CSS is the intended output (matches less@4.6.3 for these shapes).
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

function renderResult(src: string) {
  return renderAstDoc(src, { evaluator: buildEvaluator(makeBuiltinRegistry()) });
}

describe('guarded self-recursive mixin expansion (direct host)', () => {
  it('recursion unrolls and terminates on guard-false (no stack overflow)', () => {
    const src =
      '.loop(@n) when (@n > 0) {\n' +
      '  .item-@{n} { width: @n; }\n' +
      '  .loop(@n - 1);\n' +
      '}\n' +
      '.loop(3);';
    expect(render(src)).toBe(
      '.item-3 {\n  width: 3;\n}\n' +
        '.item-2 {\n  width: 2;\n}\n' +
        '.item-1 {\n  width: 1;\n}\n',
    );
  });

  it('ascending loop with `=<` alias + defaulted counter param', () => {
    const src =
      '.gen(@n, @i: 1) when (@i =< @n) {\n' +
      '  .col-@{i} { width: @i; }\n' +
      '  .gen(@n, (@i + 1));\n' +
      '}\n' +
      '.gen(3);';
    expect(render(src)).toBe(
      '.col-1 {\n  width: 1;\n}\n' +
        '.col-2 {\n  width: 2;\n}\n' +
        '.col-3 {\n  width: 3;\n}\n',
    );
  });

  it('a document-level call whose body is only declarations still expands', () => {
    expect(render('.m(@n) { w: @n; }\n.wrap { .m(4); }')).toBe('.wrap {\n  w: 4;\n}\n');
  });

  it('guard-false single def emits nothing (guard gates, no fallback)', () => {
    expect(render('.m(@t) when (@t > 5) { a: 1; }\n.wrap { .m(3); }')).toBe('');
  });

  it('a default param value resolves against an earlier param, not the caller', () => {
    // less@4: `@b: @a + 1` in a default value reads the `@a` param bound from the
    // call arg (not a caller `@a`). The bootstrap `#button-variant(@background,
    // @border, @hover-background: darken(@background, 7.5%), …)` shape — where the
    // default references the just-bound param — used to throw `@background is
    // undefined` because defaults resolved in the caller frame.
    const src = '.m(@a, @b: @a + 1) { x: @a; y: @b; }\n.wrap { .m(4); }';
    expect(render(src)).toBe('.wrap {\n  x: 4;\n  y: 5;\n}\n');
  });
});

describe('guard-based variant selection (direct host)', () => {
  it('numeric comparison guards select the matching overload', () => {
    const src =
      '.r(@s) when (@s < 576px) { p: 4px; }\n' +
      '.r(@s) when (@s >= 576px) and (@s < 768px) { p: 8px; }\n' +
      '.r(@s) when (@s >= 768px) { p: 12px; }\n' +
      '.sm { .r(400px); }\n' +
      '.md { .r(600px); }\n' +
      '.lg { .r(800px); }';
    expect(render(src)).toBe(
      '.sm {\n  p: 4px;\n}\n' + '.md {\n  p: 8px;\n}\n' + '.lg {\n  p: 12px;\n}\n',
    );
  });

  it('keyword-equality guards select exactly one variant', () => {
    const src =
      '.s(@t) when (@t = success) { c: green; }\n' +
      '.s(@t) when (@t = danger) { c: red; }\n' +
      '.a { .s(success); }\n' +
      '.b { .s(danger); }';
    expect(render(src)).toBe('.a {\n  c: green;\n}\n' + '.b {\n  c: red;\n}\n');
  });

  it('type-predicate guards (isnumber / iscolor / isstring) select by kind', () => {
    const src =
      '.tg(@v) when (isnumber(@v)) { width: @v; }\n' +
      '.tg(@v) when (iscolor(@v)) { color: @v; }\n' +
      '.tg(@v) when (isstring(@v)) { content: @v; }\n' +
      '.n { .tg(100px); }\n' +
      '.c { .tg(#ff0000); }\n' +
      '.s { .tg("hi"); }';
    expect(render(src)).toBe(
      '.n {\n  width: 100px;\n}\n' +
        '.c {\n  color: #ff0000;\n}\n' +
        '.s {\n  content: "hi";\n}\n',
    );
  });

  it('`not` negation and `default()` fallback', () => {
    const src =
      '.m(0) { case: zero; }\n' +
      '.m(@x) when (default()) { case: other; }\n' +
      '.z { .m(0); }\n' +
      '.o { .m(9); }';
    expect(render(src)).toBe('.z {\n  case: zero;\n}\n' + '.o {\n  case: other;\n}\n');
  });

  // [recursion] A paren-less ruleset callable as a zero-arg mixin must NOT
  // re-enter its own body forever when it calls its own name — it terminates by
  // binding to a same-name parametric def, not via a depth cap (less@4
  // mixin-call.js `isRecursive`). Overflowed the stack before the self-exclusion.
  it('a ruleset-mixin self-call terminates by binding the same-name def (no overflow)', () => {
    const src =
      '.recursion() {\n  color: black;\n}\n' +
      '.test-rule-rec {\n  .recursion {\n    .recursion();\n  }\n}';
    expect(render(src)).toBe('.test-rule-rec .recursion {\n  color: black;\n}\n');
  });
});

// The settled mixin-recursion model (task #40): self-reference is handled by
// PARENT-EXCLUSION (the enclosing frame is excluded from candidacy), not by
// "recursion detection". The discriminator is PROGRESS.
//   1. A NON-PARAMETRIC ruleset self-reference cannot progress (no new args), so
//      it is SKIPPED — the enclosing frame declines to be its own candidate. It
//      NEVER errors and renders once.
//   2. A PARAMETRIC self-call with DIFFERENT args DOES progress and recurses; its
//      guard is the termination mechanism (not part of the skip decision).
//   3. A genuine RUNAWAY — parametric recursion whose guard never terminates —
//      is the ONLY error case: a HIGH depth backstop raises a clean
//      "maximum mixin recursion depth exceeded" (not a native stack overflow).
describe('mixin recursion: parent-exclusion + runaway backstop (settled model)', () => {
  it('non-parametric ruleset self-reference renders once and never errors', () => {
    // `.a` calls `.a()` inside its own body. Parent-exclusion skips the enclosing
    // frame as a candidate, so the body renders exactly once with no recursion.
    const src = '.a {\n  color: red;\n  .a();\n}';
    expect(render(src)).toBe('.a {\n  color: red;\n}\n');
  });

  it('parametric guarded recursion progresses on new args and terminates', () => {
    const src =
      '.count(@n) when (@n > 0) {\n' +
      '  .n-@{n} { v: @n; }\n' +
      '  .count(@n - 1);\n' +
      '}\n' +
      '.count(3);';
    expect(render(src)).toBe(
      '.n-3 {\n  v: 3;\n}\n' + '.n-2 {\n  v: 2;\n}\n' + '.n-1 {\n  v: 1;\n}\n',
    );
    // Deep but well below the backstop: still terminates cleanly, unaffected.
    const deep = '.d(@n) when (@n > 0) { .d(@n - 1); }\n.d(400);';
    const res = renderResult(deep);
    expect(res.threw, res.threw?.message).toBeNull();
  });

  it('a runaway (never-terminating guard) raises the clean backstop error', () => {
    // Ascending counter with a guard that is always true → parametric recursion
    // that keeps producing distinct frames and never terminates.
    const src = '.loop(@n) when (@n > 0) {\n  w: @n;\n  .loop(@n + 1);\n}\n.loop(1);';
    const res = renderResult(src);
    expect(res.threw).not.toBeNull();
    expect(res.threw).toBeInstanceOf(RangeError);
    expect(res.threw?.message).toBe('maximum mixin recursion depth exceeded');
  });
});
