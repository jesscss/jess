/**
 * Tests for interpolated names inside mixin bodies.
 *
 * In Less/Bootstrap, mixins use patterns like:
 *   #each-color(@i: 1) when (@i =< length(@colors)) {
 *     @item: extract(@colors, @i);
 *     @color: extract(@item, 1);
 *     .btn-@{color} { color: @color; }
 *     #each-color((@i + 1));
 *   }
 *   #each-color();
 *
 * The variables (@color etc.) are defined in the mixin body via extract()
 * and are only available at eval time. _resolveDynamicNodes must not fail
 * during preEval because these variables aren't in scope yet.
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const compiler = new Compiler({
  compile: {
    plugins: [lessPlugin(), lessCompatPlugin()]
  }
});

describe('Interpolated names in mixin bodies', () => {
  it('resolves interpolated selector from mixin variable', async () => {
    const css = await compiler.renderString(`
      #gen(@color) {
        .btn-@{color} {
          color: @color;
        }
      }
      #gen(red);
    `, { language: 'less' });
    expect(css).toContain('.btn-red');
    expect(css).toContain('color: red');
  });

  it('resolves interpolated property name from mixin variable', async () => {
    const css = await compiler.renderString(`
      #gen(@prop, @val) {
        .test {
          @{prop}: @val;
        }
      }
      #gen(color, blue);
    `, { language: 'less' });
    expect(css).toContain('.test');
    expect(css).toContain('color: blue');
  });

  it('resolves interpolated names in recursive each-loop pattern', async () => {
    const css = await compiler.renderString(`
      @colors: red, blue, green;
      #each-color(@i: 1) when (@i =< length(@colors)) {
        @color: extract(@colors, @i);
        .text-@{color} {
          color: @color;
        }
        #each-color((@i + 1));
      }
      #each-color();
    `, { language: 'less' });
    expect(css).toContain('.text-red');
    expect(css).toContain('.text-blue');
    expect(css).toContain('.text-green');
  });

  it('resolves interpolated CSS custom property from extract()', async () => {
    // In Jess/Less v5, custom property values require @{var} interpolation
    // syntax. Plain @var is preserved as literal text (intentional).
    const css = await compiler.renderString(`
      @colors: red #ff0000, blue #0000ff;
      :root {
        #each-color(@i: 1) when (@i =< length(@colors)) {
          @item: extract(@colors, @i);
          @color: extract(@item, 1);
          @val: extract(@item, 2);
          --@{color}: @{val};
          #each-color((@i + 1));
        }
        #each-color();
      }
    `, { language: 'less' });
    expect(css).toContain('--red: #ff0000');
    expect(css).toContain('--blue: #0000ff');
  });

  it('resolves interpolated selector with two variables', async () => {
    // Pattern from Bootstrap _grid-framework.less: .col@{infix}-@{ii}
    const css = await compiler.renderString(`
      #gen(@prefix, @size) {
        .col@{prefix}-@{size} {
          flex: 0 0 auto;
        }
      }
      #gen(-sm, 6);
    `, { language: 'less' });
    expect(css).toContain('.col-sm-6');
  });

  it('resolves interpolated property in spacing utility pattern', async () => {
    // Pattern from Bootstrap _spacing.less: @{prop}: @length !important;
    const css = await compiler.renderString(`
      #gen(@prop, @length) {
        .m-1 {
          @{prop}: @length !important;
        }
      }
      #gen(margin, 0.25rem);
    `, { language: 'less' });
    expect(css).toContain('margin: 0.25rem !important');
  });

  it('resolves bootstrap button pattern with theme-colors extract', async () => {
    const css = await compiler.renderString(`
      @theme-colors: primary #007bff, danger #dc3545;

      #button-variant(@background, @border) {
        color: #fff;
        background-color: @background;
        border-color: @border;
      }

      #each-theme-color-button(@i: 1) when (@i =< length(@theme-colors)) {
        @item: extract(@theme-colors, @i);
        @color: extract(@item, 1);
        @value: extract(@item, 2);

        .btn-@{color} {
          #button-variant(@value, @value);
        }

        #each-theme-color-button((@i + 1));
      }
      #each-theme-color-button();
    `, { language: 'less' });
    expect(css).toContain('.btn-primary');
    expect(css).toContain('.btn-danger');
    expect(css).toContain('background-color: #007bff');
  });

  it('resolves :root custom property loop (bootstrap _root.less)', async () => {
    // Custom property values with plain @var are intentionally preserved as-is.
    // This test verifies the compilation doesn't error, not the output values.
    const css = await compiler.renderString(`
      @theme-colors: primary #007bff, success #28a745;

      :root {
        #each-theme-color-css-var(@i: 1) when (@i =< length(@theme-colors)) {
          @item: extract(@theme-colors, @i);
          @color: extract(@item, 1);
          @value: extract(@item, 2);
          --@{color}: @value;
          #each-theme-color-css-var((@i + 1));
        }
        #each-theme-color-css-var();
      }
    `, { language: 'less' });
    // Property names resolve, values are kept as literal @value (intentional)
    expect(css).toContain('--primary');
    expect(css).toContain('--success');
  });

  it('resolves bootstrap button pattern via imports', async () => {
    // Test the pattern when split across imported files, like Bootstrap does
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-btn-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '_variables.less'), `
        @theme-colors: primary #007bff, danger #dc3545;
      `);
      fs.writeFileSync(path.join(tmpDir, '_mixins.less'), `
        #button-variant(@background, @border) {
          color: #fff;
          background-color: @background;
          border-color: @border;
        }
      `);
      fs.writeFileSync(path.join(tmpDir, '_buttons.less'), `
        #each-theme-color-button(@i: 1) when (@i =< length(@theme-colors)) {
          @item: extract(@theme-colors, @i);
          @color: extract(@item, 1);
          @value: extract(@item, 2);
          .btn-@{color} {
            #button-variant(@value, @value);
          }
          #each-theme-color-button((@i + 1));
        }
        #each-theme-color-button();
      `);
      fs.writeFileSync(path.join(tmpDir, 'main.less'), `
        @import "_variables";
        @import "_mixins";
        @import "_buttons";
      `);

      const css = await compiler.render(path.join(tmpDir, 'main.less'));
      expect(css).toContain('.btn-primary');
      expect(css).toContain('.btn-danger');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
