import type { ErrorDiagnostic, WarningDiagnostic } from '@jesscss/core';
import { relative, resolve } from 'node:path';
import { CodeDebug, Region } from 'linecraft';

/**
 * Formats and outputs diagnostics (errors and warnings) to the console.
 * Uses linecraft's CodeDebug component for formatted code frames.
 *
 * @param errors - Array of error diagnostics
 * @param warnings - Array of warning diagnostics
 * @param options - Output options
 */
export function outputDiagnostics(
  errors: ErrorDiagnostic[],
  warnings: WarningDiagnostic[],
  options: {
    suppressWarnings?: boolean;
    breakOnError?: boolean;
    verbose?: boolean;
  } = {}
): void {
  const { suppressWarnings = false, breakOnError = true, verbose = false } = options;

  // Merge warnings intelligently:
  // 1. Group by code + filePath + line (for similar warnings like extend targets)
  // 2. For warnings with parameterized messages (like "Extend target X"), merge them
  const warningGroups = new Map<string, { warnings: WarningDiagnostic[]; representative: WarningDiagnostic }>();

  for (const warning of warnings) {
    // For extend warnings and similar parameterized messages, group by code + filePath + line
    // This merges "Extend target .a not accessible" and "Extend target .b not accessible" into one group
    const isParameterized = warning.code === 'extend/not-found' || warning.code === 'extend/not-accessible';
    const groupKey = isParameterized
      ? `${warning.code}:${warning.filePath ?? ''}:${warning.line}`
      : `${warning.code}:${warning.message}:${warning.filePath ?? ''}:${warning.line}`;

    const existing = warningGroups.get(groupKey);
    if (existing) {
      existing.warnings.push(warning);
    } else {
      warningGroups.set(groupKey, { warnings: [warning], representative: warning });
    }
  }

  // Output warnings to stdout (unless suppressed)
  if (!suppressWarnings && warningGroups.size > 0) {
    for (const { warnings: groupWarnings, representative } of warningGroups.values()) {
      if (groupWarnings.length === 1) {
        // Single warning - output as-is
        outputDiagnostic(representative, 'warning', process.stdout, verbose, 1);
      } else {
        // Multiple similar warnings - merge them
        // Don't show repeat count since we're already summarizing multiple different warnings
        const merged = mergeSimilarWarnings(groupWarnings, representative);
        outputDiagnostic(merged, 'warning', process.stdout, verbose, 1);
      }
    }
  }

  // Output errors to stderr
  // By default, only output the first error (unless breakOnError is false)
  const errorsToOutput = breakOnError ? errors.slice(0, 1) : errors;
  for (const error of errorsToOutput) {
    outputDiagnostic(error, 'error', process.stderr, verbose);
  }
}

/**
 * Merges multiple similar warnings into a single diagnostic with a combined message.
 * For parameterized warnings like "Extend target X not accessible", combines all targets.
 */
function mergeSimilarWarnings(
  warnings: WarningDiagnostic[],
  representative: WarningDiagnostic
): WarningDiagnostic {
  // Extract parameterized values from messages (e.g., ".a", ".b" from "Extend target .a not accessible")
  const targets: string[] = [];
  for (const warning of warnings) {
    // Extract the target from messages like "Extend target ".a" not accessible"
    const match = warning.message.match(/Extend target "([^"]+)" (not found|not accessible)/);
    if (match) {
      targets.push(match[1]!);
    }
  }

  // Create merged message
  let mergedMessage: string;
  if (targets.length > 0) {
    if (targets.length <= 5) {
      // Show all targets if 5 or fewer
      mergedMessage = `Extend target${targets.length > 1 ? 's' : ''} ${targets.map(t => `"${t}"`).join(', ')} ${representative.message.includes('not accessible') ? 'not accessible' : 'not found'}`;
    } else {
      // Show first 3 and count if more
      const shown = targets.slice(0, 3).map(t => `"${t}"`).join(', ');
      const remaining = targets.length - 3;
      mergedMessage = `Extend targets ${shown} and ${remaining} more ${representative.message.includes('not accessible') ? 'not accessible' : 'not found'}`;
    }
  } else {
    // Fallback: use representative message with count
    mergedMessage = representative.message;
  }

  return {
    ...representative,
    message: mergedMessage
  };
}

/**
 * Outputs a single diagnostic using linecraft's CodeDebug component.
 * The output will persist in the terminal after the region is destroyed.
 */
function outputDiagnostic(
  diagnostic: ErrorDiagnostic | WarningDiagnostic,
  type: 'error' | 'warning',
  stream: NodeJS.WriteStream = process.stdout,
  verbose = false,
  repeatCount = 1
): void {
  const { code, phase, message, reason, fix, filePath, line, column, lines, note } = diagnostic;
  const endLine = 'endLine' in diagnostic ? diagnostic.endLine : undefined;
  const endColumn = 'endColumn' in diagnostic ? diagnostic.endColumn : undefined;

  // Get file paths
  const fullPath = filePath ? resolve(filePath) : '';
  const shortPath = filePath ? relative(process.cwd(), filePath) : '(unknown)';

  // Extract lines for code frame
  const lineNumbers = lines ? Object.keys(lines).map(Number).sort((a, b) => a - b) : [];
  const errorLineNum = line;
  const errorLineContent = lines?.[errorLineNum] ?? '';
  const lineBefore = lineNumbers.length > 0 && lineNumbers[0]! < errorLineNum
    ? lines?.[errorLineNum - 1] ?? null
    : null;
  const lineAfter = lineNumbers.length > 0 && lineNumbers[lineNumbers.length - 1]! > errorLineNum
    ? lines?.[errorLineNum + 1] ?? null
    : null;

  // Build message - send raw strings to CodeDebug
  const messageLines = [
    `${code} [${phase}]`,
    message
  ];

  // Add repeat count if > 1 (only for exact duplicates, not merged similar warnings)
  // The repeatCount is only meaningful when it represents the same exact warning repeated
  if (repeatCount > 1 && !message.includes(' and ') && !message.includes('more')) {
    messageLines.push(`(repeated ${repeatCount} time${repeatCount > 1 ? 's' : ''})`);
  }

  // Only include reason and fix if verbose mode is enabled
  if (verbose) {
    messageLines.push('');
    messageLines.push(`Reason: ${reason}`);
    messageLines.push(`Fix: ${fix}`);
  }

  if (note) {
    messageLines.push(note.startsWith('Note:') ? note : `Note: ${note}`);
  }
  const fullMessage = messageLines.join('\n');

  // Create CodeDebug component and output it to the specified stream
  // Region will use getTerminalWidth() which should handle redirected streams
  const region = Region({ stdout: stream });
  region.set(CodeDebug({
    startLine: errorLineNum,
    startColumn: column,
    endLine: endLine,
    endColumn: endColumn,
    errorLine: errorLineContent,
    lineBefore: lineBefore,
    lineAfter: lineAfter,
    message: fullMessage,
    filePath: shortPath,
    fullPath: fullPath,
    type: type
  }));

  // Flush to ensure rendering, then destroy without clearing to persist output
  // This will write the content to the terminal permanently
  void region.flush();
  void region.destroy(false); // false = don't clear, persist the output
}
