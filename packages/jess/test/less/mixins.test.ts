import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

describe('Mixins', () => {
  const compiler = new Compiler({
    output: {
      collapseNesting: true
    },
    compile: {
      plugins: [lessPlugin()]
    }
  });

  describe('Basic Mixins', () => {
    it('should handle simple mixin definition and usage', async () => {
      const lessCode = `
        .mixin() {
          color: red;
          background: blue;
        }
        
        .test {
          .mixin();
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
    });

    it('should handle mixin without parentheses', async () => {
      const lessCode = `
        .mixin {
          color: red;
        }
        
        .test {
          .mixin;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
    });

    it('should handle multiple mixin calls', async () => {
      const lessCode = `
        .mixin1() {
          color: red;
        }
        
        .mixin2() {
          background: blue;
        }
        
        .test {
          .mixin1();
          .mixin2();
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
    });
  });

  describe('Mixin Parameters', () => {
    it('should handle mixin with parameters', async () => {
      const lessCode = `
        .mixin(@color) {
          color: @color;
        }
        
        .test {
          .mixin(red);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
    });

    it('should handle mixin with multiple parameters', async () => {
      const lessCode = `
        .mixin(@color, @size) {
          color: @color;
          font-size: @size;
        }
        
        .test {
          .mixin(red, 16px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 16px');
    });

    it('should handle mixin with default parameter values', async () => {
      const lessCode = `
        .mixin(@color: red, @size: 16px) {
          color: @color;
          font-size: @size;
        }
        
        .test1 {
          .mixin();
        }
        
        .test2 {
          .mixin(blue);
        }
        
        .test3 {
          .mixin(blue, 20px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.test1');
      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 16px');
      expect(css).toContain('.test2');
      expect(css).toContain('color: blue');
      expect(css).toContain('.test3');
      expect(css).toContain('font-size: 20px');
    });

    it('should handle named parameters', async () => {
      const lessCode = `
        .mixin(@color: red, @size: 16px) {
          color: @color;
          font-size: @size;
        }
        
        .test {
          .mixin(@size: 20px, @color: blue);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: blue');
      expect(css).toContain('font-size: 20px');
    });
  });

  describe('Mixin Guards', () => {
    it('should handle mixin with when guard', async () => {
      const lessCode = `
        .mixin(@color) when (@color = red) {
          color: @color;
          background: white;
        }
        
        .mixin(@color) when (@color = blue) {
          color: @color;
          background: black;
        }
        
        .test1 {
          .mixin(red);
        }
        
        .test2 {
          .mixin(blue);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.test1');
      expect(css).toContain('color: red');
      expect(css).toContain('background: white');
      expect(css).toContain('.test2');
      expect(css).toContain('color: blue');
      expect(css).toContain('background: black');
    });

    it('should handle mixin with default guard', async () => {
      const lessCode = `
        .mixin(@color) when (@color = red) {
          color: @color;
        }
        
        .mixin(@color) {
          color: blue;
        }
        
        .test1 {
          .mixin(red);
        }
        
        .test2 {
          .mixin(green);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.test1');
      expect(css).toContain('color: red');
      expect(css).toContain('.test2');
      expect(css).toContain('color: blue');
    });
  });

  describe('Mixin Pattern Matching', () => {
    it('should handle mixin with pattern matching #1', async () => {
      const lessCode = `
        .mixin(@color, @size) when (@size > 10px) {
          color: @color;
          font-size: @size;
        }
        
        .mixin(@color, @size) when (@size <= 10px) {
          color: @color;
          font-size: 10px;
        }
        
        .test1 {
          .mixin(red, 16px);
        }
        
        .test2 {
          .mixin(blue, 8px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.test1');
      expect(css).toContain('font-size: 16px');
      expect(css).toContain('.test2');
      expect(css).toContain('font-size: 10px');
    });

    it('should handle mixin with pattern matching #2', async () => {
      const lessCode = `
        .mixin(red) {
          color: red;
        }
        
        .mixin(blue) {
          color: blue;
        }
        
        .test1 {
          .mixin(red);
        }
        
        .test2 {
          .mixin(blue);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.test1');
      expect(css).toContain('color: red');
      expect(css).toContain('.test2');
      expect(css).toContain('color: blue');
    });
  });

  describe('Mixin with @arguments', () => {
    it('should handle mixin with @arguments', async () => {
      const lessCode = `
        .mixin(@color, @size) {
          color: @color;
          font-size: @size;
          args: @arguments;
        }
        
        .test {
          .mixin(red, 16px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 16px');
      expect(css).toContain('args: red, 16px');
    });
  });

  describe('Recursive Mixins', () => {
    it('should handle recursive mixin calls without infinite loops', async () => {
      const lessCode = `
        .recursion() {
          color: black;
        }
        .test-rule-rec {
          .recursion {
            .recursion();
          }
        }
      `;

      // This should complete without hanging or OOM
      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.test-rule-rec');
      expect(css).toContain('.recursion');
    });

    it('should handle clearfix pattern without infinite loops', async () => {
      const lessCode = `
        .clearfix() {
          // ...
        }
        .clearfix {
          .clearfix();
        }
        .foo {
          .clearfix();
        }
      `;

      // This should complete without hanging or OOM
      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toBeString('');
    });
  });

  it('should collapse nested mixins correctly', async () => {
    const lessCode = `
      .mixin { border: 1px solid black; }
      .mixout { border-color: orange; }
      .borders { border-style: dashed; }
      .mixin > * { border: do not match me; }

      #namespace {
        .borders {
          border-style: dotted;
        }
        .biohazard {
          content: "death";
          .man {
            color: transparent;
          }
        }
      }
      #theme {
        > .mixin {
          background-color: grey;
        }
      }
      #container {
        color: black;
        .mixin();
        .mixout ();
        #theme > .mixin();
      }

      #header {
        .milk {
          color: inherit;
          .mixin();
          #theme > .mixin();
        }
        #cookie {
          .chips {
            #namespace .borders();
            .calories {
              #container();
            }
          }
          .borders();
        }
      }
      .secure-zone { #namespace .biohazard .man(); }
      .direct {
        #namespace > .borders();
      }

      .bo, .bar {
          width: 100%;
      }
      .bo {
          border: 1px;
      }
      .ar.bo.ca {
          color: black;
      }
      .jo.ki {
          background: none;
      }
      .amp {
          &.support {
              color: orange;
              .higher {
                  top: 0px;
              }
              &.deeper {
                  height: auto;
              }
          }
      }
      .extended {
          .bo();
          .jo.ki();
          .amp.support();
          .amp.support.higher();
          .amp.support.deeper();
      }
      .do .re .mi .fa {
          .sol .la {
              .si {
                  color: cyan;
              }
          }
      }
      .mutli-selector-parents {
          .do.re.mi.fa.sol.la.si();
      }
      .foo .bar {
        .bar();
      }
      .has_parents() {
        & .underParents {
          color: red;
        }
      }
      .has_parents();
      .parent {
        .has_parents();
      }
      .margin_between(@above, @below) {
          * + & { margin-top: @above; }
          legend + & { margin-top: 0; }
          & + * { margin-top: @below; }
      }
      h1 { .margin_between(25px, 10px); }
      h2 { .margin_between(20px, 8px); }
      h3 { .margin_between(15px, 5px); }

      .mixin_def(@url, @position){
          background-image: @url;
          background-position: @position;
      }
      .error{
        @s: "/";
        .mixin_def( "@{s}a.png", center center);
      }
      .recursion() {
        color: black;
      }
      .test-rule-rec {
        .recursion {
          .recursion();
        }
      }
      .paddingFloat(@padding) { padding-left: @padding; }

      .button {
          .paddingFloat(((10px + 12) * 2));

          &.large { .paddingFloat(((10em * 2) * 2)); }
      }
      .clearfix() {
        // ...
      }
      .clearfix {
        .clearfix();
      }
      .clearfix {
        .clearfix();
      }
      .foo {
        .clearfix();
      }

    `;

    const css = await compiler.renderString(lessCode, { language: 'less' });
    expect(css).toBeString(`
      .mixin {
        border: 1px solid black;
      }
      .mixout {
        border-color: orange;
      }
      .borders {
        border-style: dashed;
      }
      .mixin > * {
        border: do not match me;
      }
      #namespace .borders {
        border-style: dotted;
      }
      #namespace .biohazard {
        content: "death";
      }
      #namespace .biohazard .man {
        color: transparent;
      }
      #theme > .mixin {
        background-color: grey;
      }
      #container {
        color: black;
        border: 1px solid black;
        border-color: orange;
        background-color: grey;
      }
      #header .milk {
        color: inherit;
        border: 1px solid black;
        background-color: grey;
      }
      #header #cookie .chips {
        border-style: dotted;
      }
      #header #cookie .chips .calories {
        color: black;
        border: 1px solid black;
        border-color: orange;
        background-color: grey;
      }
      #header #cookie {
        border-style: dashed;
      }
      .secure-zone {
        color: transparent;
      }
      .direct {
        border-style: dotted;
      }
      .bo,
      .bar {
        width: 100%;
      }
      .bo {
        border: 1px;
      }
      .ar.bo.ca {
        color: black;
      }
      .jo.ki {
        background: none;
      }
      .amp.support {
        color: orange;
      }
      .amp.support .higher {
        top: 0px;
      }
      .amp.support.deeper {
        height: auto;
      }
      .extended {
        width: 100%;
        border: 1px;
        background: none;
        color: orange;
      }
      .extended .higher {
        top: 0px;
      }
      .extended.deeper {
        height: auto;
      }
      .extended {
        top: 0px;
        height: auto;
      }
      .do .re .mi .fa .sol .la .si {
        color: cyan;
      }
      .mutli-selector-parents {
        color: cyan;
      }
      .foo .bar {
        width: 100%;
      }
      .underParents {
        color: red;
      }
      .parent .underParents {
        color: red;
      }
      * + h1 {
        margin-top: 25px;
      }
      legend + h1 {
        margin-top: 0;
      }
      h1 + * {
        margin-top: 10px;
      }
      * + h2 {
        margin-top: 20px;
      }
      legend + h2 {
        margin-top: 0;
      }
      h2 + * {
        margin-top: 8px;
      }
      * + h3 {
        margin-top: 15px;
      }
      legend + h3 {
        margin-top: 0;
      }
      h3 + * {
        margin-top: 5px;
      }
      .error {
        background-image: "/a.png";
        background-position: center center;
      }
      .test-rule-rec .recursion {
        color: black;
      }
      .button {
        padding-left: 44px;
      }
      .button.large {
        padding-left: 40em;
      }
    `);
  });
});
