/**
 * Tests for variable scoping in detached rulesets passed to mixins.
 *
 * Bootstrap uses patterns like:
 *   #badge-variant(@bg) {
 *     &[href] { #hover-focus({ background-color: darken(@bg, 10%); }) }
 *   }
 *   #hover-focus(@content) { &:hover, &:focus { @content(); } }
 *
 * Variables from the enclosing mixin scope (@bg) must be visible inside
 * the detached ruleset when it's evaluated via @content().
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const compiler = new Compiler({
  compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
});

describe.todo('Detached ruleset variable scoping', () => {
  it('accesses mixin parameter inside detached ruleset (inline)', async () => {
    const css = await compiler.renderString(`
      #hover(@content) {
        &:hover { @content(); }
      }
      #btn(@bg) {
        color: @bg;
        #hover({
          background-color: @bg;
        });
      }
      .btn { #btn(red); }
    `, { language: 'less' });
    expect(css).toContain('color: red');
    expect(css).toContain('background-color: red');
  });

  it('accesses parameter default inside detached ruleset (inline)', async () => {
    const css = await compiler.renderString(`
      #hover(@content) {
        &:hover { @content(); }
      }
      #button-variant(@background, @hover-background: darken(@background, 10%)) {
        background-color: @background;
        #hover({
          background-color: @hover-background;
        });
      }
      .btn-primary { #button-variant(#007bff); }
    `, { language: 'less' });
    expect(css).toContain('background-color: #007bff');
    expect(css).toContain(':hover');
  });

  it('accesses local variable inside detached ruleset (inline)', async () => {
    const css = await compiler.renderString(`
      #hover(@content) {
        &:hover { @content(); }
      }
      #table-row-variant(@state, @background) {
        .table-@{state} {
          background-color: @background;
        }
        @hover-background: darken(@background, 5%);
        .table-hover .table-@{state} {
          #hover({
            background-color: @hover-background;
          });
        }
      }
      #table-row-variant(primary, #cce5ff);
    `, { language: 'less' });
    expect(css).toContain('.table-primary');
    expect(css).toContain(':hover');
  });

  it('accesses mixin parameter inside hover-focus (inline)', async () => {
    const css = await compiler.renderString(`
      #hover-focus(@content) {
        &:hover, &:focus { @content(); }
      }
      #badge-variant(@bg) {
        background-color: @bg;
        &[href] {
          #hover-focus({
            background-color: darken(@bg, 10%);
          });
        }
      }
      .badge-primary { #badge-variant(#007bff); }
    `, { language: 'less' });
    expect(css).toContain('background-color: #007bff');
    expect(css).toContain(':hover');
  });

  it('accesses mixin parameter inside detached ruleset (simple imports, no extract)', async () => {
    // Simple version: mixin + hover in separate files, direct call (no extract/each)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-dr-simple-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '_hover.less'), `
        #hover(@content) {
          &:hover { @content(); }
        }
      `);
      fs.writeFileSync(path.join(tmpDir, '_badge-mixin.less'), `
        #badge-variant(@bg) {
          color: @bg;
          &[href] {
            #hover({
              background-color: @bg;
            });
          }
        }
      `);
      fs.writeFileSync(path.join(tmpDir, 'main.less'), `
        @import "_hover";
        @import "_badge-mixin";
        .badge-primary {
          #badge-variant(#007bff);
        }
      `);

      const css = await compiler.render(path.join(tmpDir, 'main.less'));
      expect(css).toContain('.badge-primary');
      expect(css).toContain('color: #007bff');
      expect(css).toContain('background-color: #007bff');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accesses mixin parameter inside detached ruleset (via imports with extract)', async () => {
    // This reproduces the Bootstrap pattern where mixins are in separate files
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-dr-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '_hover.less'), `
        #hover(@content) {
          &:hover { @content(); }
        }
        #hover-focus(@content) {
          &:hover, &:focus { @content(); }
        }
      `);
      fs.writeFileSync(path.join(tmpDir, '_badge-mixin.less'), `
        #badge-variant(@bg) {
          color: @bg;
          background-color: @bg;
          &[href] {
            #hover-focus({
              color: @bg;
              text-decoration: none;
              background-color: darken(@bg, 10%);
            });
          }
        }
      `);
      fs.writeFileSync(path.join(tmpDir, '_variables.less'), `
        @theme-colors: primary #007bff, danger #dc3545;
      `);
      fs.writeFileSync(path.join(tmpDir, '_badge.less'), `
        #each-theme-color-badge(@i: 1) when (@i =< length(@theme-colors)) {
          @item: extract(@theme-colors, @i);
          @color: extract(@item, 1);
          @value: extract(@item, 2);
          .badge-@{color} {
            #badge-variant(@value);
          }
          #each-theme-color-badge((@i + 1));
        }
        #each-theme-color-badge();
      `);
      fs.writeFileSync(path.join(tmpDir, 'main.less'), `
        @import "_variables";
        @import "_hover";
        @import "_badge-mixin";
        @import "_badge";
      `);

      const css = await compiler.render(path.join(tmpDir, 'main.less'));
      expect(css).toContain('.badge-primary');
      expect(css).toContain('.badge-danger');
      expect(css).toContain('background-color: #007bff');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accesses extracted variable in nested mixin call with detached ruleset (via imports)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-btn-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '_hover.less'), `
        #hover(@content) {
          &:hover { @content(); }
        }
      `);
      fs.writeFileSync(path.join(tmpDir, '_button-mixin.less'), `
        #button-variant(@background, @border, @hover-background: darken(@background, 7.5%), @hover-border: darken(@border, 10%)) {
          background-color: @background;
          border-color: @border;
          #hover({
            background-color: @hover-background;
            border-color: @hover-border;
          });
        }
      `);
      fs.writeFileSync(path.join(tmpDir, '_variables.less'), `
        @theme-colors: primary #007bff, danger #dc3545;
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
        @import "_hover";
        @import "_button-mixin";
        @import "_buttons";
      `);

      const css = await compiler.render(path.join(tmpDir, 'main.less'));
      expect(css).toContain('.btn-primary');
      expect(css).toContain('.btn-danger');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accesses local variable inside nested ruleset via detached ruleset (via imports)', async () => {
    // Bootstrap _tables pattern: @hover-background is a LOCAL variable inside .table-hover
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-table-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '_hover.less'), `
        #hover(@content) {
          &:hover { @content(); }
        }
      `);
      fs.writeFileSync(path.join(tmpDir, '_table-mixin.less'), `
        #table-row-variant(@state, @background) {
          .table-@{state} {
            background-color: @background;
          }
          .table-hover {
            @hover-background: darken(@background, 5%);
            .table-@{state} {
              #hover({
                background-color: @hover-background;
              });
            }
          }
        }
      `);
      fs.writeFileSync(path.join(tmpDir, '_tables.less'), `
        #table-row-variant(primary, #cce5ff);
        #table-row-variant(danger, #f5c6cb);
      `);
      fs.writeFileSync(path.join(tmpDir, 'main.less'), `
        @import "_hover";
        @import "_table-mixin";
        @import "_tables";
      `);

      const css = await compiler.render(path.join(tmpDir, 'main.less'));
      expect(css).toContain('.table-primary');
      expect(css).toContain('.table-danger');
      expect(css).toContain(':hover');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accesses breakpoint-infix result in interpolated selector (via imports)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-grid-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '_variables.less'), `
        @grid-breakpoints: xs 0, sm 576px;
        @grid-columns: 12;
      `);
      fs.writeFileSync(path.join(tmpDir, '_breakpoints.less'), `
        #media-breakpoint-up(@name, @content, @breakpoints: @grid-breakpoints) {
          @min: extract(extract(@breakpoints, 1), 2);
          @content();
        }
      `);
      fs.writeFileSync(path.join(tmpDir, '_grid.less'), `
        #each-bp(@i: 1) when (@i =< length(@grid-breakpoints)) {
          @bp-item: extract(@grid-breakpoints, @i);
          @breakpoint: extract(@bp-item, 1);
          @infix: e(%("-%s", @breakpoint));
          .col@{infix} {
            flex: 0 0 auto;
          }
          #each-bp((@i + 1));
        }
        #each-bp();
      `);
      fs.writeFileSync(path.join(tmpDir, 'main.less'), `
        @import "_variables";
        @import "_breakpoints";
        @import "_grid";
      `);

      const css = await compiler.render(path.join(tmpDir, 'main.less'));
      expect(css).toContain('.col-');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
