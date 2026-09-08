import { describe, expect, it } from 'vitest';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';
import { buildEvaluator } from '../evaluator.js';
import { makeLessRegistry } from '@jesscss/fns';
import { serialize } from '../serialize.js';
import { Context } from '../../context.js';

/**
 * [R16] Rule-pin: a mixin / detached-ruleset BODY resolves a free reference in its
 * DEFINITION scope + params only, NEVER the ambient call site — for EVERY read form
 * (plain `@var`, member-access base `@p[k]`, and the `$prop` accessor), not just the
 * plain value read. Under DEFAULT options a caller-only free reference is a hermetic
 * miss (error / not-found); with `{ allowCallerScope: true }` the legacy Less dynamic
 * caller-read is restored. This pins the rule independently of the migration fixtures,
 * so any future re-widening of the caller `fallback` traversal fails here.
 */
const evaluator = buildEvaluator(makeLessRegistry());
const render = (src: string, allowCallerScope = false): string =>
  serialize(parseLess(src), {
    evaluator,
    collapseNesting: true,
    ...(allowCallerScope ? { context: new Context({ allowCallerScope: true }) } : {})
  }).css ?? '';

/*
 * Hermetic = the body does NOT reach the caller value. Depending on the read form
 * that surfaces as a strict miss (throw, bare `@var`/`$prop`) or an unresolved
 * verbatim passthrough (`@p[k]`) — both mean "did not read the call site", so the
 * uniform invariant is: the caller value never appears in the default output.
 */
const tryRender = (src: string): string => {
  try {
    return render(src);
  } catch {
    return '<<error>>';
  }
};

describe('R16 hermetic body scoping — every read form', () => {
  it('plain @var: caller-only free var does not read the caller by default; the flag restores it', () => {
    const src = '.mk() { c: @x; }\n.a { @x: red; .mk(); }\n';
    expect(tryRender(src)).not.toContain('red');
    expect(render(src, true)).toContain('c: red');
  });

  it('member-access base @p[k]: a caller-only detached ruleset base is hermetic by default', () => {
    const src = '.mk() { c: @p[k]; }\n.a { @p: { k: green; }; .mk(); }\n';
    expect(tryRender(src)).not.toContain('green');
    expect(render(src, true)).toContain('c: green');
  });

  it('$prop accessor: a caller-only property is hermetic by default; the flag restores it', () => {
    const src = '.mk() { c: $color; }\n.a { color: blue; .mk(); }\n';
    expect(tryRender(src)).not.toContain('blue');
    expect(render(src, true)).toContain('c: blue');
  });

  it('a definition-scope binding of the same name is unaffected (still wins)', () => {
    const src = '@x: DEF;\n.mk() { c: @x; }\n.a { @x: CALLER; .mk(); }\n';
    expect(render(src)).toContain('c: DEF');
    expect(render(src, true)).toContain('c: DEF');
  });
});
