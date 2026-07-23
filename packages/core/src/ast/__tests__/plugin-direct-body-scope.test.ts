import { describe, expect, it } from 'vitest';
import { makeBuiltinRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { defineFunction } from '../value-dispatch.js';
import { decl, detachedRuleset, funcCall, keyword, mixinCall, mixinDef, quoted, reference, rule, stylesheet, variableDeclaration, variableReference } from '../nodes.js';
import { atRuleBlock, plugin } from '../at-rule.js';
import { serialize } from '../serialize.js';
import type { PluginHost } from '../value-eval.js';
import { makeKeyword } from '../value-factory.js';

const evaluator = buildEvaluator(makeBuiltinRegistry());

const fn = (name: string, value: string) => defineFunction(name, {
  params: [],
  body: () => makeKeyword(value)
});
const asyncFn = (name: string, value: string) => defineFunction(name, {
  params: [],
  body: () => Promise.resolve(makeKeyword(value))
});
const target = (specifier: string) => plugin(quoted(`'${specifier}'`, specifier, '\'', false));

describe('typed Plugin lexical body preparation', () => {
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
      variableDeclaration('theme', detachedRuleset([
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

  it('continues to reject an async value in a true at-rule prelude', () => {
    const host: PluginHost = { loadPlugin: () => [asyncFn('probe', 'screen')] };
    const document = stylesheet([
      target('async-prelude'),
      atRuleBlock('@media', funcCall('probe', []), [rule('.entry', [decl('color', 'red')])])
    ]);

    expect(() => serialize(document, { evaluator, pluginHost: host }))
      .toThrow('async value in an at-rule prelude is unsupported');
  });
});
