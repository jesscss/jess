/** Parse staged unified-diff hunks into the new-file lines actually added/changed. */
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

/** Keep ESLint diagnostics that are on staged lines; global/file diagnostics block too. */
export function stagedLintMessages(messages, addedLines) {
  return messages.filter(message => message.line === 0 || addedLines.has(message.line));
}
