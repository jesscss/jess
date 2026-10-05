/**
 * Selector captures are selector VALUES, not an instruction to flatten a
 * nested rule. The output option owns that boundary: nested output preserves
 * the authored parent/child structure, while an explicit collapse composes the
 * suffix ampersand over every captured parent branch. Less `each()` is the
 * existing opt-in when the author wants one emitted rule per ordinary list item
 * without changing the document's nesting policy.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

const captured = [
  '@fruits: *[apple, satsuma];',
  '@{fruits} {',
  '  .fruit-& { content: "Capture"; }',
  '}'
].join('\n');

async function render(source: string, collapseNesting: boolean): Promise<string> {
  return new Compiler({ output: { collapseNesting } }).renderString(source, {
    language: 'less',
    filePath: '/virtual/selector-capture-output.less'
  });
}

describe('Less selector-capture output boundaries', () => {
  it('does not implicitly flatten a captured parent list in nested output', async () => {
    await expect(render(captured, false)).resolves.toBe([
      'apple,',
      'satsuma {',
      '  .fruit-& {',
      '    content: "Capture";',
      '  }',
      '}',
      ''
    ].join('\n'));
  });

  it('composes the suffix ampersand over every captured branch when explicitly collapsed', async () => {
    await expect(render(captured, true)).resolves.toBe([
      '.fruit-apple,',
      '.fruit-satsuma {',
      '  content: "Capture";',
      '}',
      ''
    ].join('\n'));
  });

  /* Ledger O8(b), jess#347: an escaped selector's leading whitespace is canonicalized away at the header. */
  it('drops the leading whitespace an escaped selector brings to a nested header', async () => {
    const source = [
      '@c-quoted: ~\'.a, .b\';',
      '@d-quoted: ~\'.c, .d\';',
      '@e-quoted: ~\' + .e-quoted\';',
      '@{c-quoted}@{d-quoted} {',
      '  @{e-quoted} {',
      '    foo: baz;',
      '  }',
      '}'
    ].join('\n');

    await expect(render(source, false)).resolves.toBe([
      ':is(.a, .b):is(.c, .d) {',
      '  + .e-quoted {',
      '    foo: baz;',
      '  }',
      '}',
      ''
    ].join('\n'));
    await expect(render(source, true)).resolves.toBe([
      ':is(.a, .b):is(.c, .d) + .e-quoted {',
      '  foo: baz;',
      '}',
      ''
    ].join('\n'));
  });

  it('uses Less each() for explicit rule multiplication without enabling global collapse', async () => {
    const source = [
      '@fruits: apple, satsuma;',
      'each(@fruits, .(@fruit) {',
      '  .fruit-@{fruit} { content: "Capture"; }',
      '});'
    ].join('\n');

    await expect(render(source, false)).resolves.toBe([
      '.fruit-apple {',
      '  content: "Capture";',
      '}',
      '.fruit-satsuma {',
      '  content: "Capture";',
      '}',
      ''
    ].join('\n'));
  });
});
