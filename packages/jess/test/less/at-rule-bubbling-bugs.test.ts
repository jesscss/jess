/**
 * Targeted integration tests for at-rule bubbling + selector resolution bugs.
 * Each test isolates a minimal Less input that fails in all-less.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const compiler = new Compiler({
  output: { collapseNesting: true },
  compile: {
    plugins: [
      lessPlugin(),
      lessCompatPlugin()
    ]
  }
});

async function render(less: string): Promise<string> {
  return compiler.renderString(less, { extension: '.less' });
}

function trimLines(s: string): string {
  return s.trim().split('\n').map(l => l.trimEnd()).join('\n');
}

describe('At-rule bubbling selector bugs', () => {
  /**
   * Bug 1: Parent selector lost during mixin + at-rule bubbling
   * Source: at-rules.less lines 135-145
   * .wrapper calls a mixin that contains @media with a nested ruleset.
   * The parent selector (.wrapper) should prepend to .mobile-only.
   */
  it('mixin with at-rule preserves parent selector', async () => {
    const css = await render(`
.mixin-with-atrule() {
  @media (max-width: 600px) {
    .mobile-only {
      display: block;
    }
  }
}
.wrapper {
  .mixin-with-atrule();
}
    `);
    expect(trimLines(css)).toBe(trimLines(`
@media (max-width: 600px) {
  .wrapper .mobile-only {
    display: block;
  }
}
    `));
  });

  /**
   * Bug 2: Parent selector lost in deeply nested at-rule bubbling
   * Source: at-rules-bubbling.less lines 74-93
   * html > div > @supports > declarations + @media > declarations + nested
   * The parent selectors (html, div) should prepend through all at-rules.
   */
  it('deeply nested at-rule bubbling preserves ancestor selectors', async () => {
    const css = await render(`
@media print {
  html {
    in-html: visible;
    @supports (upper: test) {
      in-supports: first;
      div {
        in-div: visible;
        @supports not (-webkit-font-smoothing: subpixel-antialiased) {
          in-supports: second;
          @media screen {
            font-weight: 400;
            nested {
              property: value;
            }
          }
        }
      }
    }
  }
}
    `);
    expect(trimLines(css)).toBe(trimLines(`
@media print {
  html {
    in-html: visible;
  }
  @supports (upper: test) {
    html {
      in-supports: first;
    }
    html div {
      in-div: visible;
    }
    @supports not (-webkit-font-smoothing: subpixel-antialiased) {
      html div {
        in-supports: second;
      }
      @media screen {
        html div {
          font-weight: 400;
        }
        html div nested {
          property: value;
        }
      }
    }
  }
}
    `));
  });

  /**
   * Bug 3: Spurious :is() wrapping with & (parent ref) + at-rule bubbling
   * Source: at-rules-bubbling.less lines 29-35
   * .top { .inside & { @supports { ... } } }
   * Should resolve to .inside .top, not .inside :is(.inside .top)
   */
  it('parent ref & with at-rule does not produce spurious :is()', async () => {
    const css = await render(`
.top {
  .inside & {
    @supports (sandwitch: ham) {
      property: value;
    }
  }
}
    `);
    expect(trimLines(css)).toBe(trimLines(`
@supports (sandwitch: ham) {
  .inside .top {
    property: value;
  }
}
    `));
  });

  /**
   * Bug 4: Nested ruleset collapsed into parent with & + sibling in @media
   * Source: at-rules-targeted.less lines 41-49
   * .container { @media { & { color: red; } .child { color: blue; } } }
   * & should resolve to .container, .child should become .container .child
   */
  it('& and sibling in @media both resolve correctly', async () => {
    const css = await render(`
.container {
  @media screen {
    & {
      color: red;
    }
    .child {
      color: blue;
    }
  }
}
    `);
    expect(trimLines(css)).toBe(trimLines(`
@media screen {
  .container {
    color: red;
  }
  .container .child {
    color: blue;
  }
}
    `));
  });

  /**
   * Bug 5: Mixin body at-rule bubbling loses caller's selector
   * Source: at-rules-bubbling.less lines 113-126
   * html { .nestedSupportsMixin(); } where mixin has @supports with nested ruleset
   */
  it('mixin body at-rule preserves caller selector for nested rulesets', async () => {
    const css = await render(`
.nestedSupportsMixin() {
  font-weight: 300;
  -webkit-font-smoothing: subpixel-antialiased;
  @supports not (-webkit-font-smoothing: subpixel-antialiased) {
    font-weight: 400;
    nested {
      property: value;
    }
  }
}
html {
  .nestedSupportsMixin();
}
    `);
    expect(trimLines(css)).toBe(trimLines(`
html {
  font-weight: 300;
  -webkit-font-smoothing: subpixel-antialiased;
}
@supports not (-webkit-font-smoothing: subpixel-antialiased) {
  html {
    font-weight: 400;
  }
  html nested {
    property: value;
  }
}
    `));
  });

  /**
   * Bug 6: & with .outOfMedia prepended through multiple at-rules
   * Source: at-rules-bubbling.less lines 53-61
   */
  it('& ref through multiple nested at-rules resolves without :is()', async () => {
    const css = await render(`
@supports (property: value) {
  .outOfMedia & {
    @media (max-size: 2px) {
      @supports (whatever: something) {
        property: value;
      }
    }
  }
}
    `);
    expect(trimLines(css)).toBe(trimLines(`
@supports (property: value) {
  @media (max-size: 2px) {
    @supports (whatever: something) {
      .outOfMedia {
        property: value;
      }
    }
  }
}
    `));
  });
});
