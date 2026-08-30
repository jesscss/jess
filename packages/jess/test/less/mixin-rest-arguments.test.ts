import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import { defineFunction, makeKeyword, makeList } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

describe('Less mixin rest arguments', () => {
  it('keeps a sole space-list as one argument while comma and semicolon calls remain separate', async () => {
    const compiler = new Compiler({ compile: { plugins: [lessPlugin()] } });
    const css = await compiler.renderString(`
.collect(@values...) {
  count: length(@values);
  first: extract(@values, 1);
  third: extract(@values, 3);
  args: @arguments;
}
.space { .collect(a b c); }
.comma { .collect(a, b, c); }
.semi { .collect(1; 2; 3); }
`, { language: 'less' });

    expect(css).toBe(
      '.space {\n  count: 1;\n  first: a b c;\n  third: extract(a b c, 3);\n  args: a b c;\n}\n'
      + '.comma {\n  count: 3;\n  first: a;\n  third: c;\n  args: a b c;\n}\n'
      + '.semi {\n  count: 3;\n  first: 1;\n  third: 3;\n  args: 1 2 3;\n}\n'
    );
  });

  it('keeps nested list structure through fixed parameters and @arguments', async () => {
    const compiler = new Compiler({ compile: { plugins: [lessPlugin()] } });
    const css = await compiler.renderString(`
@letters: a, b, c;
@numbers: 1, 2, 3;
@words: x, y, z;
@left: a b, c d;
@right: 1 2, 3 4;
@spread-values: @left, @right;
.fixed(@value) {
  .fixed {
    length: length(@value);
    second: extract(@value, 2);
  }
}
.forward(@value) {
  .forwarded {
    length: length(@value);
    second: extract(@value, 2);
  }
}
.defaulted(@value: @right) {
  .defaulted {
    length: length(@value);
    second: extract(@value, 2);
  }
}
.spread(@first, @second) {
  .spread {
    first-length: length(@first);
    second-length: length(@second);
    second-first: extract(@second, 1);
  }
}
.computed(@value) {
  .computed {
    length: length(@value);
    second: extract(@value, 2);
  }
}
.variadic(@values...) {
  .variadic {
    length: length(@values);
    second: extract(@values, 2);
  }
}
.anonymous(...) {
  .anonymous {
    length: length(@arguments);
    second: extract(@arguments, 2);
  }
}
.arguments(@first, @second) {
  @values: @arguments;
  .arguments {
    outer-length: length(@values);
    second-length: length(extract(@values, 2));
    second-first: extract(extract(@values, 2), 1);
  }
}
.fixed(@letters @numbers @words);
.forward(@letters @numbers @words);
.defaulted();
.spread(@spread-values...);
.computed(range(3));
.variadic(@letters @numbers @words);
.anonymous(@letters @numbers @words);
.arguments(@left, @right);
`, { language: 'less' });

    expect(css).toBe(
      '.fixed {\n  length: 3;\n  second: 1, 2, 3;\n}\n'
      + '.forwarded {\n  length: 3;\n  second: 1, 2, 3;\n}\n'
      + '.defaulted {\n  length: 2;\n  second: 3 4;\n}\n'
      + '.spread {\n  first-length: 2;\n  second-length: 2;\n  second-first: 1 2;\n}\n'
      + '.computed {\n  length: 3;\n  second: 2;\n}\n'
      + '.variadic {\n  length: 3;\n  second: 1, 2, 3;\n}\n'
      + '.anonymous {\n  length: 3;\n  second: 1, 2, 3;\n}\n'
      + '.arguments {\n  outer-length: 2;\n  second-length: 2;\n  second-first: 1 2;\n}\n'
    );
  });

  it('evaluates a computed structural argument once', async () => {
    let calls = 0;
    const compiler = new Compiler({
      compile: {
        plugins: [
          lessPlugin(),
          lessCompatPlugin({
            functions: [defineFunction('counted-list', {
              params: [] as const,
              body: () => {
                calls += 1;
                return makeList([makeKeyword('alpha'), makeKeyword('beta')], ',');
              }
            })]
          })
        ]
      }
    });
    const css = await compiler.renderString(`
.use(@value) {
  .result {
    length: length(@value);
    second: extract(@value, 2);
  }
}
.use(@value) when (false) {
  ignored: true;
}
.use(counted-list());
`, { language: 'less' });

    expect(css).toBe('.result {\n  length: 2;\n  second: beta;\n}\n');
    expect(calls).toBe(1);
  });
});
