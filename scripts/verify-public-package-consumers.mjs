import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.join(repoRoot, 'packages');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getPublicPackages() {
  return fs.readdirSync(packagesRoot)
    .map((dir) => {
      const packageJsonPath = path.join(packagesRoot, dir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        return null;
      }

      const pkg = readJson(packageJsonPath);
      const isPublic = !pkg.private || pkg.publishConfig?.access === 'public';
      if (!isPublic) {
        return null;
      }

      return {
        dir,
        name: pkg.name,
        packageJsonPath
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The file an ESM consumer of `pkg` actually loads.
 *
 * `requireResolver.resolve()` applies the REQUIRE condition and yields the CJS
 * artifact, so using it for the import check tested `lib/index.cjs` twice and
 * never exercised the `import` condition for any package. `import.meta.resolve`
 * is not usable either: its `parent` argument is ignored, so it resolves from
 * this script rather than from the consuming package. Read the resolved
 * manifest and pick the import entry explicitly.
 */
function esmEntry(pkg) {
  /*
   * Read the workspace manifest from disk rather than resolving
   * `<name>/package.json`: several packages here deliberately do not export the
   * `./package.json` subpath, and that is not a reason to fail the ESM check.
   */
  const manifestPath = pkg.packageJsonPath;
  const manifest = readJson(manifestPath);
  const pkgDir = path.dirname(manifestPath);

  const dot = manifest.exports?.['.'];
  const specifier = (typeof dot === 'string' ? dot : dot?.import ?? dot?.default)
    ?? manifest.module
    ?? manifest.main;

  if (!specifier) {
    throw new Error(`${pkg.name} declares no ESM entry (no exports["."].import, module, or main)`);
  }
  return path.resolve(pkgDir, specifier);
}

async function main() {
  const failures = [];

  for (const pkg of getPublicPackages()) {
    const requireResolver = createRequire(path.join(packagesRoot, pkg.dir, 'require-check.cjs'));

    try {
      requireResolver(pkg.name);
      console.log(`require ok  ${pkg.name}`);
    } catch (error) {
      failures.push(`require failed for ${pkg.name}: ${error.message}`);
      console.error(`require ERR ${pkg.name}: ${error.message}`);
    }

    /*
     * The ESM entry must be resolved under the `import` condition.
     *
     * This previously used `requireResolver.resolve(pkg.name)`, which resolves
     * under the REQUIRE condition and yields the CJS artifact -- so the "import"
     * check dynamic-imported `lib/index.cjs` for every package and the `import`
     * export condition was never exercised at all. Two lines of output, one
     * check. `import.meta.resolve` from inside the package directory applies the
     * import condition, which is the thing an ESM consumer actually gets.
     */
    try {
      const entry = esmEntry(pkg);
      await import(pathToFileURL(entry).href);
      console.log(`import  ok  ${pkg.name}`);
    } catch (error) {
      failures.push(`import failed for ${pkg.name}: ${error.message}`);
      console.error(`import  ERR ${pkg.name}: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} public package consumer checks failed.`);
    process.exit(1);
  }
}

await main();
