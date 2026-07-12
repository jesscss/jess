import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const compiler = new Compiler({
  compile: {
    plugins: [lessPlugin(), lessCompatPlugin()]
  }
});

describe('extract() with nested lists', () => {
  it('extracts from a comma-separated list', async () => {
    const css = await compiler.renderString(`
      @items: a, b, c;
      .test {
        val: extract(@items, 2);
        len: length(@items);
      }
    `, { language: 'less' });
    console.log('Simple extract:', css);
    expect(css).toContain('val: b');
    expect(css).toContain('len: 3');
  });

  it('extracts from nested list (list of pairs)', async () => {
    const css = await compiler.renderString(`
      @colors: red #ff0000, blue #0000ff;
      .test {
        @item: extract(@colors, 1);
        @color: extract(@item, 1);
        @value: extract(@item, 2);
        color: @color;
        bg: @value;
      }
    `, { language: 'less' });
    console.log('Nested extract:', css);
    expect(css).toContain('color: red');
    expect(css).toContain('bg: #ff0000');
  });

  it('extracts nested list in mixin body', async () => {
    const css = await compiler.renderString(`
      @colors: red #ff0000, blue #0000ff;
      #gen(@i: 1) when (@i =< length(@colors)) {
        @item: extract(@colors, @i);
        @color: extract(@item, 1);
        @value: extract(@item, 2);
        .@{color} { color: @value; }
        #gen((@i + 1));
      }
      #gen();
    `, { language: 'less' });
    console.log('Mixin extract:', css);
    expect(css).toContain('.red');
    expect(css).toContain('color: #ff0000');
  });

  it('uses extracted value as CSS custom property value (with interpolation)', async () => {
    // Custom property values require @{var} interpolation syntax.
    // Plain @var is preserved as literal text (correct CSS custom property behavior).
    const css = await compiler.renderString(`
      @colors: red #ff0000, blue #0000ff;
      :root {
        #gen(@i: 1) when (@i =< length(@colors)) {
          @item: extract(@colors, @i);
          @color: extract(@item, 1);
          @val: extract(@item, 2);
          --@{color}: @{val};
          #gen((@i + 1));
        }
        #gen();
      }
    `, { language: 'less' });
    console.log(':root extract:', css);
    expect(css).toContain('--red: #ff0000');
    expect(css).toContain('--blue: #0000ff');
  });
});
