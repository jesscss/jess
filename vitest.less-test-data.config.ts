import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const packagesRoot = path.join(repoRoot, 'packages');
const sharedNodeModules = fs.realpathSync(path.join(repoRoot, 'node_modules'));
const sharedRepoRoot = path.dirname(sharedNodeModules);
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
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

function readJson(filePath: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, any>;
}

function createWorkspaceSourceAliases() {
  const aliases: Array<{ find: string; replacement: string }> = [];
  const packageDirs = fs.readdirSync(packagesRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => ({
      dirName: dirent.name,
      packageDir: path.join(packagesRoot, dirent.name),
      packageJsonPath: path.join(packagesRoot, dirent.name, 'package.json')
    }))
    .filter((entry) => fs.existsSync(entry.packageJsonPath));
  const packageMetas = packageDirs.map((entry) => ({
    ...entry,
    pkg: readJson(entry.packageJsonPath)
  }));
  const workspaceNames = new Set<string>(
    packageMetas
      .map(({ pkg }) => (typeof pkg.name === 'string' ? pkg.name : null))
      .filter((value): value is string => Boolean(value))
  );

  for (const { dirName, packageDir, pkg } of packageMetas) {
    const packageName = typeof pkg.name === 'string' ? pkg.name : null;
    if (!packageName) {
      continue;
    }

    const exportsField = pkg.exports;
    if (exportsField && typeof exportsField === 'object') {
      for (const [subpath, target] of Object.entries(exportsField)) {
        if (!target || typeof target !== 'object' || typeof (target as Record<string, unknown>).source !== 'string') {
          continue;
        }

        const aliasPath = path.resolve(packageDir, (target as Record<string, string>).source);
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

    const sharedPackageDir = path.join(sharedRepoRoot, 'packages', dirName);
    const dependencyNames = new Set<string>([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {})
    ]);

    for (const dependencyName of dependencyNames) {
      if (
        workspaceNames.has(dependencyName)
        || builtins.has(dependencyName)
        || excludedExternalAliases.some((prefix) => dependencyName === prefix || dependencyName.startsWith(prefix))
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
  resolve: {
    alias: createWorkspaceSourceAliases(),
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
