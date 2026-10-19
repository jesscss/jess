import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

describe('Interpolated Names', () => {
  const compiler = new Compiler();

  describe('Declaration Names', () => {
    it('should handle interpolated declaration names', async () => {
      const lessCode = `
        @prefix: color;
        @suffix: red;
        
        .@{prefix}-@{suffix} {
          @{prefix}: @suffix;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.color-red');
      expect(css).toContain('color: red');
    });

    it('should handle interpolated property names', async () => {
      const lessCode = `
        @property: background;
        
        .test {
          @{property}: blue;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('background: blue');
    });
  });

  describe('Selectors', () => {
    it('should keep a leading selector interpolation before a combinator', async () => {
      expect(await compiler.renderString('@s: ~".q"; @{s} .r { a: b }', { language: 'less' }))
        .toBe('.q .r {\n  a: b;\n}\n');
      expect(await compiler.renderString('@s: ~".q"; @{s} > .r { a: b }', { language: 'less' }))
        .toBe('.q > .r {\n  a: b;\n}\n');
      expect(await compiler.renderString('@s: q; @{s} .r { a: b }', { language: 'less' }))
        .toBe('q .r {\n  a: b;\n}\n');
    });

    it('should write an interpolated namespace prefix as the namespace', async () => {
      expect(await compiler.renderString('@ns: svg; @{ns}|a { c: 1; } .x @{ns}|* { c: 2; }', { language: 'less' }))
        .toBe('svg|a {\n  c: 1;\n}\n.x svg|* {\n  c: 2;\n}\n');
    });

    /*
     * An inline extend on a selector an interpolation leads extends from the
     * resolved selector, as an interpolated extender does (X7); lessc 4.9.1
     * parses it and drops the extend.
     */
    it('should extend from a selector an interpolation leads', async () => {
      expect(await compiler.renderString('@s: ~".q"; @{s} .r:extend(.z) { c: 1; } .z { d: 2; }', { language: 'less' }))
        .toBe('.q .r {\n  c: 1;\n}\n.z,\n.q .r {\n  d: 2;\n}\n');
      expect(await compiler.renderString('@s: q; .p { @{s} > .r:extend(.z) { c: 1; } } .z { d: 2; }', { language: 'less' }))
        .toBe('.p {\n  q > .r {\n    c: 1;\n  }\n}\n.z,\n.p q > .r {\n  d: 2;\n}\n');
    });

    /*
     * A branch that is one interpolated simple resolves to a token of its own; the
     * inline extend follows it, so it extends from the resolved selector exactly as
     * the same selector written out does (X7), never from an empty extender
     * (`.z, {`, ledger O17). Inside a mixin the walk resolves it the same way.
     */
    it('should extend from a branch that is one interpolated simple', async () => {
      const render = (less: string) => compiler.renderString(less, { language: 'less' });
      expect(await render('@s: ~".q"; @{s}:extend(.z) { c: 1; } .z { d: 2; }'))
        .toBe('.q {\n  c: 1;\n}\n.z,\n.q {\n  d: 2;\n}\n');
      expect(await render('@v: q; .@{v}:extend(.b) {} .b { d: 2; }'))
        .toBe('.b,\n.q {\n  d: 2;\n}\n');
      expect(await render('@s: ~".q"; @{s}.r:extend(.z) {} .z { d: 2; }'))
        .toBe('.z,\n.q.r {\n  d: 2;\n}\n');
      expect(await render('@s: ~".q"; .a, @{s}:extend(.z) {} .z { d: 2; }'))
        .toBe('.z,\n.q {\n  d: 2;\n}\n');
      expect(await render('@s: ~".q"; .p { @{s}:extend(.z) { c: 1; } } .z { d: 2; }'))
        .toBe('.p {\n  .q {\n    c: 1;\n  }\n}\n.z,\n.p .q {\n  d: 2;\n}\n');
      expect(await render('@v: q; .m() { .@{v}:extend(.b) { c: 1; } } .m(); .b { d: 2; }'))
        .toBe('.q {\n  c: 1;\n}\n.b,\n.q {\n  d: 2;\n}\n');

      /* An interpolation that resolved to empty text is resolved (bootstrap's `.col@{infix}`). */
      expect(await render('@i: ~""; .col@{i}:extend(.g) {} .r { .col@{i} { &:extend(.g); } } .g { d: 2; }'))
        .toBe('.g,\n.col,\n.r .col {\n  d: 2;\n}\n');
    });

    /*
     * A lone `@{list}` of escaped text is that text, printed as written (owner
     * 2026-10-09: "in Less, we promise ~\"\" as a 'dump whatever you want as-is'"),
     * so its extend appends the text to the target's header, as one branch, in
     * the root sheet as from an imported sheet or a mixin.
     */
    it('appends a lone interpolated text extender as written', async () => {
      const render = (less: string) => compiler.renderString(less, { language: 'less' });
      expect(await render('@s: ~".q, .w"; @{s}:extend(.z) {} .z { d: 2; }'))
        .toBe('.z,\n.q, .w {\n  d: 2;\n}\n');
      expect(await render('@s: ~".q, .w"; @{s} { &:extend(.z); } .z { d: 2; }'))
        .toBe('.z,\n.q, .w {\n  d: 2;\n}\n');
      expect(await render('@s: ~".q, .w"; @{s}, .a { &:extend(.z); } .z { d: 2; }'))
        .toBe('.z,\n.q, .w,\n.a {\n  d: 2;\n}\n');
      expect(await render('@s: ~".q, .w"; @{s} { .c:extend(.z) { x: 1; } } .z { d: 2; }'))
        .toBe('.q, .w {\n  .c {\n    x: 1;\n  }\n}\n.z,\n.q, .w .c {\n  d: 2;\n}\n');
      expect(await render('.m() { @s: ~".q, .w"; @{s}:extend(.z) {} } .m(); .z { d: 2; }'))
        .toBe('.z,\n.q, .w {\n  d: 2;\n}\n');
    });
  });

  describe('Lookup', () => {
    it('should find declarations with interpolated names', async () => {
      const lessCode = `
        @type: primary;
        @value: blue;
        
        .@{type} {
          color: @value;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.primary');
      expect(css).toContain('color: blue');
    });

    it('should handle dependencies between interpolated names', async () => {
      const lessCode = `
        @base: theme;
        @variant: dark;
        @full: @{base}-@{variant};
        
        .@{full} {
          background: black;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.theme-dark');
      expect(css).toContain('background: black');
    });
  });
});
