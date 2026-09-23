import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Compiler } from '../../src/index.js';
import scssPlugin from '@jesscss/plugin-scss';

/**
 * The scss half of the `@import` source fold (`serialize.ts`
 * `publishImportedDocumentFacts`). The scss grammar emits `mode: 'import'`, so
 * `@import` routes through the same publication as `.less` and the ordering rule
 * governs it too — but only TWO of the three fact kinds are observable here, and
 * for a different reason each:
 *
 * - **`@mixin` dispatch — the half this pins.** Definition order decides which
 *   body the cascade takes last. Measured `dart-sass 1.101.7` on the same input:
 *   import-then-local emits `a: A`, local-then-import emits `a: L`. Jess emits
 *   BOTH bodies in fold order (Less-style overloading applied to `@mixin`, a
 *   PRE-EXISTING divergence this change neither causes nor fixes), so the bytes
 *   differ from dart-sass while the winning declaration agrees in both orders.
 *   Before the fold fix the order was inverted, so the WINNER disagreed with
 *   dart-sass — that is the regression this file catches.
 * - **`$name` declarations — a control, correct before the fix.** Less `@name` is
 *   the SCOPED store (`declIndex`, read backward), which is what the fold fix
 *   reorders; scss/jess `$name` is the LIVE store (`activateVariableDeclaration`),
 *   written as statements execute and therefore already in fold order. Measured:
 *   with the site ranks disabled these two `.x` values are unchanged, so the
 *   declaration half of the fix is Less-only. Pinned here anyway, because "scss
 *   declarations do not depend on it" is exactly the kind of claim that rots.
 *
 * The namespace-member half has no scss syntax to reach it: `#ns[same]` is a
 * parse error in `.scss` ("Unexpected SCSS input after a complete stylesheet"),
 * so the imported `#ns` rulesets below are only ordinary CSS output. They are
 * kept in the fixture to pin that emission order, which IS the fold.
 */
const lib = [
  '$v: L;',
  '@mixin m { a: L; }',
  '#ns { same: L; onlyLib: L; }',
  ''
].join('\n');

const local = [
  '$v: A;',
  '@mixin m { a: A; }',
  '#ns { same: A; onlyApp: A; }',
  ''
].join('\n');

const consumers = '.x { a: $v; }\n.y { @include m; }\n';

async function render(entry: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'jess-scss-import-fold-'));
  writeFileSync(join(dir, '_lib.scss'), lib);
  writeFileSync(join(dir, 'entry.scss'), entry);
  return await new Compiler({ compile: { plugins: [scssPlugin()] } })
    .render(join(dir, 'entry.scss'));
}

describe('scss @import folds imported facts in at the import\'s lexical position', () => {
  it('lets a local @mixin and $var after the import win', async () => {
    const css = await render(`@import "lib";\n${local}${consumers}`);

    expect(css).toBe([
      '#ns {',
      '  same: L;',
      '  onlyLib: L;',
      '}',
      '#ns {',
      '  same: A;',
      '  onlyApp: A;',
      '}',
      '.x {',
      '  a: A;',
      '}',
      '.y {',
      '  a: L;',
      '  a: A;',
      '}',
      ''
    ].join('\n'));
  });

  it('lets the imported @mixin and $var after a local one win (control)', async () => {
    const css = await render(`${local}@import "lib";\n${consumers}`);

    expect(css).toBe([
      '#ns {',
      '  same: A;',
      '  onlyApp: A;',
      '}',
      '#ns {',
      '  same: L;',
      '  onlyLib: L;',
      '}',
      '.x {',
      '  a: L;',
      '}',
      '.y {',
      '  a: A;',
      '  a: L;',
      '}',
      ''
    ].join('\n'));
  });
});
