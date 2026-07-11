import { describe, it, expect, beforeEach } from 'vitest';
import {
  rules, ruleset, decl, mixin, sel, el, spaced, call, ref, selcap, list,
  type Node, type Reference
} from '../index.js';
import { Context } from '../../context.js';
import { renderNodeToString } from '../util/render-buffer.js';

/**
 * Bracket-capture call `*[.foo]()` vs dot mixin-ruleset call `*.foo()`.
 *
 * `*[.foo]()` — the reference KEY is a `SelectorCapture` — resolves RULESET-only
 * (like `$apply`): a same-named `.foo` Mixin is excluded. `*.foo()` — a string key,
 * `type: 'mixin-ruleset'`, no capture — is UNCHANGED (matches both mixin + ruleset).
 * The two are distinct constructs / lookup paths.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- test builds reference/call nodes by hand */

// `*[.foo]()` name: a Reference whose key is a SelectorCapture of `.foo`.
function bracketCaptureCallName(type: 'mixin' | 'mixin-ruleset'): Reference {
  return ref({ key: selcap(el('.foo')) as unknown as Node }, { type }) as Reference;
}

// `*.foo()` name: a Reference with a string key, `type: 'mixin-ruleset'`, no capture.
function dotMixinRulesetCallName(): Reference {
  return ref({ key: '.foo' }, { type: 'mixin-ruleset' }) as Reference;
}

function makeCall(name: Reference): Node {
  return call({ name, args: list([]) }) as unknown as Node;
}

// scope: `.foo { a: rulesetval }` (Ruleset) + `.foo() { b: mixinval }` (Mixin).
function scopeDefs(): Node[] {
  return [
    ruleset({ selector: sel([el('.foo')]), rules: [decl({ name: 'a', value: spaced([el('rulesetval')]) })] }) as unknown as Node,
    mixin({ name: '.foo', rules: [decl({ name: 'b', value: spaced([el('mixinval')]) })] }) as unknown as Node
  ];
}

function boxWith(callNode: Node): ReturnType<typeof rules> {
  return rules([
    ...scopeDefs(),
    ruleset({ selector: sel([el('.box')]), rules: [callNode] }) as unknown as Node
  ]);
}

describe('SelectorCapture call `*[.foo]()` — ruleset-only', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('`*[.foo]()` matches ONLY the ruleset, excluding the same-named mixin', async () => {
    const css = await renderNodeToString(boxWith(makeCall(bracketCaptureCallName('mixin'))), context, { context: context, preSerializeRoot: r => r });
    const box = css.slice(css.indexOf('.box {'));

    expect(box).toContain('a: rulesetval');
    expect(box).not.toContain('mixinval');
  });

  it('`*[.foo]()` is ruleset-only regardless of the reference `type` option', async () => {
    const css = await renderNodeToString(boxWith(makeCall(bracketCaptureCallName('mixin-ruleset'))), context, { context: context, preSerializeRoot: r => r });
    const box = css.slice(css.indexOf('.box {'));

    expect(box).toContain('a: rulesetval');
    expect(box).not.toContain('mixinval');
  });

  it('dot `*.foo()` (mixin-ruleset, no capture key) is UNCHANGED — matches BOTH', async () => {
    const css = await renderNodeToString(boxWith(makeCall(dotMixinRulesetCallName())), context);
    const box = css.slice(css.indexOf('.box {'));

    expect(box).toContain('a: rulesetval');
    expect(box).toContain('b: mixinval');
  });

  it('bracket and dot forms DIVERGE on the same scope (ruleset-only vs both)', async () => {
    const bracketCss = await renderNodeToString(boxWith(makeCall(bracketCaptureCallName('mixin-ruleset'))), new Context(), { context: new Context(), preSerializeRoot: r => r });
    const dotCss = await renderNodeToString(boxWith(makeCall(dotMixinRulesetCallName())), context, { context: context, preSerializeRoot: r => r });

    expect(bracketCss).not.toContain('mixinval');
    expect(dotCss).toContain('mixinval');
  });
});
