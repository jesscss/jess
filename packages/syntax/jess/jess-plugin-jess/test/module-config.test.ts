import { describe, expect, it } from 'vitest';
import { Context, serialize, type ImportDocument } from '@jesscss/core';
import { parse } from '@jesscss/jess-parser';
import jessPlugin from '../src/index.js';

const loadModule = (specifier: string, source: string) => ({
  importDocument: ({ specifier: s }: { specifier: string }): ImportDocument | undefined =>
    s === specifier ? { document: parse(source), key: specifier } : undefined
});

const render = (importerSource: string, module: { specifier: string; source: string }): Promise<string> =>
  Promise.resolve(
    serialize(parse(importerSource), {
      context: new Context({}, [jessPlugin()]),
      ...loadModule(module.specifier, module.source)
    })
  ).then(result => result.css);

describe('jess module configuration (with)', () => {
  const knobModule = { specifier: 'm.jess', source: '$x?: blue;\n.a { color: $x; }' };

  it('overrides an optional (?:) live knob so the module renders the configured value', async () => {
    await expect(render('@-compose "m.jess" with { $x: red; }', knobModule))
      .resolves.toBe('.a {\n  color: red;\n}\n');
  });

  it('renders the knob default when the module is composed without configuration', async () => {
    await expect(render('@-compose "m.jess";', knobModule))
      .resolves.toBe('.a {\n  color: blue;\n}\n');
  });

  it('rejects configuring a name not declared optional (a hard $x:)', async () => {
    const hardModule = { specifier: 'm.jess', source: '$x: blue;\n.a { color: $x; }' };
    await expect(render('@-compose "m.jess" with { $x: red; }', hardModule))
      .rejects.toThrow(/configurable only when declared optional/);
  });
});
