import { afterEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../../src/index.js';
import { Context } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const readNumericFunctionArg = (value: any): number => {
  if (typeof value?.value === 'number') {
    return value.value;
  }
  if (typeof value?.value?.number === 'number') {
    return value.value.number;
  }
  const primitive = value?.valueOf?.() ?? value;
  return Number(primitive);
};

const readStringFunctionArg = (value: any): string => {
  if (typeof value?.value === 'string') {
    return value.value.replace(/^(['"])(.*)\1$/, '$2');
  }
  if (typeof value?.value?.value === 'string') {
    return value.value.value.replace(/^(['"])(.*)\1$/, '$2');
  }
  const primitive = value?.valueOf?.() ?? value;
  return String(primitive).replace(/^(['"])(.*)\1$/, '$2');
};

const lessHarnessFunctionsPlugin = {
  install(less: any) {
    less.functions.functionRegistry.addMultiple({
      add(a: any, b: any) {
        return readNumericFunctionArg(a) + readNumericFunctionArg(b);
      },
      increment(a: any) {
        return readNumericFunctionArg(a) + 1;
      },
      _color(str: any) {
        if (readStringFunctionArg(str) === 'evil red') {
          return '#660000';
        }
        return undefined;
      }
    });
  }
};

const tempDirs: string[] = [];

const makeTmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-functions-'));
  tempDirs.push(dir);
  return dir;
};

describe('Functions', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const compiler = new Compiler({
    compile: {
      plugins: [lessPlugin()]
    }
  });

  describe('Built-in Color Functions', () => {
    it('should support Less harness custom functions through less-compat registry setup', async () => {
      const compilerWithCompatFunctions = new Compiler({
        compile: {
          plugins: [
            lessPlugin(),
            lessCompatPlugin({
              plugins: [lessHarnessFunctionsPlugin]
            })
          ]
        }
      });

      const lessCode = `
        .test {
          color: _color("evil red");
          width: increment(15);
          border-width: add(2, 3);
        }
      `;

      const root = makeTmpDir();
      const lessPath = path.join(root, 'functions.less');
      fs.writeFileSync(lessPath, lessCode, 'utf8');

      const css = await compilerWithCompatFunctions.render(lessPath);
      expect(css).toContain('color: #660000');
      expect(css).toContain('width: 16');
      expect(css).toContain('border-width: 5');
    });

    it('should keep Less harness custom functions working when a less-compat plugin instance is reused across compilers', async () => {
      const sharedCompatPlugin = lessCompatPlugin({
        plugins: [lessHarnessFunctionsPlugin]
      });

      const firstRoot = makeTmpDir();
      const firstLessPath = path.join(firstRoot, 'first.less');
      fs.writeFileSync(firstLessPath, '.first { color: red; }', 'utf8');

      const firstCompiler = new Compiler({
        compile: {
          plugins: [lessPlugin(), sharedCompatPlugin]
        }
      });
      await firstCompiler.render(firstLessPath);

      const secondRoot = makeTmpDir();
      const secondLessPath = path.join(secondRoot, 'functions.less');
      fs.writeFileSync(secondLessPath, `
        .test {
          color: _color("evil red");
          width: increment(15);
          border-width: add(2, 3);
        }
      `, 'utf8');

      const secondCompiler = new Compiler({
        compile: {
          plugins: [lessPlugin(), sharedCompatPlugin]
        }
      });

      const css = await secondCompiler.render(secondLessPath);
      expect(css).toContain('color: #660000');
      expect(css).toContain('width: 16');
      expect(css).toContain('border-width: 5');
    });

    it('should handle lighten function', async () => {
      const lessCode = `
        .test {
          color: lighten(#000000, 50%);
          background: lighten(red, 20%);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color:');
      expect(css).toContain('background:');
    });

    it('should normalize parsed color keywords in color()', async () => {
      const lessCode = `
        .test {
          color: color(plum);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: #dda0dd');
    });

    it('should handle darken function', async () => {
      const lessCode = `
        .test {
          color: darken(#ffffff, 50%);
          background: darken(blue, 20%);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color:');
      expect(css).toContain('background:');
    });

    it('should handle saturate function', async () => {
      const lessCode = `
        .test {
          color: saturate(#888888, 20%);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color:');
    });

    it('should handle desaturate function', async () => {
      const lessCode = `
        .test {
          color: desaturate(#ff0000, 20%);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color:');
    });

    it('should handle fade function', async () => {
      const lessCode = `
        .test {
          color: fade(#ff0000, 50%);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color:');
    });

    it('should handle mix function', async () => {
      const lessCode = `
        .test {
          color: mix(#ff0000, #0000ff, 50%);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color:');
    });

    it('should serialize hsv() using Less-compatible hex output', async () => {
      const lessCode = `
        .test {
          color: hsv(5, 50%, 30%);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: #4d2926');
    });

    it('should serialize transparent mix() results as rgba()', async () => {
      const lessCode = `
        .test {
          color: mix(#ff0000, transparent);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: rgba(255, 0, 0, 0.5)');
    });
  });

  describe.todo('Built-in Math Functions', () => {
    it('should handle round function', async () => {
      const lessCode = `
        .test {
          width: round(3.7px);
          height: round(2.3em);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 4px');
      expect(css).toContain('height: 2em');
    });

    it('should handle ceil function', async () => {
      const lessCode = `
        .test {
          width: ceil(3.1px);
          height: ceil(2.9em);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 4px');
      expect(css).toContain('height: 3em');
    });

    it('should handle floor function', async () => {
      const lessCode = `
        .test {
          width: floor(3.9px);
          height: floor(2.1em);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 3px');
      expect(css).toContain('height: 2em');
    });

    it('should handle percentage function', async () => {
      const lessCode = `
        .test {
          width: percentage(0.5);
          height: percentage(0.25);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 50%');
      expect(css).toContain('height: 25%');
    });
  });

  describe.todo('Built-in String Functions', () => {
    it('should handle escape function', async () => {
      const lessCode = `
        .test {
          content: escape("a=1");
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('content:');
    });

    it('should handle e function', async () => {
      const lessCode = `
        .test {
          content: e("hello");
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('content: hello');
    });
  });

  describe.todo('Built-in List Functions', () => {
    it('should handle length function', async () => {
      const lessCode = `
        .test {
          count: length(1 2 3);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('count:');
    });

    it('should handle extract function', async () => {
      const lessCode = `
        .test {
          value: extract(1 2 3, 2);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('value:');
    });
  });

  describe('Less each() callbacks', () => {
    it('supports authored each() callback syntax end-to-end', async () => {
      const lessCode = `
        .test {
          each(1 2 3 4, {
            item-@{index}: @value;
          });
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('item-1: 1');
      expect(css).toContain('item-2: 2');
      expect(css).toContain('item-3: 3');
      expect(css).toContain('item-4: 4');
    });

    it('re-evaluates nested rules for each range() item', async () => {
      const css = await compiler.renderString(`
        .loop() {
          each(range(2), {
            .col-@{value} {
              width: @value;
            }
          });
        }
        .loop();
      `, { language: 'less' });

      expect(css).toContain('.col-1');
      expect(css).toContain('width: 1');
      expect(css).toContain('.col-2');
      expect(css).toContain('width: 2');
    });

    it('re-evaluates each() bindings across sibling nested rulesets', async () => {
      const css = await compiler.renderString(`
        @spacing-steps: range(0, 2);
        each(@spacing-steps, {
          .gap-@{value} {
            gap: (@value * 4px);
          }
          .space-x-@{value} > * + * {
            margin-left: (@value * 4px);
          }
          .space-y-@{value} > * + * {
            margin-top: (@value * 4px);
          }
        });
      `, { language: 'less' });

      expect(css).toContain('.gap-0');
      expect(css).toContain('gap: 0px');
      expect(css).toContain('.space-x-1 > * + *');
      expect(css).toContain('margin-left: 4px');
      expect(css).toContain('.space-y-2 > * + *');
      expect(css).toContain('margin-top: 8px');
    });

    it('re-evaluates default each() bindings inside nested rules', async () => {
      const css = await compiler.renderString(`
        @sizes: small 1, large 2;
        each(@sizes, {
          .@{key} {
            width: @value;
          }
        });
      `, { language: 'less' });

      expect(css).toContain('.1');
      expect(css).toContain('width: small 1');
      expect(css).toContain('.2');
      expect(css).toContain('width: large 2');
    });

    it('re-evaluates explicit each() callback bindings inside nested rules', async () => {
      const css = await compiler.renderString(`
        @sizes: small 1, large 2;
        each(@sizes, .(@size, @key) {
          .@{key} {
            width: @size;
          }
        });
      `, { language: 'less' });

      expect(css).toContain('.1');
      expect(css).toContain('width: small');
      expect(css).toContain('.2');
      expect(css).toContain('width: large');
    });

    it('merges each() callback output correctly inside nested @starting-style', async () => {
      const lessCode = `
        aside {
          @starting-style {
            each(1 2 3 4, {
              padding+_: (@value * 10px);
            });
          }
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('@starting-style');
      expect(css).toContain('padding: 10px 20px 30px 40px');
    });
  });

  describe('Less property merges', () => {
    it('continues a merge chain after a mixin emits the first merged declaration', async () => {
      const css = await compiler.renderString(`
        .shadow-base {
          box-shadow+: 0 1px 3px rgba(0, 0, 0, 0.12);
        }
        .shadow-elevated {
          .shadow-base();
          box-shadow+: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
      `, { language: 'less' });

      expect(css).toContain('.shadow-elevated');
      expect(css).toContain('box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 4px 6px rgba(0, 0, 0, 0.1)');
    });
  });

  describe.todo('Built-in Type Functions', () => {
    it('should handle isnumber function', async () => {
      const lessCode = `
        .test {
          result: isnumber(42);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('result:');
    });

    it('should handle isstring function', async () => {
      const lessCode = `
        .test {
          result: isstring("hello");
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('result:');
    });

    it('should handle iscolor function', async () => {
      const lessCode = `
        .test {
          result: iscolor(#ff0000);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('result:');
    });

    it('should handle iskeyword function', async () => {
      const lessCode = `
        .test {
          result: iskeyword(red);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('result:');
    });

    it('should handle isurl function', async () => {
      const lessCode = `
        .test {
          result: isurl(url("test.png"));
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('result:');
    });

    it('should handle ispixel function', async () => {
      const lessCode = `
        .test {
          result: ispixel(10px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('result:');
    });

    it('should handle isem function', async () => {
      const lessCode = `
        .test {
          result: isem(1.5em);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('result:');
    });

    it('should handle ispercentage function', async () => {
      const lessCode = `
        .test {
          result: ispercentage(50%);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('result:');
    });

    it('should handle isunit function', async () => {
      const lessCode = `
        .test {
          result: isunit(10px, px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('result:');
    });
  });

  describe.todo('Built-in Misc Functions', () => {
    it('should handle default function', async () => {
      const lessCode = `
        .test {
          value: default();
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('value:');
    });

    it('should handle unit function', async () => {
      const lessCode = `
        .test {
          value: unit(10px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('value:');
    });

    it('should handle getunit function', async () => {
      const lessCode = `
        .test {
          value: getunit(10px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('value:');
    });
  });

  describe.todo('Function with Variables', () => {
    it('should handle functions with variable parameters', async () => {
      const lessCode = `
        @color: #ff0000;
        @amount: 20%;
        
        .test {
          color: lighten(@color, @amount);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color:');
    });

    it('should handle functions with computed parameters', async () => {
      const lessCode = `
        @base: 10;
        @multiplier: 2;
        
        .test {
          width: (@base * @multiplier)px;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width:');
    });
  });
});
