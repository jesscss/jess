/*
 * Which compile settings a source file uses (DESIGN-DECISIONS C19, owner
 * 2026-10-07): the settings that cover a file are its nearest `styles.config`
 * (found by walking up from the file's folder to its package root) merged under
 * the settings passed to the compiler or the render, which win field by field.
 * On that merge, each file's settings are computed for its language: its
 * language's defaults, under the `compile` settings, under `language.<lang>`.
 * With nothing set, each file uses its own language's defaults, so its output
 * never depends on the file that imported it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';
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

/** Render, collecting what the plugins log as warnings (deprecated spellings). */
async function renderLogged(entry: string, compilerOptions: ConfigOptions = {}) {
  const warn = logger.warn;
  const logged: string[] = [];
  logger.warn = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  };
  try {
    return { ...await render(entry, compilerOptions), logged };
  } finally {
    logger.warn = warn;
  }
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

describe('a global setting applies to every language', () => {
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

  it('a language setting wins over a global setting', async () => {
    expect((await render('less-entry.less', {
      compile: { unitMode: 'loose' },
      language: { jess: { unitMode: 'strict' } }
    })).errors).toEqual(['eval/invalid-unit-arithmetic']);
  });

  it('a global setting passed in wins over the same setting in a styles.config', async () => {
    write(['styles.config.cjs', 'module.exports = { compile: { unitMode: \'strict\' } };\n']);
    expect((await render('jess-entry.jess', { compile: { unitMode: 'loose' } })).css).toBe('.l { k: 2px; }');
  });

  it('a styles.config language setting wins over a global setting passed in', async () => {
    write(['styles.config.cjs', 'module.exports = { language: { less: { unitMode: \'strict\' } } };\n']);
    expect((await render('jess-entry.jess', { compile: { unitMode: 'loose' } })).errors)
      .toEqual(['eval/invalid-unit-arithmetic']);
    expect((await render('less-entry.less', {}, { compile: { unitMode: 'loose' } })).css).toBe('.j { k: 4px; }');
  });

  it('a styles.config language math setting wins over a global math setting passed in', async () => {
    write(
      ['styles.config.cjs', 'module.exports = { language: { less: { mathMode: \'parens\' } } };\n'],
      ['div.less', '.d { k: 4px / 2; }']
    );
    expect((await render('div.less', { compile: { mathMode: 'always' } })).css).toBe('.d { k: 4px / 2; }');
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

  it('the config in an installed package\'s folder is not loaded', async () => {
    write(
      ['entry.less', '@import \'node_modules/pkg/part.less\';'],
      ['node_modules/pkg/part.less', '.p { k: 1px + 1em; }'],
      ['node_modules/pkg/styles.config.cjs', 'module.exports = { compile: { unitMode: \'loose\' } };\n']
    );
    expect((await render('entry.less')).css).toBe('.p { k: calc(1px + 1em); }');
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

describe('math follows the settings of the file it is written in', () => {
  const LOOSE_SUB = ['sub/styles.config.cjs', 'module.exports = { compile: { unitMode: \'loose\' } };\n'] as const;

  it('a .jess variable read from a .less file keeps the .jess default', async () => {
    write(['part.jess', '$w: $(1px + 3em);'], ['entry.less', '@import \'part.jess\';\n.e { k: @w; }']);
    expect((await render('entry.less')).errors).toEqual(['eval/invalid-unit-arithmetic']);
  });

  it('a .less variable read from a .jess file keeps the .less default', async () => {
    write(['part.less', '@w: 1px + 1em;'], ['entry.jess', '@-import \'./part.less\';\n.j { k: $w; }']);
    expect(await render('entry.jess')).toEqual({
      css: '.j { k: calc(1px + 1em); }',
      warnings: ['eval/unexpressible-unit'],
      errors: []
    });
  });

  it('a variable keeps its own folder\'s settings wherever it is read', async () => {
    write(LOOSE_SUB, ['sub/vars.less', '@x: 1px + 1em;'], ['entry.less', '@import \'sub/vars.less\';\n.e { k: @x; }']);
    expect((await render('entry.less')).css).toBe('.e { k: 2px; }');
    write(
      ['entry.less', '@w: 1px + 1em;\n@import \'sub/part.less\';'],
      ['sub/part.less', '.p { k: @w; }']
    );
    expect((await render('entry.less')).css).toBe('.p { k: calc(1px + 1em); }');
  });

  it('a mixin written in the entry keeps the entry\'s settings when another folder calls it', async () => {
    write(
      LOOSE_SUB,
      ['entry.less', '.m() { k: 1px + 1em; }\n@import \'sub/part.less\';'],
      ['sub/part.less', '.p { .m(); }']
    );
    expect((await render('entry.less')).css).toBe('.p { k: calc(1px + 1em); }');
  });

  it('a mixin written in a folder with its own config keeps it when another folder calls it', async () => {
    write(
      ['app/styles.config.cjs', 'module.exports = { language: { less: { unitMode: \'loose\' } } };\n'],
      ['app/entry.less', '.m() { k: 1px + 1em; }\n@import \'../shared/part.less\';'],
      ['shared/part.less', '.p { .m(); }']
    );
    expect((await render('app/entry.less')).css).toBe('.p { k: 2px; }');
  });

  it('a namespaced or nested mixin keeps the settings of the file that defines it', async () => {
    write(
      LOOSE_SUB,
      ['sub/part.less', '#ns { .m() { k: 1px + 1em; } }\n.wrap { .n() { k: 1px + 1em; } }'],
      ['entry.less', '@import \'sub/part.less\';\n.e { #ns.m(); }\n.f { .wrap > .n(); }']
    );
    expect((await render('entry.less')).css).toBe('.e { k: 2px; } .f { k: 2px; }');
  });

  it('a namespace member, a mixin result and a detached ruleset keep the settings of their file', async () => {
    write(
      LOOSE_SUB,
      ['sub/part.less', '#ns { @x: 1px + 1em; }\n.m() { @r: 1px + 1em; }\n@d: { k: 1px + 1em; }\n@map: { k: 1px + 1em; }\n'],
      ['entry.less', '@import \'sub/part.less\';\n.e { k: #ns[@x]; }\n.f { k: .m()[@r]; }\n.g { @d(); }\n.h { k: @map[k]; }']
    );
    expect((await render('entry.less')).css).toBe('.e { k: 2px; } .f { k: 2px; } .g { k: 2px; } .h { k: 2px; }');
  });

  it('a guard keeps the settings of the file that defines it', async () => {
    write(
      ['sub/styles.config.cjs', 'module.exports = { compile: { unitMode: \'strict\' } };\n'],
      ['sub/part.less', '.g(@a) when (@a > 1em) { k: big; }\n.g(@a) when (default()) { k: small; }'],
      ['entry.less', '@import \'sub/part.less\';\n.e { .g(1px); }']
    );
    expect((await render('entry.less')).errors).toEqual(['eval/invalid-unit-arithmetic']);
  });

  it('a .less file imported by a .jess file keeps the Less built-in functions', async () => {
    write(['part.less', '.l { a: percentage(0.5); }'], ['entry.jess', '@-import \'./part.less\';']);
    expect((await render('entry.jess')).css).toBe('.l { a: 50%; }');
  });

  it('a .jess file imported by a .less file has no Less built-in functions', async () => {
    write(['part.jess', '.j { a: percentage(0.5); }'], ['entry.less', '@import \'part.jess\';']);
    expect((await render('entry.less')).css).toBe('.j { a: percentage(0.5); }');
  });
});

describe('the settings a Less plugin is built with', () => {
  beforeEach(() => {
    write(['entry.less', '.e { k: 1px + 1em; }']);
  });

  it('apply to the Less files', async () => {
    expect((await render('entry.less', { compile: { plugins: [lessPlugin({ unitMode: 'loose' })] } })).css)
      .toBe('.e { k: 2px; }');
    expect((await render('entry.less', { compile: { plugins: [lessPlugin({ unitMode: 'strict' })] } })).errors)
      .toEqual(['eval/invalid-unit-arithmetic']);
  });

  it('lose to a language setting', async () => {
    expect((await render('entry.less', {
      compile: { plugins: [lessPlugin({ unitMode: 'strict' })] },
      language: { less: { unitMode: 'loose' } }
    })).css).toBe('.e { k: 2px; }');
  });
});

describe('a deprecated spelling keeps the place of the setting it is written in', () => {
  beforeEach(() => {
    write(['entry.less', '@import \'sub/part.less\';'], ['sub/part.less', '.p { k: 1px + 1em; }']);
  });

  it('an explicit language.less strictUnits wins over a folder\'s compile unitMode', async () => {
    write(['sub/styles.config.cjs', 'module.exports = { compile: { unitMode: \'loose\' } };\n']);
    expect((await render('entry.less', { language: { less: { strictUnits: true } } })).errors)
      .toEqual(['eval/invalid-unit-arithmetic']);
  });

  it('a language.less strictUnits wins over the compile unitMode of the same config', async () => {
    write(['sub/styles.config.cjs', 'module.exports = { compile: { unitMode: \'loose\' }, language: { less: { strictUnits: true } } };\n']);
    expect((await render('entry.less')).errors).toEqual(['eval/invalid-unit-arithmetic']);
  });

  it('an explicit language.less math wins over a folder\'s compile mathMode', async () => {
    write(
      ['sub/styles.config.cjs', 'module.exports = { compile: { mathMode: \'parens\' } };\n'],
      ['sub/part.less', '.p { k: 4px / 2; }']
    );
    expect((await render('entry.less', { language: { less: { math: 'always' } } })).css).toBe('.p { k: 2px; }');
  });
});

describe('a folder\'s config is read like the entry\'s', () => {
  beforeEach(() => {
    write(['entry.less', '@import \'sub/part.less\';'], ['sub/part.less', '.p { k: 1px + 1em; }']);
  });

  it('a deprecated spelling there warns', async () => {
    write(['sub/styles.config.cjs', 'module.exports = { language: { less: { strictUnits: true } } };\n']);
    const result = await renderLogged('entry.less');
    expect(result.errors).toEqual(['eval/invalid-unit-arithmetic']);
    expect(result.logged).toEqual(['strictUnits is deprecated; use unitMode. strictUnits: true now means unitMode: \'strict\'']);
  });

  it('an invalid value there names that config file', async () => {
    write(['sub/styles.config.cjs', 'module.exports = { language: { less: { unitMode: \'bogus\' } } };\n']);
    const result = await new Compiler({ quiet: true }).renderToResult(path.join(dir, 'entry.less'), { quiet: true });
    expect(result.errors.map(e => [e.code, e.filePath])).toEqual([
      ['plugin/invalid-option', path.join(dir, 'sub/styles.config.cjs')]
    ]);
  });
});

describe('a language setting other than a mode applies only to its own files', () => {
  it('the entry\'s language.less allowExtendSelectors does not reach an imported .jess file', async () => {
    write(
      ['styles.config.cjs', 'module.exports = { language: { less: { allowExtendSelectors: [] } } };\n'],
      ['part.jess', '.target { a: b; } .source { $extend .target; }'],
      ['entry.less', '@import \'part.jess\';']
    );
    expect((await render('entry.less')).css).toBe('.target, .source { a: b; }');
  });
});

describe('the strict preset', () => {
  beforeEach(() => {
    write(['entry.less', '.e { k: 1px + 1em; }']);
  });

  it('fills only what an explicit setting leaves unset, a language setting included', async () => {
    expect((await render('entry.less', { compile: { strict: true }, language: { less: { unitMode: 'loose' } } })).css)
      .toBe('.e { k: 2px; }');
  });

  it('passed in, fills only what a styles.config leaves unset', async () => {
    write(['styles.config.cjs', 'module.exports = { language: { less: { unitMode: \'loose\' } } };\n']);
    expect((await render('entry.less', {}, { compile: { strict: true } })).css).toBe('.e { k: 2px; }');
  });

  it('in a language setting, wins over a global setting for that language\'s files only', async () => {
    write(['part.jess', '.j { k: $(1px + 3em); }']);
    const options = { compile: { unitMode: 'loose' as const }, language: { less: { strict: true } } };
    expect((await render('entry.less', options)).errors).toEqual(['eval/invalid-unit-arithmetic']);
    expect((await render('part.jess', options)).css).toBe('.j { k: 4px; }');
  });

  it('in a language setting, fills only what that language\'s settings leave unset', async () => {
    expect((await render('entry.less', { language: { less: { strict: true, unitMode: 'loose' } } })).css)
      .toBe('.e { k: 2px; }');
  });

  it('turned off in a language setting, does not reach that language\'s files from a global setting', async () => {
    expect(await render('entry.less', { compile: { strict: true }, language: { less: { strict: false } } })).toEqual({
      css: '.e { k: calc(1px + 1em); }',
      warnings: ['eval/unexpressible-unit'],
      errors: []
    });
  });
});

describe('the styles.config that covers a file is the nearest one above it, within its package', () => {
  it('a config in a parent folder covers the files below it, imported files included', async () => {
    write(
      ['styles.config.cjs', 'module.exports = { language: { less: { unitMode: \'loose\' } } };\n'],
      ['app/entry.less', '.e { k: 1px + 1em; }\n@import \'../shared/deep/part.less\';'],
      ['shared/deep/part.less', '.p { k: 1px + 1em; }']
    );
    expect((await render('app/entry.less')).css).toBe('.e { k: 2px; } .p { k: 2px; }');
  });

  it('the nearest config covers a file, not the configs above it', async () => {
    write(
      ['styles.config.cjs', 'module.exports = { language: { less: { unitMode: \'loose\' } } };\n'],
      ['sub/styles.config.cjs', 'module.exports = { language: { less: { mathMode: \'always\' } } };\n'],
      ['sub/entry.less', '.e { k: 1px + 1em; }']
    );
    expect((await render('sub/entry.less')).css).toBe('.e { k: calc(1px + 1em); }');
  });

  it('the search stops at the folder with the package.json', async () => {
    write(
      ['styles.config.cjs', 'module.exports = { language: { less: { unitMode: \'loose\' } } };\n'],
      ['pkg/package.json', '{}'],
      ['pkg/src/entry.less', '.e { k: 1px + 1em; }'],
      ['configured/package.json', '{}'],
      ['configured/styles.config.cjs', 'module.exports = { language: { less: { unitMode: \'strict\' } } };\n'],
      ['configured/src/entry.less', '.e { k: 1px + 1em; }']
    );
    expect((await render('pkg/src/entry.less')).css).toBe('.e { k: calc(1px + 1em); }');
    expect((await render('configured/src/entry.less')).errors).toEqual(['eval/invalid-unit-arithmetic']);
  });
});
