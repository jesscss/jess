import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageLibDirs, removePackageLibDirs } from '../clean-package-libs.mjs';

function mkdirp(path: string) {
  mkdirSync(path, { recursive: true });
}

function asRepoPaths(root: string, paths: string[]) {
  return paths.map(path => relative(root, path).split(sep).join('/'));
}

describe('clean package libs', () => {
  it('removes top-level and nested workspace package lib outputs only', () => {
    const root = mkdtempSync(join(tmpdir(), 'jess-clean-package-libs-'));
    try {
      const topPackage = join(root, 'packages/core');
      const nestedPackage = join(root, 'packages/syntax/less/less-parser');
      const nonPackage = join(root, 'packages/scratch');
      const dependencyPackage = join(topPackage, 'node_modules/dependency');

      mkdirp(join(topPackage, 'lib'));
      mkdirp(join(nestedPackage, 'lib'));
      mkdirp(join(nonPackage, 'lib'));
      mkdirp(join(dependencyPackage, 'lib'));
      writeFileSync(join(topPackage, 'package.json'), '{}\n');
      writeFileSync(join(nestedPackage, 'package.json'), '{}\n');
      writeFileSync(join(dependencyPackage, 'package.json'), '{}\n');

      expect(asRepoPaths(root, packageLibDirs(root))).toEqual([
        'packages/core/lib',
        'packages/syntax/less/less-parser/lib'
      ]);

      expect(asRepoPaths(root, removePackageLibDirs(root))).toEqual([
        'packages/core/lib',
        'packages/syntax/less/less-parser/lib'
      ]);
      expect(existsSync(join(topPackage, 'lib'))).toBe(false);
      expect(existsSync(join(nestedPackage, 'lib'))).toBe(false);
      expect(existsSync(join(nonPackage, 'lib'))).toBe(true);
      expect(existsSync(join(dependencyPackage, 'lib'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
