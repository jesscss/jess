import { afterEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../../src/index.js';
import { Context } from '@jesscss/core';
import { defineFunction, makeDimension, makeKeyword, makeList, type Fn } from '@jesscss/core';
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

/*
 * The compatibility package accepts native AST-v2 functions. Keep this
 * equivalent to the legacy Less registry fixture above without making the
 * public compiler route depend on a Less tree/plugin bridge.
 */
const lessHarnessFunctions: readonly Fn[] = [
  defineFunction('add', {
    params: [{ type: 'Dimension' }, { type: 'Dimension' }] as const,
    body: (a, b) => makeDimension(a.number + b.number, a.unit || b.unit)
  }),
  defineFunction('increment', {
    params: [{ type: 'Dimension' }] as const,
    body: a => makeDimension(a.number + 1, a.unit)
  }),
  defineFunction('_color', {
    params: [{ type: 'any' }] as const,
    body: value => value.type === 'Quoted' && value.value === 'evil red'
      ? makeKeyword('#660000')
      : value
  })
];

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
    it('registers configured native Less plugin functions once per public AST render', async () => {
      let installs = 0;
      const nativePlugin = {
        install(less: any) {
          installs++;
          lessHarnessFunctionsPlugin.install(less);
        }
      };
      const compilerWithNativeFunctions = new Compiler({
        compile: { plugins: [lessPlugin({ plugins: [nativePlugin] })] }
      });
      const root = makeTmpDir();
      const lessPath = path.join(root, 'native-functions.less');
      fs.writeFileSync(lessPath, '.first { width: increment(4px); } .second { color: _color("evil red"); width: add(2, 3); }', 'utf8');

      expect(await compilerWithNativeFunctions.render(lessPath)).toBe(
        '.first {\n  width: 5;\n}\n.second {\n  color: #660000;\n  width: 5;\n}\n'
      );
      expect(await compilerWithNativeFunctions.render(lessPath)).toBe(
        '.first {\n  width: 5;\n}\n.second {\n  color: #660000;\n  width: 5;\n}\n'
      );
      expect(installs).toBe(2);
    });

    it('keeps configured native function hooks out of an empty Less adapter', async () => {
      const configuredCompiler = new Compiler({
        compile: { plugins: [lessPlugin({ plugins: [lessHarnessFunctionsPlugin] })] }
      });
      const defaultCompiler = new Compiler({ compile: { plugins: [lessPlugin()] } });

      expect(await configuredCompiler.renderString('.x { width: increment(4); }', { language: 'less' }))
        .toContain('width: 5');
      expect(await defaultCompiler.renderString('.x { width: increment(4); }', { language: 'less' }))
        .toContain('width: increment(4)');
    });

    it('should support native AST-v2 functions through less-compat setup', async () => {
      const compilerWithCompatFunctions = new Compiler({
        compile: {
          plugins: [
            lessPlugin(),
            lessCompatPlugin({
              functions: lessHarnessFunctions
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

    it('should keep native less-compat functions working when the plugin instance is reused across compilers', async () => {
      const sharedCompatPlugin = lessCompatPlugin({
        functions: lessHarnessFunctions
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

    it('keeps achromatic colors achromatic when desaturating', async () => {
      const lessCode = `
        .test {
          color: desaturate(#888, 10%);
          background: desaturate(#999, 10%);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toBe(`.test {
  color: #888888;
  background: #999999;
}
`);
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

  describe('Less type predicates', () => {
    it('recognizes typed url values without classifying url-shaped bytes', async () => {
      const css = await compiler.renderString(`
        @asset: "test";
        @image: url("@{asset}.png");
        @alias: @image;
        @comma-pair: url("comma-a.png"), url("comma-b.png");
        @space-pair: url("space-a.png") url("space-b.png");
        @slash-pair: url("slash-a.png") / url("slash-b.png");
        @url-list: url("list-a.png"), url("list-b.png");
        @forward-url-list: url("forward-a.png"), url("forward-b.png");
        .url-only(@value) when (isurl(@value)) {
          guarded: true;
        }
        .body-check(@value) {
          body-check: isurl(@value);
        }
        .forward(@value) {
          .url-only(@value);
          .body-check(@value);
        }
        .default-url(@value: @alias) when (ISURL(@value)) {
          default-guarded: true;
          default-body-check: isurl(@value);
        }
        .spread-fixed(@value) {
          spread-fixed: isurl(@value);
        }
        .spread-rest(@values...) {
          spread-rest: isurl(extract(@values, 1));
        }
        .computed(@explicit, @defaulted: if(true, url("default.png"), plain)) {
          computed-explicit: isurl(@explicit);
          computed-default: isurl(@defaulted);
        }
        .spread-pair(@first, @second) {
          spread-pair-first: isurl(@first);
          spread-pair-second: isurl(@second);
        }
        .spread-slash(@first, @separator, @third) {
          spread-slash-first: isurl(@first);
          spread-slash-separator: @separator;
          spread-slash-third: isurl(@third);
        }
        .list-items(@values) {
          list-first: isurl(extract(@values, 1));
          list-second: isurl(extract(@values, 2));
        }
        .forward-list(@values) {
          .list-items(@values);
        }
        .arguments-list(@values) {
          arguments-first: isurl(extract(extract(@arguments, 1), 1));
          arguments-second: isurl(extract(extract(@arguments, 1), 2));
        }
        #url-space {
          .nested(@value) {
            namespace: isurl(@value);
          }
        }
        .outer(@value) {
          .inner(@nested) {
            nested: isurl(@nested);
          }
          .inner(@value);
        }
        .test {
          direct: isurl(url("test.png"));
          variable: isurl(@image);
          keyword: iskeyword(url("test.png"));
          call: isurl(foo());
          quoted: isurl("url(test.png)");
          .forward(@alias);
          .default-url();
          .spread-fixed(@alias...);
          .spread-rest(@alias...);
          .computed(if(true, url("computed.png"), plain));
          .spread-pair(@comma-pair...);
          .spread-pair(@space-pair...);
          .spread-slash(@slash-pair...);
          .list-items(@url-list);
          .forward-list(@forward-url-list);
          .arguments-list(@url-list);
          #url-space > .nested(@alias);
          .outer(@alias);
        }
      `, { language: 'less' });

      expect(css).toBe(`.test {
  direct: true;
  variable: true;
  keyword: false;
  call: false;
  quoted: false;
  guarded: true;
  body-check: true;
  default-guarded: true;
  default-body-check: true;
  spread-fixed: true;
  spread-rest: true;
  computed-explicit: true;
  computed-default: true;
  spread-pair-first: true;
  spread-pair-second: true;
  spread-pair-first: true;
  spread-pair-second: true;
  spread-slash-first: true;
  spread-slash-separator: /;
  spread-slash-third: true;
  list-first: true;
  list-second: true;
  list-first: true;
  list-second: true;
  arguments-first: true;
  arguments-second: true;
  namespace: true;
  nested: true;
}
`);
    });

    it('preserves URL items and the separator from a function-produced slash list spread', async () => {
      const typedUrlCompiler = new Compiler({
        compile: {
          plugins: [
            lessPlugin(),
            lessCompatPlugin({
              functions: [defineFunction('slash-pair', {
                params: [{ type: 'Url' }, { type: 'Url' }] as const,
                body: (first, second) => makeList([first, second], '/')
              })]
            })
          ]
        }
      });
      const css = await typedUrlCompiler.renderString(`
        @values: slash-pair(url("a.png"), url("b.png"));
        .spread(@first, @separator, @third) {
          first: isurl(@first);
          separator: @separator;
          third: isurl(@third);
        }
        .test { .spread(@values...); }
      `, { language: 'less' });

      expect(css).toBe(`.test {
  first: true;
  separator: /;
  third: true;
}
`);
    });

    it('applies URL transforms once before forwarding typed URL values', async () => {
      const transformedCompiler = new Compiler({
        compile: { plugins: [lessPlugin({ rootpath: 'root/' })] }
      });
      const css = await transformedCompiler.renderString(`
        @image: url("image.png");
        .emit(@value) {
          emitted: @value;
        }
        .forward(@value) {
          .emit(@value);
        }
        .default(@value: @image) {
          defaulted: @value;
        }
        .spread(@value) {
          spread: @value;
        }
        .test {
          .forward(@image);
          .default();
          .spread(@image...);
        }
      `, { language: 'less' });

      expect(css).toBe(`.test {
  emitted: url("root/image.png");
  defaulted: url("root/image.png");
  spread: url("root/image.png");
}
`);
    });

    it('preserves guarded comment-only mixin output after dispatch reuse', async () => {
      const css = await compiler.renderString(`
        .comments(@selected) when (@selected = true) {
          /* selected */
        }
        .comments(@selected) when (@selected = false) {
          /* rejected */
        }
        .test {
          color: red;
          .comments(true);
        }
      `, { language: 'less' });

      expect(css).toBe(`.test {
  color: red;
}
`);
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
