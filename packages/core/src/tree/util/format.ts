import { basename, extname } from 'node:path';

/**
 * Normalize a filename to a namespace identifier (Sass-style).
 * Replaces unsupported characters with underscores, and prepends an underscore
 * if the filename starts with a number.
 *
 * @param filePath - The file path (can be absolute or relative)
 * @returns The normalized namespace identifier
 */
export function normalizeFilenameToNamespace(filePath: string): string {
  // Get just the filename without extension
  const filename = basename(filePath, extname(filePath));

  // Replace any non-identifier characters with underscores
  // CSS identifiers can contain: letters, numbers, underscores, hyphens
  // But can't start with a number or hyphen
  let normalized = filename.replace(/[^a-zA-Z0-9_-]/g, '_');

  // If it starts with a number, prepend an underscore
  if (/^\d/.test(normalized)) {
    normalized = '_' + normalized;
  }

  // If it starts with a hyphen, prepend an underscore
  if (/^-/.test(normalized)) {
    normalized = '_' + normalized;
  }

  return normalized;
}

/**
 * Normalize multi-line child text so that continuation lines
 * are aligned to the parent's base indent while preserving
 * the child's relative extra indentation beyond the minimal common indent.
 *
 * - First line is returned unchanged (parent already emitted its indent)
 * - For each subsequent line, we remove the minimal leading spaces
 *   across all non-empty continuation lines, then prepend baseIndent.
 */
export function normalizeContinuationIndent(text: string, baseIndent: string): string {
  const nl = text.indexOf('\n');
  if (nl === -1) {
    return text;
  }

  const lines = text.split('\n');
  let min = Infinity;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length === 0) {
      continue;
    }
    const m = line.match(/^[ \t]*/)!;
    const len = m[0].length;
    // Count only if the line has non-space content
    if (len < line.length) {
      if (len < min) {
        min = len;
      }
    }
  }
  if (!isFinite(min)) {
    min = 0;
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.slice(min);
    lines[i] = baseIndent + trimmed;
  }
  return lines.join('\n');
}
