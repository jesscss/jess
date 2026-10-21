/**
 * A selector value interpolated into a selector is placed as `&` is; a plain comma
 * list is spliced as text (ledger P49, P50; owner 2026-10-21: "`@foo: one, two;` is
 * different from: `@foo: selector(one, two);` the latter, with @{foo} is an :is()").
 *
 * A selector value is a `selector(…)` capture, `&` read as a value and a
 * `selector.parse()` result. With a name glued after it, it multiplies the branch as
 * `&__x` does; glued after a selector or at a compound boundary it is one `:is()`
 * group, as `&` is a reference to its parent there. A plain list is text: each of its
 * items is spliced and the branch multiplies, glued or standing alone beside a
 * combinator (owner 2026-10-21), except in a pseudo's argument, where it is one item of
 * that argument. At whole-selector position both are one branch per item.
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
  ['a pseudo-class glued after', interp => `${interp}:hover`, [':is(apple, satsuma):hover'], ['apple:hover', 'satsuma:hover']],
  ['after a descendant combinator', interp => `.crate ${interp}`, ['.crate :is(apple, satsuma)'], ['.crate apple', '.crate satsuma']],
  ['after a child combinator', interp => `.crate > ${interp}`, ['.crate > :is(apple, satsuma)'], ['.crate > apple', '.crate > satsuma']],
  ['after a next-sibling combinator', interp => `.label + ${interp}`, ['.label + :is(apple, satsuma)'], ['.label + apple', '.label + satsuma']],
  ['after a subsequent-sibling combinator', interp => `.label ~ ${interp}`, ['.label ~ :is(apple, satsuma)'], ['.label ~ apple', '.label ~ satsuma']],
  ['before a combinator', interp => `${interp} > .stem`, [':is(apple, satsuma) > .stem'], ['apple > .stem', 'satsuma > .stem']]
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

/*
 * In a pseudo's argument an interpolation starts a selector of that argument's list, glued
 * to nothing: either kind of list stays inside the argument (never a rule per item, which
 * would turn `:not(b, i)` into `:not(b), :not(i)`).
 */
describe('a list interpolated into a pseudo argument', () => {
  it.each([
    ['less', 'a plain list', '@inline: b, i;\n.copy:not(@{inline}) { c: d; }\n.copy:has(> @{inline}) { c: d; }\n.copy:not(.lead, @{inline}) { c: d; }'],
    ['less', 'a selector value', '@inline: selector(b, i);\n.copy:not(@{inline}) { c: d; }\n.copy:has(> @{inline}) { c: d; }\n.copy:not(.lead, @{inline}) { c: d; }'],
    ['scss', 'a plain list', '$inline: b, i;\n.copy:not(#{$inline}) { c: d; }\n.copy:has(> #{$inline}) { c: d; }\n.copy:not(.lead, #{$inline}) { c: d; }']
  ] as const)('%s: %s stays one argument item', async (language, _kind, source) => {
    await expect(render(source, false, language)).resolves.toBe(
      '.copy:not(:is(b, i)) {\n  c: d;\n}\n.copy:has(> :is(b, i)) {\n  c: d;\n}\n.copy:not(.lead, :is(b, i)) {\n  c: d;\n}\n'
    );
  });

  it('scss: a plain list stays one argument item in a rule another extends', async () => {
    await expect(render('$inline: b, i;\n.copy:not(#{$inline}) { c: d; }\n.lede { @extend .copy; }', false, 'scss'))
      .resolves.toBe(':is(.copy, .lede):not(:is(b, i)) {\n  c: d;\n}\n');
  });
});

/* A comma list of captures is a selector value too (ledger P49 NOTES 2026-10-17). */
it.each([
  ['less', '@fruits: selector(apple), selector(satsuma);\n.basket { .ripe@{fruits} { c: d; } }'],
  ['jess', '$fruits: selector(apple), selector(satsuma);\n.basket { .ripe${fruits} { c: d; } }']
] as const)('%s: a comma list of captures glued after a class is one :is() group', async (language, source) => {
  await expect(render(source, false, language)).resolves.toBe(under(['.ripe:is(apple, satsuma)'], false));
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
          .resolves.toBe(under(['apple', 'satsuma'], collapseNesting));
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

/*
 * An item read out of a selector value is a selector value of one selector, so it is
 * placed as `&` is: glued after a class it is one `:is()` unit, never text that would
 * reread `.nav .link` as `.is-current.nav .link`.
 */
describe('an item of a selector value is a selector value', () => {
  it.each([
    ['less', '@links: selector(.nav .link, .footer a);\n.x { first: extract(@links, 1); }\neach(@links, { .is-current@{value} { c: d; } });'],
    ['scss', '@use "sass:selector";\n@use "sass:list";\n$links: selector.parse(".nav .link, .footer a");\n.x { first: list.nth($links, 1); }\n@each $link in $links { .is-current#{$link} { c: d; } }'],
    ['jess', '@-use "#sass/list";\n$links: selector(.nav .link, .footer a);\n.x { first: $list.nth($links, 1); }\n$for ($link of $links) { .is-current${link} { c: d; } }']
  ] as const)('%s: extract, nth and each', async (language, source) => {
    await expect(render(source, false, language)).resolves.toBe(
      '.x {\n  first: .nav .link;\n}\n.is-current:is(.nav .link) {\n  c: d;\n}\n.is-current:is(.footer a) {\n  c: d;\n}\n'
    );
  });

  it('less: an extracted item glued after a class', async () => {
    await expect(render('@links: selector(.nav .link, .footer a);\n@first: extract(@links, 1);\n.is-current@{first} { c: d; }', false, 'less'))
      .resolves.toBe('.is-current:is(.nav .link) {\n  c: d;\n}\n');
  });

  it('less: an extracted item passed to a mixin', async () => {
    await expect(render('@links: selector(.nav .link, .footer a);\n.current(@link) { .is-current@{link} { c: d; } }\n.current(extract(@links, 1));', false, 'less'))
      .resolves.toBe('.is-current:is(.nav .link) {\n  c: d;\n}\n');
  });

  it('scss: an item is still the space list of its compound selectors', async () => {
    await expect(render('@use "sass:selector";\n@use "sass:list";\n$links: selector.parse(".nav .link, .footer a");\n.x { n: list.length(list.nth($links, 1)); last: list.nth(list.nth($links, 1), 2); }', false, 'scss'))
      .resolves.toBe('.x {\n  n: 2;\n  last: .link;\n}\n');
  });
});
