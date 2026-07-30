import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { defineFunction } from '../value-dispatch.js';
import { decl, anonymousMixin, funcCall, keyword, mixinCall, mixinDef, quoted, reference, rule, stylesheet, variableDeclaration, variableReference } from '../nodes.js';
import { atRuleBlock, plugin } from '../at-rule.js';
import { lookupScopedFn, makeFnScope, serialize, type Frame } from '../serialize.js';
import type { PluginHost } from '../value-eval.js';
import { makeKeyword } from '../value-factory.js';

const evaluator = buildEvaluator(makeLessRegistry());

const fn = (name: string, value: string) => defineFunction(name, {
  params: [],
  body: () => makeKeyword(value)
});
const asyncFn = (name: string, value: string) => defineFunction(name, {
  params: [],
  body: () => Promise.resolve(makeKeyword(value))
});
const target = (specifier: string) => plugin(quoted(`'${specifier}'`, specifier, '\'', false));
const frame = (parent: Frame | null): Frame => ({
  parent,
  mixins: null,
  declIndex: null,
  cells: null,
  reassign: null
});

describe('typed Plugin lexical body preparation', () => {
  it('caches the nearest registered function frame without allocating empty local maps', () => {
    const root = frame(null);
    const middle = frame(root);
    const leaf = frame(middle);
    const rootFn = fn('probe', 'root');
    const state = { fnScopeVersion: 0 };

    root.fns = new Map([[rootFn.name, rootFn]]);
    root.fnScope = root;
    root.fnScopeVersion = state.fnScopeVersion;

    const scope = makeFnScope(leaf, state);
    expect(scope.lookup('PROBE')).toBe(rootFn);
    expect(leaf.fnScope).toBe(root);
    expect(leaf.fns).toBeUndefined();
    expect(middle.fns).toBeUndefined();

    const localFn = fn('probe', 'middle');
    middle.fns = new Map([[localFn.name, localFn]]);
    middle.fnScope = middle;
    state.fnScopeVersion++;
    middle.fnScopeVersion = state.fnScopeVersion;

    expect(scope.lookup('probe')).toBe(localFn);
    expect(leaf.fnScope).toBe(middle);
    expect(leaf.fns).toBeUndefined();
  });

  it('does not let an unrelated local scoped function block the requested outer entry', () => {
    const root = frame(null);
    const middle = frame(root);
    const leaf = frame(middle);
    const rootFn = fn('probe', 'root');
    const unrelatedFn = fn('other', 'middle');
    const state = { fnScopeVersion: 0 };

    root.fns = new Map([[rootFn.name, rootFn]]);
    middle.fns = new Map([[unrelatedFn.name, unrelatedFn]]);
    root.fnScope = root;
    middle.fnScope = middle;
    root.fnScopeVersion = state.fnScopeVersion;
    middle.fnScopeVersion = state.fnScopeVersion;

    const scope = makeFnScope(leaf, state);
    expect(scope.lookup('probe')).toBe(rootFn);
    expect(lookupScopedFn(leaf, 'probe', state)).toBe(rootFn);
    expect(scope.lookup('other')).toBe(unrelatedFn);
    expect(scope.lookup('missing')).toBeUndefined();
  });

  it('hoists direct typed Plugins over both earlier and later statements in one body', () => {
    const seen: string[] = [];
    const pluginHost: PluginHost = { loadPlugin: ({ specifier }) => {
      seen.push(specifier);
      return [fn('probe', 'root')];
    } };
    const document = stylesheet([
      rule('.before', [decl('value', funcCall('probe', []))]),
      target('root-plugin'),
      rule('.after', [decl('value', funcCall('probe', []))])
    ]);

    expect(serialize(document, { evaluator, pluginHost }).css).toBe('.before {\n  value: root;\n}\n.after {\n  value: root;\n}\n');
    expect(seen).toEqual(['root-plugin']);
  });

  it('shadows only inside the nested body and does not leak into a sibling', () => {
    const host: PluginHost = {
      loadPlugin: ({ specifier }) => [fn('probe', specifier)],
      globalFns: [fn('probe', 'global')]
    };
    const document = stylesheet([
      rule('.outer', [target('inner'), decl('value', funcCall('probe', []))]),
      rule('.sibling', [decl('value', funcCall('probe', []))])
    ]);

    expect(serialize(document, { evaluator, pluginHost: host }).css).toBe('.outer {\n  value: inner;\n}\n.sibling {\n  value: global;\n}\n');
  });

  it('awaits a mixin-body Plugin before emitting earlier body leaves or later caller leaves', async () => {
    const host: PluginHost = {
      loadPlugin: async ({ specifier }) => [fn('probe', specifier)]
    };
    const document = stylesheet([
      mixinDef('.from-plugin', [], [
        decl('before', funcCall('probe', [])),
        target('mixin'),
        decl('after', funcCall('probe', []))
      ]),
      rule('.entry', [mixinCall('.from-plugin'), decl('outside', funcCall('probe', []))])
    ]);

    await expect(Promise.resolve(serialize(document, { evaluator, pluginHost: host }))).resolves.toEqual({
      css: '.entry {\n  before: mixin;\n  after: mixin;\n  outside: probe();\n}\n'
    });
  });

  it('awaits a detached-ruleset Plugin without leaking it into the caller frame', async () => {
    const host: PluginHost = {
      loadPlugin: async ({ specifier }) => [fn('probe', specifier)]
    };
    const document = stylesheet([
      variableDeclaration('theme', anonymousMixin([
        decl('before', funcCall('probe', [])),
        target('detached'),
        decl('after', funcCall('probe', []))
      ]), { mode: 'declare' }),
      rule('.entry', [
        reference(variableReference('theme', 'scoped'), [{ type: 'Call', args: [] }], '@theme()'),
        decl('outside', funcCall('probe', []))
      ])
    ]);

    await expect(Promise.resolve(serialize(document, { evaluator, pluginHost: host }))).resolves.toEqual({
      css: '.entry {\n  before: detached;\n  after: detached;\n  outside: probe();\n}\n'
    });
  });

  it('deduplicates exact async declaration values without discarding distinct values', async () => {
    const host: PluginHost = {
      loadPlugin: () => [asyncFn('same', 'same'), asyncFn('first', 'first'), asyncFn('second', 'second')]
    };
    const document = stylesheet([
      rule('.entry', [
        target('async-values'),
        decl('exact', funcCall('same', [])),
        decl('exact', funcCall('same', [])),
        decl('distinct', funcCall('first', [])),
        decl('distinct', funcCall('second', []))
      ])
    ]);

    await expect(Promise.resolve(serialize(document, { evaluator, pluginHost: host }))).resolves.toEqual({
      css: '.entry {\n  exact: same;\n  distinct: first;\n  distinct: second;\n}\n'
    });
  });

  it('awaits async deduplication before closing a bubbled at-rule body', async () => {
    const host: PluginHost = { loadPlugin: () => [asyncFn('same', 'same')] };
    const document = stylesheet([
      rule('.entry', [
        target('async-bubble'),
        atRuleBlock('@media', keyword('screen'), [
          decl('exact', funcCall('same', [])),
          decl('exact', funcCall('same', []))
        ])
      ])
    ]);

    await expect(Promise.resolve(serialize(document, { evaluator, pluginHost: host }))).resolves.toEqual({
      css: '@media screen {\n  .entry {\n    exact: same;\n  }\n}\n'
    });
  });

  /*
   * GRADUATED — an at-rule prelude used to REJECT an awaitable value ("async
   * value in an at-rule prelude is unsupported"). The prelude builders now
   * resolve on the MaybePromise lane, so `@media (min-width: @computed)` works.
   * The prelude is still emitted before the opening brace, so a settled prelude
   * costs nothing and the header cannot interleave with the body.
   */
  it('resolves an async value in a true at-rule prelude', async () => {
    const host: PluginHost = { loadPlugin: () => [asyncFn('probe', 'screen')] };
    const document = stylesheet([
      target('async-prelude'),
      atRuleBlock('@media', funcCall('probe', []), [rule('.entry', [decl('color', keyword('red'))])])
    ]);

    await expect(Promise.resolve(serialize(document, { evaluator, pluginHost: host }))).resolves.toEqual({
      css: '@media screen {\n  .entry {\n    color: red;\n  }\n}\n'
    });
  });
});
