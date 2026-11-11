import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { makeDimension, makeKeyword, makeList, sniffLiteral } from '@jesscss/core';
import { invokeLessPluginFunction, loadLessPlugin } from '../src/plugin-runtime.js';

/*
 * The script runtime's call boundary, driven directly: a Less 4 plugin
 * function receives the compiler's values as tree nodes and its result comes
 * back as a compiler value, each converted once, and every call gets its own
 * `this.context` facts and `importantScope`.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-plugin-runtime-'));
const pluginPath = path.join(dir, 'plugin.js');
fs.writeFileSync(pluginPath, `
functions.addMultiple({
  'nan-channel': () => new tree.Color([255, NaN, 0]),
  'infinite-item': () => new tree.Value([new tree.Dimension(1, 'px'), -Infinity]),
  'big': () => 10n,
  'cycle': () => {
    const node = {};
    node.self = node;
    return node;
  },
  'read-x': function () {
    return this.context.frames[0].variable('@x').value;
  },
  'read-x-later': async function () {
    await new Promise(resolve => setTimeout(resolve, 20));
    return this.context.frames[0].variable('@x').value;
  },
  'mark-important': function () {
    this.context.importantScope[this.context.importantScope.length - 1].important = ' !important';
    return new tree.Keyword('a');
  },
  'plain': () => new tree.Keyword('a'),
  'first-map-value': map => map.ruleset.rules[0].value,
  'map-in-list': map => new tree.Value([new tree.Dimension(1), map]),
  'raw': () => new tree.Anonymous('a: b'),
  'unquoted': () => new tree.Quoted('', 'url(x.svg)')
});
`, 'utf8');

/** The call site's answers: `@x` is `x`, when given. */
const facts = (x?: unknown) => ({
  variable: (name: string) => (name === '@x' && x !== undefined ? { value: x, important: false } : null),
  call: () => null,
  fileInfo: null
});

const call = (name: string, args: unknown[] = [], callFacts = facts()) =>
  invokeLessPluginFunction(pluginPath, name, args, null, callFacts);

describe('plugin runtime call boundary', () => {
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loads the plugin', async () => {
    expect(await loadLessPlugin(pluginPath, null)).toContain('nan-channel');
  });

  describe('a result with no CSS spelling is refused at its call', () => {
    it('finds a non-finite number inside a colour', async () => {
      await expect(call('nan-channel')).rejects.toThrow('Result for Less @plugin function "nan-channel" is NaN, which has no CSS spelling.');
    });

    it('finds a non-finite number inside a list', async () => {
      await expect(call('infinite-item')).rejects.toThrow('is -Infinity, which has no CSS spelling.');
    });

    it.each(['big', 'cycle'])('refuses %s as not data', async (name) => {
      await expect(call(name)).rejects.toThrow(`Result for Less @plugin function "${name}" is not JSON-serializable.`);
    });
  });

  describe('each call has its own context', () => {
    it('reads the variables of its own call site', async () => {
      expect((await call('read-x', [], facts(makeDimension(1)))).value).toEqual(makeDimension(1));
      expect((await call('read-x', [], facts(makeDimension(2)))).value).toEqual(makeDimension(2));
    });

    it('does not carry an !important mark into the next call', async () => {
      expect((await call('mark-important')).important).toBe(true);
      expect((await call('plain')).important).toBe(false);
    });

    it('keeps calls that overlap apart', async () => {
      const [one, two] = await Promise.all([
        call('read-x-later', [], facts(makeDimension(1))),
        call('read-x-later', [], facts(makeDimension(2)))
      ]);
      expect(one.value).toEqual(makeDimension(1));
      expect(two.value).toEqual(makeDimension(2));
    });
  });

  describe('values convert once each way', () => {
    const map = {
      type: 'DetachedRuleset',
      rules: [{ name: 'primary', value: sniffLiteral('#fff') }]
    };

    it('returns a map value handed back unchanged as the value it was, not its text', async () => {
      const { value } = await call('first-map-value', [map]);
      expect(value).toMatchObject({ type: 'Color', rgb: [255, 255, 255] });
    });

    it('reads a map inside a list as no value', async () => {
      expect((await call('map-in-list', [map])).value).toEqual(makeList([makeDimension(1), makeKeyword('')], ','));
    });

    it('keeps a raw Anonymous result as raw text', async () => {
      expect((await call('raw')).value).toEqual({ type: 'Anonymous', value: 'a: b' });
    });

    it('reads a Keyword result as a typed value', async () => {
      expect((await call('plain')).value).toEqual(sniffLiteral('a'));
    });

    it('reads a Quoted with no quote character as unquoted text', async () => {
      expect((await call('unquoted')).value).toEqual(sniffLiteral('url(x.svg)'));
    });
  });
});
