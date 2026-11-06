/**
 * The harness plugins `compare-less-builds.mjs --corpus` renders with: plain-JS
 * mirrors of `packages/jess/test/harness-plugins.ts`, since the script runs on
 * built libs without a TS loader. Each factory records itself on what it makes
 * (`pluginModule`, as `recordPluginModule` from @jesscss/core does; written out
 * here so an older build without that helper runs the same harness), so a
 * render that runs whole in the `@jesscss/plugin-js` sandbox makes the same
 * plugin there from this module. If the suite's harness changes, a fixture may
 * render differently here, which changes coverage but never the before/after
 * comparison.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const record = (plugin, exportName, args) => Object.defineProperty(plugin, 'pluginModule', {
  value: { module: import.meta.url, exportName, args },
  configurable: true
});

function readNumericArg(value) {
  if (typeof value?.value === 'number') {
    return value.value;
  }
  if (typeof value?.value?.number === 'number') {
    return value.value.number;
  }
  return Number(value?.valueOf?.() ?? value);
}

function readStringArg(value) {
  const raw = typeof value?.value === 'string'
    ? value.value
    : typeof value?.value?.value === 'string' ? value.value.value : String(value?.valueOf?.() ?? value);
  return raw.replace(/^(['"])(.*)\1$/, '$2');
}

export const harnessFunctionsPlugin = () => record({
  install(less) {
    less.functions.functionRegistry.addMultiple({
      add: (a, b) => readNumericArg(a) + readNumericArg(b),
      increment: a => readNumericArg(a) + 1,
      _color: str => (readStringArg(str) === 'evil red' ? '#660000' : undefined)
    });
  }
}, 'harnessFunctionsPlugin', []);

const pinnedPackages = (repoRoot) => {
  const depsRoot = path.join(repoRoot, 'packages/less-corpus-fixture-deps');
  const depsRequire = createRequire(path.join(depsRoot, '__jess_fixture_resolve__.js'));
  const { dependencies = {} } = JSON.parse(fs.readFileSync(path.join(depsRoot, 'package.json'), 'utf8'));
  return Object.keys(dependencies).map(name => [name, path.dirname(depsRequire.resolve(`${name}/package.json`))]);
};

export function fixturePackagesPlugin(repoRoot, pinned = pinnedPackages(repoRoot)) {
  return record({
    name: 'less-corpus-fixture-packages',
    resolve(filePath) {
      return (Array.isArray(filePath) ? filePath : [filePath]).map((candidate) => {
        for (const [name, dir] of pinned) {
          const marker = `${path.sep}${name}${path.sep}`;
          const at = candidate.lastIndexOf(marker);
          if (at !== -1) {
            return path.join(dir, candidate.slice(at + marker.length));
          }
          if (candidate.startsWith(`${name}/`)) {
            return path.join(dir, candidate.slice(name.length + 1));
          }
        }
        return candidate;
      });
    }
  }, 'fixturePackagesPlugin', [repoRoot, pinned]);
}

/** The remote-import plugin of the build at `buildRoot`, its transport answering from the local test-data checkout. */
export async function testDataRemoteImports(buildRoot, testDataRoot) {
  const { remoteImportPlugin } = await import(pathToFileURL(path.join(buildRoot, 'packages/jess-plugin-remote-import/lib/index.js')).href);
  const published = '/npm/@less/test-data/';
  return record(remoteImportPlugin({
    allow: ['cdn.jsdelivr.net'],
    fetch: async (url) => {
      const { pathname } = new URL(url);
      const file = pathname.startsWith(published) ? path.join(testDataRoot, pathname.slice(published.length)) : undefined;
      return file !== undefined && fs.existsSync(file)
        ? new Response(fs.readFileSync(file, 'utf8'))
        : new Response('not found', { status: 404 });
    }
  }), 'testDataRemoteImports', [buildRoot, testDataRoot]);
}

/** The nearest folder holding both the corpus checkout and this repository, which installs its fixture packages. */
export function corpusReadRoot(testDataRoot, repoRoot) {
  let dir = fs.realpathSync(testDataRoot);
  const repo = fs.realpathSync(repoRoot);
  while (path.relative(dir, repo).startsWith('..')) {
    dir = path.dirname(dir);
  }
  return dir;
}
