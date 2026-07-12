import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const packagesRoot = path.join(repoRoot, 'packages');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getPublicPackages() {
  return fs.readdirSync(packagesRoot)
    .map((dir) => {
      const packageJsonPath = path.join(packagesRoot, dir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) return null;

      const pkg = readJson(packageJsonPath);
      const isPublic = !pkg.private || pkg.publishConfig?.access === 'public';
      if (!isPublic) return null;

      return {
        dir,
        name: pkg.name,
        packageJsonPath
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
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

    try {
      const resolved = requireResolver.resolve(pkg.name);
      await import(pathToFileURL(resolved).href);
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
