import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * `if(cond, {…}, {…})` returning a DETACHED RULESET.
 *
 * `if()` is branch-lazy: the taken branch folds. When that branch is a detached
 * ruleset (`{ … }`), the result is the detached-ruleset value itself, so a
 * variable bound to it can be CALLED (`@x();`) — which splices the chosen
 * branch's declarations into the calling context (matching less.js). The
 * detached-ruleset resolver therefore follows the same `if()` a `@var()` call
 * would, choosing the true branch or the false/else branch by the condition.
 *
 * A statement-position `if((false), {…})` whose taken branch is absent is VOID:
 * it emits nothing AND is not a nested-container boundary — following
 * declarations stay in the same block rather than opening a fresh partition.
 */
const ev = buildEvaluator(makeBuiltinRegistry());
const render = (src: string): string | undefined =>
  renderAstDoc(src, { evaluator: ev, collapseNesting: true }).css;

describe('if() returning a detached ruleset', () => {
  it('if-true → splices the THEN branch declarations', () => {
    const css = render('.a {\n  @x: if((true), { color: green; }, { color: red; });\n  @x();\n}\n');
    expect(css).toBe('.a {\n  color: green;\n}\n');
  });

  it('if-false → splices the ELSE branch declarations', () => {
    const css = render('.a {\n  @x: if((false), { color: orange; }, { color: purple; });\n  @x();\n}\n');
    expect(css).toBe('.a {\n  color: purple;\n}\n');
  });

  it('condition uses the guard evaluator (not(false) → THEN)', () => {
    const css = render('.a {\n  @x: if(not(false), { c: 3; }, { d: 4; });\n  @x();\n}\n');
    expect(css).toBe('.a {\n  c: 3;\n}\n');
  });

  it('void statement-level if((false), {…}) drops cleanly and is not a block boundary', () => {
    const css = render(
      '.a {\n  x: 1;\n  if((false), { g: 7; }); /* void */\n  y: 2;\n}\n',
    );
    expect(css).toBe('.a {\n  x: 1;\n  /* void */\n  y: 2;\n}\n');
  });
});
