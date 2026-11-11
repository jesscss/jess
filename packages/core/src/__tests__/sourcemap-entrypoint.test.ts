import { spawnSync } from 'node:child_process';
import module from 'node:module';
import { fileURLToPath } from 'node:url';

/*
 * Source-map generation is its own entry: importing the root entry does not
 * load `@jridgewell/gen-mapping`, and `@jesscss/core/sourcemap` does. Run in a
 * fresh process against the built package, where a load hook sees every module.
 */
const lib = (entry: string) => fileURLToPath(new URL(`../../lib/${entry}.js`, import.meta.url));

const loadsGenMapping = (entry: string): boolean => {
  const script = `
    import module from 'node:module';
    const urls = [];
    module.registerHooks({ load(url, context, next) { urls.push(url); return next(url, context); } });
    await import(${JSON.stringify(lib(entry))});
    console.log(urls.some(url => url.includes('@jridgewell/gen-mapping')));
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-'], { input: script, encoding: 'utf8' });
  expect(run.stderr).toBe('');
  return run.stdout.trim() === 'true';
};

/* `module.registerHooks` arrived in Node 22.15, after the Node types this package builds against. */
const hasLoadHooks = typeof Reflect.get(module, 'registerHooks') === 'function';

describe('@jesscss/core/sourcemap', () => {
  it.runIf(hasLoadHooks)('is the only entry that loads the source-map library', () => {
    expect(loadsGenMapping('index')).toBe(false);
    expect(loadsGenMapping('sourcemap')).toBe(true);
  });
});
