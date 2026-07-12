/**
 * Bootstrap 4 per-file compatibility tests.
 *
 * Tests individual Bootstrap files to isolate compilation failures.
 * Each test imports the standard preamble (_functions, _variables, _mixins)
 * and a single Bootstrap component file.
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import * as path from 'path';
import * as fs from 'fs';

const bsRoot = (() => {
  const paths = [
    path.resolve(__dirname, '../../../../node_modules/bootstrap-less-port/less'),
    path.resolve(__dirname, '../../../../../less.js/node_modules/.pnpm/bootstrap-less-port@0.3.0/node_modules/bootstrap-less-port/less')
  ];
  return paths.find(p => fs.existsSync(p)) ?? null;
})();

const compiler = new Compiler({
  compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
});

const preamble = '@import "_functions"; @import "_variables"; @import "_mixins";';

async function compileBootstrapFile(file: string): Promise<string> {
  if (!bsRoot) {
    throw new Error('bootstrap-less-port not found');
  }
  const tmpFile = path.join(bsRoot, `__test_${file}.less`);
  fs.writeFileSync(tmpFile, `${preamble}\n@import "${file}";`);
  try {
    const result = await compiler.compile(tmpFile, { suppressWarnings: true, breakOnError: false });
    return result.tree.toString({ collapseNesting: result.context.opts.collapseNesting, context: result.context });
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

describe('Bootstrap 4 per-file compilation', () => {
  if (!bsRoot) {
    it.skip('bootstrap-less-port not found', () => {});
    return;
  }

  // These files currently fail with "'X' is not defined" errors.
  // Variables from mixin parameters / extract() aren't found in scope
  // when used inside detached rulesets or nested mixin calls.
  const failingFiles = [
    { file: '_buttons', error: 'hover-background' },
    { file: '_tables', error: 'hover-background' },
    { file: '_badge', error: 'bg' },
    { file: '_list-group', error: 'color' },
    { file: '_grid', error: 'infix' },
    { file: '_custom-forms', error: 'text' },
    { file: '_utilities', error: 'color' }
  ];

  for (const { file, error } of failingFiles) {
    it(`compiles ${file}.less (currently fails: '${error}' not defined)`, async () => {
      const css = await compileBootstrapFile(file);
      expect(css.length).toBeGreaterThan(0);
    });
  }
});
