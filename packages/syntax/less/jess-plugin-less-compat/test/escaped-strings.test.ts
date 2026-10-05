import { describe, expect, it } from 'vitest';
import { buildEvaluator, serialize } from '@jesscss/core';
import { makeLessRegistry } from '@jesscss/fns';
import { parse } from '@jesscss/less-parser';
import { LessApiBridge, type NativeLessPlugin } from '../src/less-api-bridge.js';

/*
 * An escaped string (`~"…"`, `~'…'`, `e()`) is an escaped `tree.Quoted` to a
 * Less 4.x plugin, both as an argument and as a result; raw text such as
 * `escape()`'s is a `tree.Anonymous`.
 */
async function render(source: string, plugin: NativeLessPlugin): Promise<string> {
  const host = new LessApiBridge([plugin]).createPluginHost();
  const result = await serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()), pluginHost: host });
  return result.css ?? '';
}

const describeArg = (arg: unknown): string => {
  if (typeof arg !== 'object' || arg === null) {
    return String(arg);
  }
  const { type, quote, value, escaped } = arg as { type?: unknown; quote?: unknown; value?: unknown; escaped?: unknown };
  return type === 'Quoted'
    ? `Quoted(${String(quote)}${String(value)}${String(quote)}, escaped=${String(escaped)})`
    : `${String(type)}(${String(value)})`;
};

describe('escaped strings at the Less plugin boundary', () => {
  it('hands a plugin an escaped string as an escaped tree.Quoted, and raw text as tree.Anonymous', async () => {
    const seen: string[] = [];
    await render(
      '@v: ~"a b";\n@w: e("c");\n.x { a: probe(~"x", ~\'q\', e("y"), @v, @w, escape("z")); }',
      {
        install(_less, _manager, functions) {
          functions.add('probe', (...args: unknown[]) => {
            seen.push(...args.map(describeArg));
            return 'ok';
          });
        }
      }
    );
    expect(seen).toEqual([
      'Quoted("x", escaped=true)',
      'Quoted(\'q\', escaped=true)',
      'Quoted("y", escaped=true)',
      'Quoted("a b", escaped=true)',
      'Quoted("c", escaped=true)',
      'Anonymous(z)'
    ]);
  });

  /*
   * Blocked on the AST (PINNED-DEFECTS-AUDIT D22): the parser lowers an escaped
   * string that interpolates (`~"a @{v}"`) to a bare `Interpolation` with no
   * quote and no escaped flag, so its value is read back from its text and a
   * plugin gets a Dimension, a Color or a Keyword.
   */
  it.fails('hands a plugin an interpolated escaped string as an escaped tree.Quoted', async () => {
    const seen: string[] = [];
    await render('@n: 4; @c: red; @v: q;\n.x { a: probe(~"@{n}px", ~"@{c}", ~\'a @{v}\'); }', {
      install(_less, _manager, functions) {
        functions.add('probe', (...args: unknown[]) => {
          seen.push(...args.map(describeArg));
          return 'ok';
        });
      }
    });
    expect(seen).toEqual(['Quoted("4px", escaped=true)', 'Quoted("red", escaped=true)', 'Quoted(\'a q\', escaped=true)']);
  });

  it('writes an escaped tree.Quoted result unquoted, as Less does', async () => {
    const css = await render('.x { a: wrap(1); }', {
      install(less, _manager, functions) {
        functions.add('wrap', () => new less.tree.Quoted('"', 'text', true));
      }
    });
    expect(css).toContain('a: text;');
  });

  it('writes a tree.Quoted with an empty quote as raw text, as Less and the @plugin sandbox do', async () => {
    /* less.js's raw-text spelling, e.g. bootstrap's escape-svg. */
    const css = await render('.x { a: wrap(1); b: wrap(2); }', {
      install(less, _manager, functions) {
        functions.add('wrap', n => new less.tree.Quoted('', 'abc', typeof n === 'object' && n !== null && 'value' in n && n.value === 2));
      }
    });
    expect(css).toContain('a: abc;');
    expect(css).toContain('b: abc;');
  });
});
