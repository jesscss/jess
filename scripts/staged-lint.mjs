/** Parse staged unified-diff hunks into the new-file lines actually added/changed. */
const LINTABLE_SOURCE_EXTENSION = /\.(?:[cm]?js|[cm]?ts|tsx)$/u;
const GENERATED_PATH = /(?:^|\/)(?:build|lib|dist|coverage|\.docusaurus|node_modules)(?:\/|$)/u;
const ROOT_LINTABLE_PATH = /^(?:scripts\/.+|[^/]+\.config\.(?:[cm]?js|[cm]?ts|tsx)|vitest\.d\.ts|test\/setup\.ts)$/u;

export function stagedAddedLines(diff) {
  const lines = new Set();
  let newLine = null;
  for (const line of diff.split('\n')) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (newLine === null || line.startsWith('\\')) {
      continue;
    }
    if (line.startsWith('+')) {
      lines.add(newLine);
      newLine++;
    } else if (!line.startsWith('-')) {
      newLine++;
    }
  }
  return lines;
}

/**
 * Return staged executable files in the repository's ESLint policy surface.
 * Generated output and JSON are intentionally outside this selection.
 */
export function stagedLintableFiles(files) {
  return files.filter((file) => {
    if (GENERATED_PATH.test(file) || !LINTABLE_SOURCE_EXTENSION.test(file)) {
      return false;
    }
    return file.startsWith('packages/') || ROOT_LINTABLE_PATH.test(file);
  });
}

/**
 * Keep blocking ESLint diagnostics: fatal diagnostics always block, while
 * ordinary error-level rules block only on staged lines or global locations.
 * Warnings are intentionally advisory at every stage.
 */
export function stagedLintMessages(messages, addedLines) {
  return messages.filter(message => message.fatal === true
    || (message.severity === 2 && (message.line === 0 || addedLines.has(message.line))));
}
