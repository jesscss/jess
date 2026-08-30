import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Run ESLint against the index through its structured API. Diagnostics therefore
 * never travel through a bounded stdout buffer and, more importantly, cannot be
 * hidden by different unstaged working-tree bytes.
 */
export async function lintStagedFiles(files, {
  cwd,
  ESLintClass = ESLint,
  readStagedFile = file => execFileSync('git', ['show', `:${file}`], {
    cwd,
    encoding: 'utf8'
  })
} = {}) {
  const eslint = new ESLintClass({ cwd });
  return Promise.all(files.map(async (file) => {
    const [report] = await eslint.lintText(readStagedFile(file), {
      filePath: resolve(cwd, file),
      warnIgnored: true
    });
    return report;
  }));
}
