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

  it('reads the configured knob through the module namespace', async () => {
    await expect(render('@-compose "m.jess" with { $x: red; }\n.b { color: $m.x; }', knobModule))
      .resolves.toBe('.a {\n  color: red;\n}\n.b {\n  color: red;\n}\n');
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

  it('renders a per-edge `with` once per edge with its own params (two outputs)', async () => {
    await expect(render('@-compose "m.jess" with { $x: red; }\n@-compose "m.jess" with { $x: green; }', knobModule))
      .resolves.toBe('.a {\n  color: red;\n}\n.a {\n  color: green;\n}\n');
  });

  /* This harness parses the module again for every request, as a non-caching driver does. */
  it('binds a later edge of a shared `set` module to the one configured evaluation', async () => {
    await expect(render('@-compose "m.jess" set { $x: red; }\n@-compose "m.jess" as again;\n.b { color: $again.x; }', knobModule))
      .resolves.toBe('.a {\n  color: red;\n}\n.b {\n  color: red;\n}\n');
  });

  it('a namespace member reads the live binding after a hard write past the knob', async () => {
    const knobThenHard = { specifier: 'm.jess', source: '$x?: blue;\n$x: green;\n.a { color: $x; }' };
    await expect(render('@-compose "m.jess";\n.b { color: $m.x; }', knobThenHard))
      .resolves.toBe('.a {\n  color: green;\n}\n.b {\n  color: green;\n}\n');
    await expect(render('@-compose "m.jess" with { $x: red; }\n.b { color: $m.x; }', knobThenHard))
      .resolves.toBe('.a {\n  color: green;\n}\n.b {\n  color: green;\n}\n');
  });

  it('a live reassignment of a configured knob writes the module cell', async () => {
    const knobThenReassign = { specifier: 'm.jess', source: '$x?: blue;\n.a { color: $x; }\n$x := green;\n.c { color: $x; }' };
    await expect(render('@-compose "m.jess" with { $x: red; }\n.b { color: $m.x; }', knobThenReassign))
      .resolves.toBe('.a {\n  color: red;\n}\n.c {\n  color: green;\n}\n.b {\n  color: green;\n}\n');
  });
});
