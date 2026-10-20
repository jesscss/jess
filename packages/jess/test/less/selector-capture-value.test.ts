import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * A `selector(…)` capture evaluates to the value `&` and Sass's
 * `selector.parse()` are (ledger P49, P50): a comma list holding, per selector,
 * a space list of its compound selectors and combinators. So the list
 * functions read its selectors, and a value position writes the list.
 */
async function render(source: string, extension: '.less' | '.jess', collapseNesting = false): Promise<string> {
  return new Compiler({ output: { collapseNesting } }).renderString(source, { extension });
}

describe('selector() capture is a selector list', () => {
  it('has one item per selector, in .less and .jess', async () => {
    await expect(render('@buttons: selector(.btn, .btn-link > span);\n.debug { count: length(@buttons); second: extract(@buttons, 2); }', '.less'))
      .resolves.toBe('.debug {\n  count: 2;\n  second: .btn-link > span;\n}\n');
    await expect(render('@-use "#sass/list";\n$buttons: selector(.btn, .btn-link > span);\n.debug { count: $list.length($buttons); second: $list.nth($buttons, 2); compound: $list.nth($list.nth($buttons, 2), 3); }', '.jess'))
      .resolves.toBe('.debug {\n  count: 2;\n  second: .btn-link > span;\n  compound: span;\n}\n');
  });

  it('is a list a loop walks, in .less and .jess', async () => {
    const expected = '.btn {\n  cursor: pointer;\n}\n.btn-link {\n  cursor: pointer;\n}\n';
    await expect(render('@buttons: selector(.btn, .btn-link);\neach(@buttons, { @{value} { cursor: pointer; } });', '.less')).resolves.toBe(expected);
    await expect(render('$buttons: selector(.btn, .btn-link);\n$for ($b of $buttons) { ${b} { cursor: pointer; } }', '.jess')).resolves.toBe(expected);
  });

  it('writes its selectors in a value position, as `&` is written', async () => {
    await expect(render('@s: selector( .a>.b ,satsuma );\n.x { v: @s; }', '.less')).resolves.toBe('.x {\n  v: .a > .b, satsuma;\n}\n');
    await expect(render('$s: selector(.card, .panel);\n.card, .panel { own: &; captured: $s; }', '.jess'))
      .resolves.toBe('.card,\n.panel {\n  own: .card, .panel;\n  captured: .card, .panel;\n}\n');
  });
});
