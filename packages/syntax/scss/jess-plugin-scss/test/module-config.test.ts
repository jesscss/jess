import { describe, expect, it } from 'vitest';
import { Context, serialize, type ImportDocument } from '@jesscss/core';
import { parse } from '@jesscss/scss-parser';
import scssPlugin from '../src/index.js';

const loadModule = (specifier: string, source: string) => ({
  importDocument: ({ specifier: s }: { specifier: string }): ImportDocument | undefined =>
    s === specifier ? { document: parse(source), key: specifier } : undefined
});

const render = (importerSource: string, module: { specifier: string; source: string }): Promise<string> =>
  Promise.resolve(
    serialize(parse(importerSource), {
      context: new Context({}, [scssPlugin()]),
      ...loadModule(module.specifier, module.source)
    })
  ).then(result => result.css);

describe('scss module configuration (@use … with)', () => {
  const knobModule = { specifier: 'm.scss', source: '$x: blue !default;\n.a { color: $x; }' };

  it('overrides a !default knob so the module renders the configured value', async () => {
    await expect(render('@use "m.scss" with ($x: red);', knobModule))
      .resolves.toBe('.a {\n  color: red;\n}\n');
  });

  it('renders the !default value when the module is used without configuration', async () => {
    await expect(render('@use "m.scss";', knobModule))
      .resolves.toBe('.a {\n  color: blue;\n}\n');
  });

  it('rejects configuring a name not declared !default', async () => {
    const hardModule = { specifier: 'm.scss', source: '$x: blue;\n.a { color: $x; }' };
    await expect(render('@use "m.scss" with ($x: red);', hardModule))
      .rejects.toThrow(/configurable only when declared with `!default`/);
  });

  it('renders `@use … with` as a SHARED module — one emission across two uses', async () => {
    /*
     * Sass singleton: `with` configures the one module, so it renders ONCE and a
     * later plain `@use` inherits the config without re-emitting.
     */
    await expect(render('@use "m.scss" with ($x: red);\n@use "m.scss";', knobModule))
      .resolves.toBe('.a {\n  color: red;\n}\n');
  });

  it('rejects a conflicting second `@use … with` of the same module', async () => {
    await expect(render('@use "m.scss" with ($x: red);\n@use "m.scss" with ($x: green);', knobModule))
      .rejects.toThrow(/already configured with a different set of values/);
  });
});
