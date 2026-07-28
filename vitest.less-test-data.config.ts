import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { defineConfig } from 'vitest/config';
import parseman from 'parseman/plugin';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const packagesRoot = path.join(repoRoot, 'packages');
const sharedNodeModules = fs.realpathSync(path.join(repoRoot, 'node_modules'));
const sharedRepoRoot = path.dirname(sharedNodeModules);
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);
const excludedExternalAliases = [
  'vitest',
  'vite',
  '@vitest/',
  '@vitejs/',
  'typescript',
  'eslint',
  'tsdown',
  'cross-env',
  '@types/'
];

type PackageJson = {
  name?: unknown;
  main?: unknown;
  exports?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
};

type PackageMeta = {
  relativeDir: string;
  packageDir: string;
  packageJsonPath: string;
  pkg: PackageJson;
};

function readJson(filePath: string): PackageJson {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackageJson;
}

function objectKeys(value: unknown): string[] {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
    : [];
}

function collectWorkspacePackages(dir: string, relativeDir = ''): PackageMeta[] {
  const packageJsonPath = path.join(dir, 'package.json');
  const found: PackageMeta[] = fs.existsSync(packageJsonPath)
    ? [{
        relativeDir,
        packageDir: dir,
        packageJsonPath,
        pkg: readJson(packageJsonPath)
      }]
    : [];

  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name === 'node_modules' || dirent.name.startsWith('.')) {
      continue;
    }
    found.push(...collectWorkspacePackages(
      path.join(dir, dirent.name),
      path.join(relativeDir, dirent.name)
    ));
  }

  return found;
}

const workspacePackageMetas = collectWorkspacePackages(packagesRoot);
const workspacePackageByName = new Map(
  workspacePackageMetas
    .map(meta => (typeof meta.pkg.name === 'string' ? [meta.pkg.name, meta] as const : null))
    .filter((value): value is readonly [string, PackageMeta] => Boolean(value))
);

function builtPackageEntry(packageName: string, subpath = 'index.js'): string {
  const meta = workspacePackageByName.get(packageName);
  if (!meta) {
    throw new Error(`Unable to find workspace package ${packageName}`);
  }
  return path.join(meta.packageDir, 'lib', subpath);
}

function createWorkspaceSourceAliases() {
  const aliases: Array<{ find: string; replacement: string }> = [];
  const workspaceNames = new Set<string>(workspacePackageMetas
    .map(({ pkg }) => (typeof pkg.name === 'string' ? pkg.name : null))
    .filter((value): value is string => Boolean(value)));

  for (const { relativeDir, packageDir, pkg } of workspacePackageMetas) {
    const packageName = typeof pkg.name === 'string' ? pkg.name : null;
    if (!packageName) {
      continue;
    }

    const exportsField = pkg.exports;
    if (exportsField && typeof exportsField === 'object') {
      for (const [subpath, target] of Object.entries(exportsField)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        if (!target || typeof target !== 'object' || typeof (target as { source?: unknown }).source !== 'string') {
          continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const aliasPath = path.resolve(packageDir, (target as { source: string }).source);
        const aliasName = subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`;
        aliases.push({
          find: aliasName,
          replacement: aliasPath
        });
      }
    } else if (typeof pkg.main === 'string') {
      aliases.push({
        find: packageName,
        replacement: path.resolve(packageDir, pkg.main)
      });
    }

    const sharedPackageDir = path.join(sharedRepoRoot, 'packages', relativeDir);
    const dependencyNames = new Set<string>([
      ...objectKeys(pkg.dependencies),
      ...objectKeys(pkg.devDependencies),
      ...objectKeys(pkg.peerDependencies)
    ]);

    for (const dependencyName of dependencyNames) {
      if (
        workspaceNames.has(dependencyName)
        || builtins.has(dependencyName)
        || excludedExternalAliases.some(prefix => dependencyName === prefix || dependencyName.startsWith(prefix))
      ) {
        continue;
      }

      const packageLocalPath = path.join(sharedPackageDir, 'node_modules', dependencyName);
      if (fs.existsSync(packageLocalPath)) {
        aliases.push({
          find: dependencyName,
          replacement: packageLocalPath
        });
        continue;
      }

      const hoistedPath = path.join(sharedNodeModules, dependencyName);
      if (fs.existsSync(hoistedPath)) {
        aliases.push({
          find: dependencyName,
          replacement: hoistedPath
        });
      }
    }
  }

  const deduped = new Map<string, string>();
  for (const alias of aliases.sort((a, b) => b.find.length - a.find.length)) {
    if (!deduped.has(alias.find)) {
      deduped.set(alias.find, alias.replacement);
    }
  }

  return [...deduped.entries()].map(([find, replacement]) => ({ find, replacement }));
}

export default defineConfig({
  /*
   * This integration config deliberately aliases most workspace packages to
   * source. Parseman grammar source is therefore valid only when the same macro
   * transform used by the normal Vitest config is active.
   */
  plugins: [parseman.vite()],
  resolve: {
    /*
     * Parseman grammars are macro-compiled package output. The Less integration
     * suite exercises the public Jess route, so it must load the built public
     * parser rather than aliasing its macro source into Vite at runtime.
     */
    alias: [
      { find: '@jesscss/less-parser/grammar', replacement: builtPackageEntry('@jesscss/less-parser', 'grammar.js') },
      { find: '@jesscss/less-parser', replacement: builtPackageEntry('@jesscss/less-parser') },

      /*
       * Compiler imports the built-in Jess plugin even for a Less document. Its
       * parser is macro-compiled too, so this integration route must not alias
       * either package back to TypeScript source inside Vite.
       */
      { find: '@jesscss/plugin-jess', replacement: builtPackageEntry('@jesscss/plugin-jess') },
      { find: '@jesscss/jess-parser', replacement: builtPackageEntry('@jesscss/jess-parser') },
      ...createWorkspaceSourceAliases().filter(alias =>
        alias.find !== '@jesscss/less-parser'
        && alias.find !== '@jesscss/plugin-jess'
        && alias.find !== '@jesscss/jess-parser')
    ],
    mainFields: ['source', 'import', 'module', 'exports', 'main']
  },
  test: {
    watch: false,
    globals: true,
    environment: 'node',
    env: {
      TEST: 'true'
    },
    include: ['packages/jess/test/less/**/*.test.ts'],
    setupFiles: [path.join(repoRoot, 'test/setup.ts')],
    testTimeout: 30_000,
    reporters: [['tree', { summary: true }]]
  }
});
