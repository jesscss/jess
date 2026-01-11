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
  } = {}
): void {
  const { suppressWarnings = false, breakOnError = true } = options;

  // Output warnings to stdout (unless suppressed)
  if (!suppressWarnings && warnings.length > 0) {
    for (const warning of warnings) {
      outputDiagnostic(warning, 'warning', process.stdout);
    }
  }

  // Output errors to stderr
  // By default, only output the first error (unless breakOnError is false)
  const errorsToOutput = breakOnError ? errors.slice(0, 1) : errors;
  for (const error of errorsToOutput) {
    outputDiagnostic(error, 'error', process.stderr);
  }
}

/**
 * Outputs a single diagnostic using linecraft's CodeDebug component.
 */
function outputDiagnostic(
  diagnostic: ErrorDiagnostic | WarningDiagnostic,
  type: 'error' | 'warning',
  stream: NodeJS.WriteStream = process.stdout
): void {
  const { code, phase, message, reason, fix, filePath, line, column, lines, note } = diagnostic;

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

  // Build message with code, phase, reason, fix, and note
  const messageParts = [
    `${code} [${phase}]`,
    message,
    '',
    `Reason: ${reason}`,
    `Fix: ${fix}`
  ];
  if (note) {
    messageParts.push(`Note: ${note}`);
  }
  const fullMessage = messageParts.join('\n');

  // Create CodeDebug component and output it to the specified stream
  const region = Region({ stdout: stream });
  region.set(CodeDebug({
    startLine: errorLineNum,
    startColumn: column,
    errorLine: errorLineContent,
    lineBefore: lineBefore,
    lineAfter: lineAfter,
    message: fullMessage,
    filePath: shortPath,
    fullPath: fullPath,
    type: type
  }));
}
