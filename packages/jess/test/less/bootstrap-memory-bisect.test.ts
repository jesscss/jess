import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import jsPlugin from '@jesscss/plugin-js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const root = resolve(
  __dirname,
  '../../../../node_modules/.pnpm/bootstrap-less-port@2.5.1_less@3.13.1/node_modules/bootstrap-less-port/less'
);
const imports = [
  '_functions', '_variables', '_mixins', '_root', '_reboot', '_type', '_images',
  '_code', '_grid', '_tables', '_forms', '_buttons', '_transitions', '_dropdown',
  '_button-group', '_input-group', '_custom-forms', '_nav', '_navbar', '_card',
  '_breadcrumb', '_pagination', '_badge', '_jumbotron', '_alert', '_progress',
  '_media', '_list-group', '_close', '_toasts', '_modal', '_tooltip', '_popover',
  '_carousel', '_spinners', '_utilities', '_print'
];

describe('bootstrap execution-memory bisect', () => {
  it('renders the requested ordered import prefix', async () => {
    if (process.env.BOOTSTRAP_REBOOT_CASE) {
      return;
    }
    const count = Number(process.env.BOOTSTRAP_IMPORT_COUNT ?? imports.length);
    const dir = mkdtempSync(join(tmpdir(), 'jess-bootstrap-bisect-'));
    const entry = join(dir, 'entry.less');
    writeFileSync(entry, imports.slice(0, count)
      .map(specifier => `@import "${join(root, specifier).replaceAll('\\', '/')}";`)
      .join('\n'));
    const before = process.memoryUsage();
    const css = await new Compiler({
      compile: { plugins: [lessPlugin(), jsPlugin({ jsReadRoot: root, runtimeApi: 'less' }), lessCompatPlugin()] }
    }).render(entry, { suppressWarnings: true, breakOnError: false });
    const after = process.memoryUsage();
    console.log(JSON.stringify({
      count,
      last: imports[count - 1] ?? null,
      cssBytes: css.length,
      heapDelta: after.heapUsed - before.heapUsed,
      rssDelta: after.rss - before.rss
    }));
    expect(css).toBeTypeOf('string');
  }, 120000);

  it('renders one bounded reboot construct after the three prerequisite imports', async () => {
    const rebootCase = process.env.BOOTSTRAP_REBOOT_CASE;
    if (!rebootCase) {
      return;
    }
    const cases: Record<string, string> = {
      plain: 'body { color: @body-color; }',
      'font-size': 'body { #font-size(@font-size-base); }',
      hover: 'a { #hover({ color: @link-hover-color; }); }'
    };
    const prefix = /^(?:imported-)?prefix-(\d+)$/.exec(rebootCase);
    const navbarPrefix = /^navbar-prefix-(\d+)$/.exec(rebootCase);
    const navbarDarkFirst = rebootCase === 'navbar-dark-first';
    const navbarDarkText = rebootCase === 'navbar-dark-text';
    const isImportedReboot = rebootCase === 'imported-reboot'
      || rebootCase.startsWith('imported-prefix-')
      || rebootCase === 'imported-hover'
      || rebootCase === 'imported-font-size'
      || rebootCase === 'imported-font-size-triple'
      || navbarPrefix !== null
      || navbarDarkFirst
      || navbarDarkText;
    const body = isImportedReboot
      ? undefined
      : prefix
        ? readFileSync(join(root, '_reboot.less'), 'utf8').split('\n').slice(0, Number(prefix[1])).join('\n')
        : cases[rebootCase];
    expect(body ?? isImportedReboot, `unknown BOOTSTRAP_REBOOT_CASE ${rebootCase}`).toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), 'jess-bootstrap-reboot-case-'));
    const entry = join(dir, 'entry.less');
    const importedReboot = join(dir, 'reboot.less');
    const importedCopies = Number(process.env.BOOTSTRAP_REBOOT_COPIES ?? 1);
    let importedSource: string | undefined;
    if (isImportedReboot) {
      const reboot = readFileSync(join(root, navbarPrefix || navbarDarkFirst || navbarDarkText ? '_navbar.less' : '_reboot.less'), 'utf8');
      importedSource = rebootCase === 'imported-hover'
        ? 'a { #hover({ color: @link-hover-color; }); }'
        : rebootCase === 'imported-font-size'
          ? 'small { #font-size(80%); }'
          : rebootCase === 'imported-font-size-triple'
            ? 'body { #font-size(@font-size-base); } small { #font-size(80%); } sub, sup { #font-size(75%); }'
            : navbarDarkFirst
              ? '.navbar-dark { .navbar-brand { color: @navbar-dark-brand-color; #hover-focus({ color: @navbar-dark-brand-hover-color; }); } }'
              : navbarDarkText
                ? '.navbar-dark { .navbar-text { color: @navbar-dark-color; a { color: @navbar-dark-active-color; #hover-focus({ color: @navbar-dark-active-color; }); } } }'
                : (prefix ?? navbarPrefix) ? reboot.split('\n').slice(0, Number((prefix ?? navbarPrefix)![1])).join('\n') : reboot;
      for (let index = 0; index < importedCopies; index++) {
        writeFileSync(index === 0 ? importedReboot : join(dir, `reboot-${index}.less`), importedSource);
      }
    }
    writeFileSync(entry, [
      ...imports.slice(0, navbarPrefix || navbarDarkFirst || navbarDarkText ? 18 : process.env.BOOTSTRAP_REBOOT_WITH_ROOT ? 4 : 3)
        .map(specifier => `@import "${join(root, specifier).replaceAll('\\', '/')}";`),
      isImportedReboot
        ? Array.from({ length: importedCopies }, (_, index) => `@import "${(index === 0 ? importedReboot : join(dir, `reboot-${index}.less`)).replaceAll('\\', '/')}";`).join('\n')
        : body
    ].join('\n'));
    const before = process.memoryUsage();
    const css = await new Compiler({
      compile: { plugins: [lessPlugin(), jsPlugin({ jsReadRoot: root, runtimeApi: 'less' }), lessCompatPlugin()] }
    }).render(entry, { suppressWarnings: true, breakOnError: false });
    const after = process.memoryUsage();
    console.log(JSON.stringify({
      rebootCase,
      cssBytes: css.length,
      heapDelta: after.heapUsed - before.heapUsed,
      rssDelta: after.rss - before.rss
    }));
    expect(css).toBeTypeOf('string');
  }, 120000);
});
