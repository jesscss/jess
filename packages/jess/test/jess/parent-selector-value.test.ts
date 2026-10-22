import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * `&` in a `.jess` value is the parent selector, as in SCSS (owner 2026-10-19:
 * "& should also be accepted as a value in .jess IMO"): the selector of the
 * style rule it is evaluated in, as a comma list of space lists, or `null`
 * outside any rule. The values are Dart Sass's for the SCSS each case spells.
 */
const render = async (source: string): Promise<string> =>
  new Compiler().renderString(source, { extension: '.jess' });

describe('jess: `&` in a value is the parent selector', () => {
  it.each([
    ['in a declaration', '.a, .b {\n  .c {\n    x: &;\n  }\n}\n', '.a,\n.b {\n  .c {\n    x: .a .c, .b .c;\n  }\n}\n'],
    ['spliced into a string', '.card {\n  &__title {\n    content: "$(&)";\n  }\n}\n', '.card__title {\n  content: ".card__title";\n}\n'],
    ['passed to a mixin', 'label($s) {\n  content: "${s}";\n}\n.q, .r {\n  $ > label(&);\n}\n', '.q,\n.r {\n  content: ".q, .r";\n}\n'],
    ['read where a variable is assigned', '.menu {\n  $root: &;\n  .entry {\n    content: "${root}";\n  }\n}\n', '.menu {\n  .entry {\n    content: ".menu";\n  }\n}\n'],
    ['null outside any rule', '$sel: &;\n.a {\n  x: $sel;\n  y: z;\n}\n', '.a {\n  y: z;\n}\n'],
    [
      'a condition that tells a rule from the root',
      'theme() {\n  $if (&) {\n    color: red;\n  } $else {\n    :root {\n      color: red;\n    }\n  }\n}\n$ > theme();\n.t {\n  $ > theme();\n}\n',
      ':root {\n  color: red;\n}\n.t {\n  color: red;\n}\n'
    ]
  ])('%s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });

  /* A value can hold `&`, so a selector that ends in one is a nested rule, not a declaration. */
  it('leaves `&` after a pseudo-class a nested rule', async () => {
    await expect(render('.a {\n  div:hover & {\n    c: d;\n  }\n}\n'))
      .resolves.toBe('.a {\n  div:hover & {\n    c: d;\n  }\n}\n');
  });
});
