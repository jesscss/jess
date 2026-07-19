import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * Mixin dispatch/resolution in NESTED output mode (`collapseNesting:false`).
 *
 * The nested-output emitter (`emitNestedBody`/`expandNestedCall`) is a distinct
 * path from the flattened emitter (`walkBody`/`expandCall`); before this it did
 * not track a candidate's DEFINITION scope, did not treat paren-less rulesets as
 * zero-arg mixins, did not propagate a call's `!important`, and dropped a
 * mixin-published def's closure. These cases pin the resolution semantics of the
 * nested path to the flat path (oracle: less@4.6.3, matching the less.js
 * `mixin-noparens` / `mixins-closure` / `mixins-guards` / `mixins/mixins-advanced`
 * test-data fixtures rendered with `collapseNesting:false`).
 */
const ev = buildEvaluator(makeBuiltinRegistry());
const render = (src: string): string | undefined =>
  renderAstDoc(src, { evaluator: ev, collapseNesting: false }).css;

describe('nested-mode mixin resolution', () => {
  it('dispatches a paren-less namespaced ruleset called without () (mixin-noparens)', () => {
    const css = render(
      '#theme {\n  > .mixin {\n    background-color: grey;\n  }\n}\n'
        + '#container {\n  color: black;\n  #theme > .mixin;\n}\n',
    );
    expect(css).toBe(
      '#theme {\n  > .mixin {\n    background-color: grey;\n  }\n}\n'
        + '#container {\n  color: black;\n  background-color: grey;\n}\n',
    );
  });

  it("resolves a mixin body's free var in its DEFINITION scope, not the call site (mixins-closure)", () => {
    const css = render(
      '.nested {\n  @var: 5px;\n  .mixin () {\n    width: @var;\n  }\n'
        + '  .class {\n    @var: 10px;\n    .mixin();\n  }\n}\n',
    );
    // @var resolves to the def-scope 5px (closure), NOT the call-site 10px.
    expect(css).toBe('.nested {\n  .class {\n    width: 5px;\n  }\n}\n');
  });

  it('propagates a call-level !important onto the mixin body (mixins-advanced)', () => {
    const css = render(
      '.mixin-important() {\n  important: true;\n}\n'
        + '.test-important {\n  .mixin-important() !important;\n}\n',
    );
    expect(css).toBe('.test-important {\n  important: true !important;\n}\n');
  });

  it('keeps a published mixin def\'s closure so its guard/default read the expansion scope (call-lock)', () => {
    const css = render(
      '.lock-mixin(@a) {\n  .inner-locked-mixin(@x: @a) when (@a = 1) {\n    a: @a;\n    x: @x;\n  }\n}\n'
        + '.call-lock-mixin {\n  .lock-mixin(1);\n  .call-inner-lock-mixin {\n    .inner-locked-mixin();\n  }\n}\n',
    );
    expect(css).toBe(
      '.call-lock-mixin {\n  .call-inner-lock-mixin {\n    a: 1;\n    x: 1;\n  }\n}\n',
    );
  });
});
