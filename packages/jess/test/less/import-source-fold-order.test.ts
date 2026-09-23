import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

/**
 * `@import` is a SOURCE FOLD: the imported statements belong at the import's
 * lexical position, so a local fact after the `@import` overrides the imported
 * one and a local fact before it does not. Every expectation here is
 * `lessc 4.9.1` output for the same input.
 */
const lib = [
  '@v: L;',
  '.m() { a: L; }',
  '#ns() { same: L; onlyLib: L; }',
  ''
].join('\n');

const consumers = [
  '.x { a: @v; }',
  '.y { .m(); }',
  '.r { same: #ns[same]; lib: #ns[onlyLib]; app: #ns[onlyApp]; }',
  ''
].join('\n');

const local = [
  '@v: A;',
  '.m() { a: A; }',
  '#ns() { same: A; onlyApp: A; }'
].join('\n');

/* Same three facts as plain rulesets: a ruleset is a namespace AND a zero-arg
 * mixin, and both reach lookup through a different publication path. */
const ruleLib = '#ns { same: L; onlyLib: L; }\n.rs { a: L; }\n';
const ruleLocal = '#ns { same: A; onlyApp: A; }\n.rs { a: A; }\n';
const ruleConsumers = [
  '.r { same: #ns[same]; lib: #ns[onlyLib]; app: #ns[onlyApp]; }',
  '.q { .rs(); }',
  ''
].join('\n');

async function render(
  entry: string,
  libSource = lib,
  extra?: ReadonlyMap<string, string>
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'jess-import-fold-order-'));
  writeFileSync(join(dir, 'lib.less'), libSource);
  for (const [name, source] of extra ?? []) {
    writeFileSync(join(dir, name), source);
  }
  writeFileSync(join(dir, 'entry.less'), entry);
  return await new Compiler({ compile: { plugins: [lessPlugin()] } })
    .render(join(dir, 'entry.less'));
}

describe('@import folds imported facts in at the import\'s lexical position', () => {
  it('lets a local declaration after the import win', async () => {
    const css = await render(`@import "lib";\n${local}\n${consumers}`);

    expect(css).toBe([
      '.x {',
      '  a: A;',
      '}',
      '.y {',
      '  a: L;',
      '  a: A;',
      '}',
      '.r {',
      '  same: A;',
      '  lib: L;',
      '  app: A;',
      '}',
      ''
    ].join('\n'));
  });

  it('lets the imported declaration after a local one win (control: already passing)', async () => {
    const css = await render(`${local}\n@import "lib";\n${consumers}`);

    expect(css).toBe([
      '.x {',
      '  a: L;',
      '}',
      '.y {',
      '  a: A;',
      '  a: L;',
      '}',
      '.r {',
      '  same: L;',
      '  lib: L;',
      '  app: A;',
      '}',
      ''
    ].join('\n'));
  });

  it('places an imported plain ruleset at the import, as namespace and as mixin', async () => {
    const css = await render(`@import "lib";\n${ruleLocal}${ruleConsumers}`, ruleLib);

    expect(css).toBe([
      '#ns {',
      '  same: L;',
      '  onlyLib: L;',
      '}',
      '.rs {',
      '  a: L;',
      '}',
      '#ns {',
      '  same: A;',
      '  onlyApp: A;',
      '}',
      '.rs {',
      '  a: A;',
      '}',
      '.r {',
      '  same: A;',
      '  lib: L;',
      '  app: A;',
      '}',
      '.q {',
      '  a: L;',
      '  a: A;',
      '}',
      ''
    ].join('\n'));
  });

  it('folds a nested import in at its own position inside the imported document', async () => {
    const css = await render(
      '@import "lib";\n.x { a: @v; }\n.y { .m(); }\n',
      '@v: A1;\n.m() { a: A1; }\n@import "deep";\n@v: A2;\n.m() { a: A2; }\n',
      new Map([['deep.less', '@v: B;\n.m() { a: B; }\n']])
    );

    expect(css).toBe([
      '.x {',
      '  a: A2;',
      '}',
      '.y {',
      '  a: A1;',
      '  a: B;',
      '  a: A2;',
      '}',
      ''
    ].join('\n'));
  });

  it('keeps a later-imported plain ruleset ahead of the local one (control: already passing)', async () => {
    const css = await render(`${ruleLocal}@import "lib";\n${ruleConsumers}`, ruleLib);

    expect(css).toBe([
      '#ns {',
      '  same: A;',
      '  onlyApp: A;',
      '}',
      '.rs {',
      '  a: A;',
      '}',
      '#ns {',
      '  same: L;',
      '  onlyLib: L;',
      '}',
      '.rs {',
      '  a: L;',
      '}',
      '.r {',
      '  same: L;',
      '  lib: L;',
      '  app: A;',
      '}',
      '.q {',
      '  a: A;',
      '  a: L;',
      '}',
      ''
    ].join('\n'));
  });
});
