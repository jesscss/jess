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
});
