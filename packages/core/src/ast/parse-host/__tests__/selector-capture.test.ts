import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * Selector-list CAPTURE `*[…]` + interpolated-group `:is()` compaction (Less v5).
 *
 * `@cls: *[.a, .b, .c]` captures a comma selector list. Interpolated into a
 * selector as `@{cls}`, it expands by POSITION:
 *   - WHOLE selector  → one header branch per captured selector (comma-newline);
 *   - COMPOUND (embedded in / adjacent to other tokens) → a single `:is(…)` group.
 * The escaped `~'…'` quoted variant routes through the SAME `:is(…)` compaction in
 * compound position, but a whole-selector `~'…'` stays a single verbatim branch
 * (its commas are opaque bytes, not a parser-owned structured split).
 */
const render = (src: string): string => {
  const res = renderAstDoc(src, {
    evaluator: buildEvaluator(makeBuiltinRegistry()),
    collapseNesting: false,
  });
  if (res.threw) throw res.threw;
  return res.css;
};

describe('ast/ selector-list capture `*[…]` + interpolated-group `:is()`', () => {
  it('whole-selector capture expands to comma-separated header branches', () => {
    expect(render('@cls: *[.a, .b, .c];\n@{cls} {\n  x: 1;\n}\n')).toBe(
      '.a,\n.b,\n.c {\n  x: 1;\n}\n',
    );
  });

  it('compound-position capture compacts to a single `:is(…)`', () => {
    expect(render('@cls: *[.a, .b, .c];\n.bar {\n  .d@{cls}&:hover {\n    x: 1;\n  }\n}\n')).toBe(
      '.bar {\n  .d:is(.a, .b, .c)&:hover {\n    x: 1;\n  }\n}\n',
    );
  });

  it('adjacent group interpolations each wrap in their own `:is(…)`', () => {
    expect(render('@c: *[.a, .b];\n@d: *[.c, .d];\n@{c}@{d} {\n  x: 1;\n}\n')).toBe(
      ':is(.a, .b):is(.c, .d) {\n  x: 1;\n}\n',
    );
  });

  it('single-branch capture splices its lone branch bare (no `:is(…)`)', () => {
    expect(render('@one: *[.only];\n.bar {\n  .d@{one} {\n    x: 1;\n  }\n}\n')).toBe(
      '.bar {\n  .d.only {\n    x: 1;\n  }\n}\n',
    );
  });

  it('quoted `~\'…\'` group compacts to `:is(…)` in compound position', () => {
    expect(render("@cls: ~'.a, .b, .c';\n.bar {\n  .q@{cls}&:hover {\n    x: 1;\n  }\n}\n")).toBe(
      '.bar {\n  .q:is(.a, .b, .c)&:hover {\n    x: 1;\n  }\n}\n',
    );
  });

  it('whole-selector quoted `~\'…\'` stays a single verbatim branch (no expansion)', () => {
    expect(render("@cls: ~'.a, .b, .c';\n@{cls} {\n  x: 1;\n}\n")).toBe(
      '.a, .b, .c {\n  x: 1;\n}\n',
    );
  });

  it('captured branches carrying `&` keep the ampersand literal when nested', () => {
    expect(render('@cls: *[&[class="text"], &.text];\ninput {\n  @{cls} {\n    x: 1;\n  }\n}\n')).toBe(
      'input {\n  &[class="text"],\n  &.text {\n    x: 1;\n  }\n}\n',
    );
  });
});
