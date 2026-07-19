import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * Less namespace / property-accessor lookups in the ast/ engine: `#ns.member[key]`
 * (namespace member access — a mixin call whose evaluated body members form a map),
 * and the disjoint member namespaces (`@name` reads a VARIABLE member, a bare/`$name`
 * key reads a PROPERTY member — never falling back to each other, per Less 4.x).
 * Verified against `lessc` (4.x) — see fixtures `namespacing-1..7`.
 */
const ev = buildEvaluator(makeBuiltinRegistry());
const render = (src: string): string | undefined =>
  renderAstDoc(src, { evaluator: ev, collapseNesting: true }).css;

describe('namespace / property accessor', () => {
  it('reads a PROPERTY member of a plain ruleset (bare key)', () => {
    expect(render('#ns { foo: bar; @foo: baz; }\n.t { a: #ns[foo]; }\n'))
      .toContain('a: bar;');
  });

  it('reads a VARIABLE member (`@key`), disjoint from the property namespace', () => {
    expect(render('#ns { foo: bar; @foo: baz; }\n.t { a: #ns[@foo]; }\n'))
      .toContain('a: baz;');
  });

  it('reads a `.member()` variable through namespace descent', () => {
    const css = render('#ns { .mixin() { @height: 200px; } }\n.t { a: #ns.mixin[@height]; }\n');
    expect(css).toContain('a: 200px;');
  });

  it('descends into a parametric namespace container (`#DEF() { .colors() {…} }`)', () => {
    const css = render(
      '#DEF() { .colors() { primary: grey; } }\n.t { a: #DEF.colors[primary]; }\n',
    );
    expect(css).toContain('a: grey;');
  });

  it('reads a member through a namespace mixin CALL with args', () => {
    const css = render(
      '#library { .add-one(@val) { @return: @val + 1px; } }\n' +
      '.t { a: #library.add-one(1px)[@return]; }\n',
    );
    expect(css).toContain('a: 2px;');
  });

  it('chains an accessor over the last-declaration-wins of two rulesets', () => {
    const css = render('#ns { p: one; }\n#ns { p: two; }\n.t { a: #ns[p]; }\n');
    expect(css).toContain('a: two;');
  });

  it('reads a `.mixin` member set by a NESTED call (variable leak)', () => {
    const css = render(
      '#ns { .mixin(@a) when (@a = 1) { @a: 20px; } }\n' +
      '.alias() { #ns.mixin(1); }\n' +
      '.t { a: .alias[@a]; }\n',
    );
    expect(css).toContain('a: 20px;');
  });

  it('dispatches a mixin-call-valued variable called as `@alias()`', () => {
    const css = render(
      '.something(foo) { width: 10px; }\n' +
      '.rule { @alias: .something(foo); @alias(); }\n',
    );
    expect(css).toContain('width: 10px;');
  });
});
