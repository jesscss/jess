/**
 * A colour that passes UNMODIFIED through a legacy `@plugin` JS function must keep
 * its authored short-form spelling (`#fff`), matching lessc 4.x. Bootstrap 4's
 * `color-yiq` looks up `@yiq-text-light` (= `@white` = `#fff`) and returns it; the
 * value crosses the host <-> Deno-worker bridge, which previously rebuilt the colour
 * from its numeric rgb channels and emitted 6-digit `#ffffff`.
 *
 * A colour the plugin CONSTRUCTS (`new tree.Color('fff')`) has no authored form and
 * serialises to 6-digit hex — also matching lessc 4.x. Oracle: lessc 4.2.0 on this
 * exact fixture emits `#fff` for the pass-through and `#ffffff` for the constructed.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import jsPlugin from '@jesscss/plugin-js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const fixtures = path.join(__dirname, 'fixtures', 'compat-color');

describe('legacy @plugin colour round-trip preserves authored short form', () => {
  it('pass-through colour keeps #fff; constructed colour is 6-digit', async () => {
    const c = new Compiler({
      output: { collapseNesting: true },
      compile: { jsReadRoot: fixtures, plugins: [lessPlugin(), jsPlugin({ jsReadRoot: fixtures, runtimeApi: 'less' }), lessCompatPlugin()] }
    });
    const css = (await c.render(path.join(fixtures, 'main.less'), { suppressWarnings: true, breakOnError: false })).trim();
    expect(css).toBe('.passthrough {\n  color: #fff;\n}\n.constructed {\n  color: #ffffff;\n}');
  });

  /*
   * A COMPUTED colour (`darken()` is an HSL op) must reach the plugin with its real
   * channels, directly or as a mixin default — bootstrap 4's `color-yiq` read
   * `[0, 0, 0]` and picked the light text colour. A NAMED colour is a colour too
   * (`color-yiq`'s `{ rgb: [r, g, b] }` destructuring threw on it). The channels
   * keep full precision (ledger V5) into the plugin and back out of it
   * (`.round-trip`). Oracle: lessc 4.9.1 on `channels.less`.
   */
  it('computed and named colours reach the plugin with their real channels', async () => {
    const c = new Compiler({
      output: { collapseNesting: true },
      compile: { jsReadRoot: fixtures, plugins: [lessPlugin(), jsPlugin({ jsReadRoot: fixtures, runtimeApi: 'less' }), lessCompatPlugin()] }
    });
    const css = (await c.render(path.join(fixtures, 'channels.less'), { suppressWarnings: true, breakOnError: false })).trim();
    expect(css).toBe([
      '.literal {\n  a: 255 193 7 / 1;\n}',
      '.computed {\n  a: 223.74999999999997 167.81249999999997 0 / 1;\n}',
      '.mixin-default {\n  a: 223.74999999999997 167.81249999999997 0 / 1;\n}',
      '.mixed {\n  a: 127.5 96.5 3.5 / 1;\n}',
      '.hsl {\n  a: 255 191.25 0 / 1;\n}',
      '.named {\n  a: 255 255 255 / 1;\n}',
      '.round-trip {\n  a: 223.74999999999997 167.81249999999997 0 / 1;\n}'
    ].join('\n'));
  });

  /*
   * A plain identifier reaches a plugin as a `tree.Keyword`, as in less.js, so
   * `node.type` and `instanceof tree.Keyword` checks see the same node type.
   * Oracle: lessc 4.9.1 on `types.less`.
   */
  it('hands a plugin each argument as its Less node type', async () => {
    const c = new Compiler({
      output: { collapseNesting: true },
      compile: { jsReadRoot: fixtures, plugins: [lessPlugin(), jsPlugin({ jsReadRoot: fixtures, runtimeApi: 'less' }), lessCompatPlugin()] }
    });
    const css = (await c.render(path.join(fixtures, 'types.less'), { suppressWarnings: true, breakOnError: false })).trim();
    expect(css).toBe('.types {\n  a: Keyword+ Color Dimension Quoted Expression;\n}');
  });
});
