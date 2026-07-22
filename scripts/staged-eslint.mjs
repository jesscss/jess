import { ESLint } from 'eslint';

/**
 * Run ESLint through its structured API so staged diagnostics never travel
 * through a bounded JSON stdout buffer.
 */
export async function lintStagedFiles(files, { cwd, ESLintClass = ESLint } = {}) {
  const eslint = new ESLintClass({ cwd });
  return eslint.lintFiles(files);
}
