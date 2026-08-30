import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

/**
 * Bracket-lookup keys compare by VALUE, not by bytes (§1).
 *
 * A map/namespace body's members live in `Map<string, DeclEntry>`s keyed by
 * byte identity. That is the right O(1) fast path and the wrong definition of
 * "same key" — a quoted key and the value it spells name the same member, and
 * before this the two only matched by coincidence.
 *
 * The map is still the fast path. The value comparison runs ONLY after every
 * byte lookup has missed, one step before the unresolved-symbol error, because
 * a scan is O(n) and cannot live on the hit path.
 */
const render = async (source: string): Promise<string> => {
  const css = await new Compiler({ compile: { plugins: [lessPlugin()] } })
    .renderString(source, { filePath: 'entry.less', extension: '.less' });
  return css.replace(/\s+/g, ' ').trim();
};

describe('bracket lookup keys compare by value', () => {
  it('finds an unquoted member through a QUOTED key', async () => {
    expect(await render('@k: "one";\n@foo: { @one: bar; }\n.a { k: @foo[@k]; }'))
      .toBe('.a { k: bar; }');
  });

  it('finds it through an escaped key too (the byte fast path still hits)', async () => {
    expect(await render('@k: ~"one";\n@foo: { @one: bar; }\n.a { k: @foo[@k]; }'))
      .toBe('.a { k: bar; }');
  });

  it('does not invent a member that no key names', async () => {
    await expect(render('@k: "nope";\n@foo: { @one: bar; }\n.a { k: @foo[@k]; }'))
      .rejects.toThrow();
  });

  it('keeps the two namespaces disjoint — a `@var` key never finds a property member', async () => {
    await expect(render('@k: "one";\n@foo: { one: bar; }\n.a { k: @foo[@k]; }'))
      .rejects.toThrow();
  });
});
