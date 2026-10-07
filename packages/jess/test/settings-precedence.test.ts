/*
 * Which compile settings a source file uses (DESIGN-DECISIONS C19, owner
 * 2026-10-07): with nothing set, each file uses its own language's defaults, so
 * its output never depends on the file that imported it. Settings passed to the
 * compiler or the render are global and win everywhere. A folder's
 * `styles.config` and the `language.<lang>` settings apply only to the files
 * they cover.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler, type ConfigOptions } from '../src/index.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-settings-precedence-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Write `[name, content]` files under the test directory. */
function write(...files: Array<readonly [string, string]>): void {
  for (const [name, content] of files) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

async function render(entry: string, compilerOptions: ConfigOptions = {}, renderOptions: Partial<ConfigOptions> = {}) {
  const result = await new Compiler({ ...compilerOptions, quiet: true })
    .renderToResult(path.join(dir, entry), { ...renderOptions, quiet: true });
  return {
    css: result.css.replace(/\s+/g, ' ').trim(),
    warnings: result.warnings.map(w => w.code),
    errors: result.errors.map(e => e.code)
  };
}

const PART_JESS = ['part.jess', '.j { k: $(1px + 3em); }'] as const;
const PART_LESS = ['part.less', '.l { k: 1px + 1em; }'] as const;
const LESS_IMPORTS_JESS = ['less-entry.less', '@import \'part.jess\';'] as const;
const JESS_IMPORTS_LESS = ['jess-entry.jess', '@-import \'./part.less\';'] as const;

describe('implicit settings are per language', () => {
  beforeEach(() => {
    write(PART_JESS, PART_LESS, LESS_IMPORTS_JESS, JESS_IMPORTS_LESS);
  });

  it('a .jess file imported by a .less file keeps the .jess default: mixed units are an error', async () => {
    expect((await render('less-entry.less')).errors).toEqual(['eval/invalid-unit-arithmetic']);
  });

  it('a .less file imported by a .jess file keeps the .less default: mixed units are kept in calc() and warn', async () => {
    expect(await render('jess-entry.jess')).toEqual({
      css: '.l { k: calc(1px + 1em); }',
      warnings: ['eval/unexpressible-unit'],
      errors: []
    });
  });

  it('a .less file uses the .less default beside a .jess file that errors on the same math', async () => {
    write(['both.less', '.e { k: 1px + 1em; }\n@import \'part.less\';']);
    expect(await render('both.less')).toEqual({
      css: '.e { k: calc(1px + 1em); } .l { k: calc(1px + 1em); }',
      warnings: ['eval/unexpressible-unit', 'eval/unexpressible-unit'],
      errors: []
    });
  });
});

describe('a global setting wins over every file\'s own settings', () => {
  beforeEach(() => {
    write(PART_JESS, PART_LESS, LESS_IMPORTS_JESS, JESS_IMPORTS_LESS);
  });

  it('a compiler unitMode applies to both languages', async () => {
    const compile = { compile: { unitMode: 'loose' as const } };
    expect((await render('less-entry.less', compile)).css).toBe('.j { k: 4px; }');
    expect((await render('jess-entry.jess', compile)).css).toBe('.l { k: 2px; }');
  });

  it('a render unitMode applies to both languages', async () => {
    expect(await render('less-entry.less', {}, { compile: { unitMode: 'preserve' } })).toEqual({
      css: '.j { k: calc(1px + 3em); }',
      warnings: ['eval/unexpressible-unit'],
      errors: []
    });
    expect((await render('jess-entry.jess', {}, { compile: { unitMode: 'strict' } })).errors)
      .toEqual(['eval/invalid-unit-arithmetic']);
  });

  it('a global setting wins over a language setting', async () => {
    expect((await render('less-entry.less', {
      compile: { unitMode: 'loose' },
      language: { jess: { unitMode: 'strict' } }
    })).css).toBe('.j { k: 4px; }');
  });

  it('a global setting wins over a folder\'s styles.config', async () => {
    write(['styles.config.cjs', 'module.exports = { compile: { unitMode: \'strict\' }, language: { less: { unitMode: \'strict\' } } };\n']);
    expect((await render('jess-entry.jess', { compile: { unitMode: 'loose' } })).css).toBe('.l { k: 2px; }');
  });
});

describe('a language setting applies only to that language\'s files', () => {
  beforeEach(() => {
    write(
      PART_JESS,
      PART_LESS,
      ['less-entry.less', '.e { k: 1px + 1em; }\n@import \'part.jess\';'],
      ['jess-entry.jess', '.e { k: $(1px + 3em); }\n@-import \'./part.less\';']
    );
  });

  it('language.less reaches an imported .less file and not the .jess file that imports it', async () => {
    const options = { language: { less: { unitMode: 'loose' as const } } };
    expect((await render('jess-entry.jess', options)).errors).toEqual(['eval/invalid-unit-arithmetic']);
    write(JESS_IMPORTS_LESS);
    expect((await render('jess-entry.jess', options)).css).toBe('.l { k: 2px; }');
  });

  it('language.jess reaches an imported .jess file and not the .less file that imports it', async () => {
    expect(await render('less-entry.less', { language: { jess: { unitMode: 'loose' } } })).toEqual({
      css: '.e { k: calc(1px + 1em); } .j { k: 4px; }',
      warnings: ['eval/unexpressible-unit'],
      errors: []
    });
  });

  it('a language setting in a styles.config applies only to that language\'s files', async () => {
    write(['styles.config.cjs', 'module.exports = { language: { jess: { unitMode: \'preserve\' } } };\n']);
    expect(await render('less-entry.less')).toEqual({
      css: '.e { k: calc(1px + 1em); } .j { k: calc(1px + 3em); }',
      warnings: ['eval/unexpressible-unit', 'eval/unexpressible-unit'],
      errors: []
    });

    /* A config file is loaded once per directory, so the second case gets its own. */
    write(
      ['other/styles.config.cjs', 'module.exports = { language: { less: { unitMode: \'loose\' } } };\n'],
      ['other/part.less', '.l { k: 1px + 1em; }'],
      ['other/jess-entry.jess', '@-import \'./part.less\';']
    );
    expect((await render('other/jess-entry.jess')).css).toBe('.l { k: 2px; }');
  });
});

describe('a folder\'s styles.config applies only to the files in that folder', () => {
  it('a config in an imported file\'s folder applies to that file, not to the file importing it', async () => {
    write(
      ['entry.less', '.e { k: 1px + 1em; }\n@import \'sub/part.less\';'],
      ['sub/part.less', '.p { k: 1px + 1em; }'],
      ['sub/styles.config.cjs', 'module.exports = { compile: { unitMode: \'loose\' } };\n']
    );
    expect(await render('entry.less')).toEqual({
      css: '.e { k: calc(1px + 1em); } .p { k: 2px; }',
      warnings: ['eval/unexpressible-unit'],
      errors: []
    });
  });

  it('the entry folder\'s config does not reach an imported file outside that folder', async () => {
    write(
      ['app/entry.less', '.e { k: 1px + 1em; }\n@import \'../shared/part.less\';'],
      ['app/styles.config.cjs', 'module.exports = { language: { less: { unitMode: \'loose\' } } };\n'],
      ['shared/part.less', '.p { k: 1px + 1em; }']
    );
    expect(await render('app/entry.less')).toEqual({
      css: '.e { k: 2px; } .p { k: calc(1px + 1em); }',
      warnings: ['eval/unexpressible-unit'],
      errors: []
    });
  });

  it('an explicit language setting wins over the imported file\'s folder config', async () => {
    write(
      ['entry.less', '@import \'sub/part.less\';'],
      ['sub/part.less', '.p { k: 1px + 1em; }'],
      ['sub/styles.config.cjs', 'module.exports = { language: { less: { unitMode: \'loose\' } } };\n']
    );
    expect((await render('entry.less', { language: { less: { unitMode: 'strict' } } })).errors)
      .toEqual(['eval/invalid-unit-arithmetic']);
  });
});
