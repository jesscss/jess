import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, '../../..');
export const packageRoot = path.resolve(scriptDir, '..');
export const docsRoot = path.join(packageRoot, 'docs');

export const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

export const walkFiles = (dirPath, out = []) => {
  if (!fs.existsSync(dirPath)) {
    return out;
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, out);
      continue;
    }
    out.push(fullPath);
  }
  return out;
};

export const copyTree = (sourceDir, targetDir) => {
  ensureDir(targetDir);
  for (const filePath of walkFiles(sourceDir)) {
    const rel = path.relative(sourceDir, filePath);
    const dest = path.join(targetDir, rel);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(filePath, dest);
  }
};

export const cleanDir = (dirPath) => {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
};
