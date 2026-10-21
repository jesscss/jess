/**
 * A selector value interpolated into a selector is placed as `&` is; a plain comma
 * list is spliced as text (ledger P49, P50; owner 2026-10-21: "`@foo: one, two;` is
 * different from: `@foo: selector(one, two);` the latter, with @{foo} is an :is()").
 *
 * A selector value is a `selector(…)` capture, `&` read as a value and a
 * `selector.parse()` result. With a name glued after it, it multiplies the branch as
 * `&__x` does; glued after a selector or at a compound boundary it is one `:is()`
 * group, as `&` is a reference to its parent there. A plain list is text wherever it
 * is glued: each of its items is spliced and the branch multiplies. At whole-selector
 * position both are one branch per item.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

type Language = 'less' | 'scss' | 'jess';

async function render(source: string, collapseNesting: boolean, language: Language): Promise<string> {
  return new Compiler({ output: { collapseNesting } }).renderString(source, {
    language,
    filePath: `/virtual/selector-value-interpolation.${language}`
  });
}

/** `.basket { <header> { c: d; } }`, written nested and collapsed, for the header's branches. */
const under = (branches: readonly string[], collapseNesting: boolean): string => collapseNesting
  ? `${branches.map(branch => `.basket ${branch}`).join(',\n')} {\n  c: d;\n}\n`
  : `.basket {\n  ${branches.join(',\n  ')} {\n    c: d;\n  }\n}\n`;

/** The value declarations and interpolation spelling of each dialect. */
const selectorValue: Record<Language, readonly [string, (name: string) => string]> = {
  less: ['@fruits: selector(apple, satsuma);', name => `@{${name}}`],
  scss: ['@use "sass:selector";\n$fruits: selector.parse("apple, satsuma");', name => `#{$${name}}`],
  jess: ['$fruits: selector(apple, satsuma);', name => `\${${name}}`]
};

const plainList: Record<Language, readonly [string, (name: string) => string]> = {
  less: ['@fruits: apple, satsuma;', name => `@{${name}}`],
  scss: ['$fruits: apple, satsuma;', name => `#{$${name}}`],
  jess: ['$fruits: apple, satsuma;', name => `\${${name}}`]
};

/** Each position: the header written around the interpolation, its branches for a selector value, and for a plain list. */
const positions: ReadonlyArray<readonly [string, (interp: string) => string, readonly string[], readonly string[]]> = [
  ['a name glued after', interp => `${interp}-cap`, ['apple-cap', 'satsuma-cap'], ['apple-cap', 'satsuma-cap']],
  ['a name prefix glued before', interp => `.fruit-cap-${interp}`, ['.fruit-cap-:is(apple, satsuma)'], ['.fruit-cap-apple', '.fruit-cap-satsuma']],
  ['a class glued before', interp => `.ripe${interp}`, ['.ripe:is(apple, satsuma)'], ['.ripeapple', '.ripesatsuma']],
  ['a pseudo-class glued after', interp => `${interp}:hover`, [':is(apple, satsuma):hover'], ['apple:hover', 'satsuma:hover']]
];

const languages: readonly Language[] = ['less', 'scss', 'jess'];

describe('a selector value interpolated into a selector is placed as `&` is', () => {
  for (const language of languages) {
    for (const collapseNesting of [false, true]) {
      it.each(positions)(`${language}, collapseNesting: ${collapseNesting}: %s`, async (_position, header, branches) => {
        const [declaration, interp] = selectorValue[language];
        await expect(render(`${declaration}\n.basket { ${header(interp('fruits'))} { c: d; } }`, collapseNesting, language))
          .resolves.toBe(under(branches, collapseNesting));
      });

      it(`${language}, collapseNesting: ${collapseNesting}: the whole selector is one branch per selector`, async () => {
        const [declaration, interp] = selectorValue[language];
        await expect(render(`${declaration}\n.basket { ${interp('fruits')} { c: d; } }`, collapseNesting, language))
          .resolves.toBe(collapseNesting ? under([':is(apple, satsuma)'], true) : under(['apple', 'satsuma'], false));
      });
    }
  }

  /* One selector is still a reference: glued after a selector it is no part of that compound's name. */
  it.each([
    ['less', '@fruit: selector(apple);\n.basket { .fruit-cap-@{fruit} { c: d; } }', '.fruit-cap-:is(apple)'],
    ['jess', '$fruit: selector(apple);\n.basket { .fruit-cap-${fruit} { c: d; } }', '.fruit-cap-:is(apple)'],
    ['less', '@button: selector(.btn);\n.basket { .toolbar@{button} { c: d; } }', '.toolbar:is(.btn)'],
    ['less', '@button: selector(.btn);\n.basket { @{button}:hover { c: d; } }', '.btn:hover']
  ] as const)('%s: one selector in `%s`', async (language, source, header) => {
    await expect(render(source, false, language)).resolves.toBe(under([header], false));
  });
});

describe('`&` interpolated into a selector is placed as `&` is', () => {
  const amp: Record<'scss' | 'jess', (header: string) => string> = {
    scss: header => `apple, satsuma {\n  ${header.replace('&', '#{&}')} { c: d; }\n}`,
    jess: header => `apple, satsuma {\n  $self: &;\n  ${header.replace('&', '${self}')} { c: d; }\n}`
  };
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ['a name glued after', '&-cap', 'apple-cap,\n  satsuma-cap'],
    ['a name prefix glued before', '.fruit-cap-&', '.fruit-cap-:is(apple, satsuma)'],
    ['a class glued before', '.ripe&', '.ripe:is(apple, satsuma)'],
    ['a pseudo-class glued after', '&:hover', ':is(apple, satsuma):hover']
  ];

  for (const language of ['scss', 'jess'] as const) {
    it.each(cases)(`${language}: %s`, async (_position, header, written) => {
      await expect(render(amp[language](header), false, language))
        .resolves.toBe(`apple,\nsatsuma {\n  ${written} {\n    c: d;\n  }\n}\n`);
    });
  }
});

describe('a plain comma list interpolated into a selector is text', () => {
  for (const language of languages) {
    for (const collapseNesting of [false, true]) {
      it.each(positions)(`${language}, collapseNesting: ${collapseNesting}: %s`, async (_position, header, _selector, branches) => {
        const [declaration, interp] = plainList[language];
        await expect(render(`${declaration}\n.basket { ${header(interp('fruits'))} { c: d; } }`, collapseNesting, language))
          .resolves.toBe(under(branches, collapseNesting));
      });

      it(`${language}, collapseNesting: ${collapseNesting}: the whole selector is one branch per item`, async () => {
        const [declaration, interp] = plainList[language];
        await expect(render(`${declaration}\n.basket { ${interp('fruits')} { c: d; } }`, collapseNesting, language))
          .resolves.toBe(collapseNesting ? under([':is(apple, satsuma)'], true) : under(['apple', 'satsuma'], false));
      });
    }
  }
});

describe('a selector value is still a list', () => {
  it.each([
    ['less', '@fruits: selector(apple, satsuma > .ripe);\n.x { n: length(@fruits); second: extract(@fruits, 2); all: @fruits; }\neach(@fruits, { .crate @{value} { c: d; } });'],
    ['scss', '@use "sass:selector";\n@use "sass:list";\n$fruits: selector.parse("apple, satsuma > .ripe");\n.x { n: list.length($fruits); second: list.nth($fruits, 2); all: $fruits; }\n@each $fruit in $fruits { .crate #{$fruit} { c: d; } }'],
    ['jess', '@-use "#sass/list";\n$fruits: selector(apple, satsuma > .ripe);\n.x { n: $list.length($fruits); second: $list.nth($fruits, 2); all: $fruits; }\n$for ($fruit of $fruits) { .crate ${fruit} { c: d; } }']
  ] as const)('%s: length, nth and each read one item per selector', async (language, source) => {
    await expect(render(source, false, language)).resolves.toBe(
      '.x {\n  n: 2;\n  second: satsuma > .ripe;\n  all: apple, satsuma > .ripe;\n}\n.crate apple {\n  c: d;\n}\n.crate satsuma > .ripe {\n  c: d;\n}\n'
    );
  });
});
