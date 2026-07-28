import type {
  DiagnosticDisplay,
  ErrorDiagnostic,
  ErrorsConfigInput,
  WarningDiagnostic,
  WarningsConfigInput
} from '@jesscss/core';
import { displayOverrideFor, resolveErrorsConfig, resolveWarningsConfig } from '@jesscss/core';
import { relative, resolve } from 'node:path';
import { CodeDebug, Region } from 'linecraft';

/**
 * OSC-8 terminal hyperlink: wraps `label` as a clickable link to `uri` for
 * terminals that support it. We keep our own wrapper (rather than linecraft's
 * `fileLink`) because it hardcodes the `file://` scheme, whereas we link with
 * `vscode://file/…:line:col` so the click jumps to the exact location.
 */
function oscLink(uri: string, label: string): string {
  return `\x1b]8;;${uri}\x1b\\${label}\x1b]8;;\x1b\\`;
}

type AnyDiagnostic = ErrorDiagnostic | WarningDiagnostic;

/**
 * A diagnostic with no usable location falls out of the display ladder and is
 * rendered as a bare message one-liner (`block`), regardless of the configured
 * tier.
 */
type RenderTier = DiagnosticDisplay | 'block';

const WARN_ICON = 'warning';
const ERROR_ICON = 'error';

/**
 * Formats and outputs diagnostics (errors and warnings) to the console.
 *
 * Each diagnostic is rendered at a display tier drawn from the ladder
 * `summary → line → frame`:
 * - `summary` one line per code (count + files) — the most compact view;
 * - `line`    one line per site with an OSC-8 clickable `file:line:col` link;
 * - `frame`   a full linecraft code frame (plus any include/call stack the
 *             diagnostic already carries via `note`).
 *
 * Tiers resolve per diagnostic in this precedence: category override → severity
 * default → dedup first-vs-repeat (a repeated frame-tier code drops to `line`)
 * → verbose promotion → no-location fallback (a bare one-liner).
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

    /** Display config for warnings (scalar tier or object). Default tier `line`. */
    warnings?: WarningsConfigInput;

    /** Display config for errors (scalar tier or object). Default tier `frame`. */
    errors?: ErrorsConfigInput;

    /** Emit ANSI color and terminal hyperlinks. Default: true. */
    colors?: boolean;
  } = {}
): void {
  const { suppressWarnings = false, breakOnError = true, verbose = false } = options;
  const colors = options.colors ?? true;

  const warnCfg = resolveWarningsConfig({ warnings: options.warnings, verbose });
  const errCfg = resolveErrorsConfig(options.errors);

  // Warnings -> stdout (unless suppressed)
  if (!suppressWarnings && warnings.length > 0) {
    renderTiered(warnings, {
      severityDefault: warnCfg.display,
      icon: WARN_ICON,
      type: 'warning',
      stream: process.stdout,
      verbose,
      colors
    });
  }

  // Errors -> stderr. By default only the first error surfaces.
  const errorsToOutput = breakOnError ? errors.slice(0, 1) : errors;
  if (errorsToOutput.length > 0) {
    renderTiered(errorsToOutput, {
      severityDefault: errCfg.display,
      icon: ERROR_ICON,
      type: 'error',
      stream: process.stderr,
      verbose,
      colors
    });
  }
}

interface TierContext {
  severityDefault: DiagnosticDisplay;
  icon: string;
  type: 'error' | 'warning';
  stream: NodeJS.WriteStream;
  verbose: boolean;
  colors: boolean;
}

function renderTiered(diagnostics: AnyDiagnostic[], ctx: TierContext): void {
  // A `summary`-tier request collapses the whole batch: one line per code.
  if (ctx.severityDefault === 'summary') {
    renderSummary(diagnostics, ctx.icon, ctx.stream);
    return;
  }

  const framedCodes = new Set<string>();
  for (const diagnostic of diagnostics) {
    const tier = resolveTier(diagnostic, ctx.severityDefault, ctx.verbose, framedCodes);
    switch (tier) {
      case 'summary':
        /*
         * A per-diagnostic `summary` collapses to the same shape as a group of
         * one; render it as a bare one-liner.
         */
        renderBlock(diagnostic, ctx.icon, ctx.stream);
        break;
      case 'block':
        renderBlock(diagnostic, ctx.icon, ctx.stream);
        break;
      case 'line':
        renderLine(diagnostic, ctx.icon, ctx.stream, ctx.colors);
        break;
      case 'frame':
        outputDiagnostic(diagnostic, ctx.type, ctx.stream, ctx.verbose, ctx.colors);
        break;
    }
  }
}

function hasLocation(diagnostic: AnyDiagnostic): boolean {
  return Boolean(diagnostic.filePath) && diagnostic.line > 0;
}

/** Promote a tier one notch toward `frame`. */
function promote(tier: DiagnosticDisplay): DiagnosticDisplay {
  return tier === 'summary' ? 'line' : 'frame';
}

/**
 * Resolve the display tier for a single diagnostic. `framedCodes` tracks codes
 * already shown at `frame` so later distinct sites drop to `line`.
 */
function resolveTier(
  diagnostic: AnyDiagnostic,
  severityDefault: DiagnosticDisplay,
  verbose: boolean,
  framedCodes: Set<string>
): RenderTier {
  // No usable location -> bare one-liner, whatever the configured tier.
  if (!hasLocation(diagnostic)) {
    return 'block';
  }

  // Category override wins over the severity default.
  let tier: DiagnosticDisplay = displayOverrideFor(diagnostic.code) ?? severityDefault;

  if (verbose) {
    /*
     * Verbose promotes everything one notch and renders all sites (no
     * first-vs-repeat demotion).
     */
    return promote(tier);
  }

  if (tier === 'frame') {
    // First site of a frame-tier code frames; later distinct sites drop to line.
    if (framedCodes.has(diagnostic.code)) {
      tier = 'line';
    } else {
      framedCodes.add(diagnostic.code);
    }
  }

  return tier;
}

/** `summary` tier: one line per code with occurrence count + distinct files. */
function renderSummary(
  diagnostics: AnyDiagnostic[],
  icon: string,
  stream: NodeJS.WriteStream
): void {
  const groups = new Map<string, { message: string; count: number; files: Set<string> }>();
  for (const diagnostic of diagnostics) {
    let group = groups.get(diagnostic.code);
    if (!group) {
      group = { message: diagnostic.message, count: 0, files: new Set<string>() };
      groups.set(diagnostic.code, group);
    }
    group.count++;
    if (diagnostic.filePath) {
      group.files.add(relative(process.cwd(), diagnostic.filePath));
    }
  }

  for (const [code, group] of groups) {
    const files = [...group.files];
    const fileList = files.length > 0 ? `  (${files.join(', ')})` : '';
    stream.write(`${icon} ${code}  ${group.message}  ${group.count}×${fileList}\n`);
  }
}

/** `line` tier: icon + code + message + OSC-8 link to `file:line:col`. */
function renderLine(
  diagnostic: AnyDiagnostic,
  icon: string,
  stream: NodeJS.WriteStream,
  colors: boolean
): void {
  const { code, message, filePath, line, column } = diagnostic;
  const abs = filePath ? resolve(filePath) : '';
  const shortPath = filePath ? relative(process.cwd(), filePath) : '(unknown)';
  const label = `${shortPath}:${line}:${column}`;
  const link = colors && abs ? oscLink(`vscode://file/${abs}:${line}:${column}`, label) : label;
  stream.write(`${icon} ${code}  ${message}  ·  ${link}\n`);
}

/** `block` fallback: a bare message one-liner with no link and no frame. */
function renderBlock(
  diagnostic: AnyDiagnostic,
  icon: string,
  stream: NodeJS.WriteStream
): void {
  stream.write(`${icon} ${diagnostic.code}  ${diagnostic.message}\n`);
}

function diagnosticWidth(stream: NodeJS.WriteStream): number {
  const width = typeof stream.columns === 'number' && Number.isFinite(stream.columns)
    ? stream.columns
    : process.stdout.columns;
  return typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 80;
}

const OSC8_SEQUENCE = /\x1B\]8;;.*?\x1B\\/g;
const ANSI_SGR_SEQUENCE = /\x1B\[[0-9;]*m/g;

function stripTerminalStyle(output: string): string {
  return output
    .replace(OSC8_SEQUENCE, '')
    .replace(ANSI_SGR_SEQUENCE, '');
}

/**
 * `frame` tier: a full linecraft code frame. Any include/call stack the
 * diagnostic already carries (via `note`) is appended; no stack is synthesized.
 * The output persists in the terminal after the region is destroyed.
 */
function outputDiagnostic(
  diagnostic: AnyDiagnostic,
  type: 'error' | 'warning',
  stream: NodeJS.WriteStream = process.stdout,
  verbose = false,
  colors = true
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

  // Only include reason and fix if verbose mode is enabled
  if (verbose) {
    messageLines.push('');
    messageLines.push(`Reason: ${reason}`);
    messageLines.push(`Fix: ${fix}`);
  }

  // Append the include/call stack the diagnostic already carries, if any.
  if (note) {
    messageLines.push(note.startsWith('Note:') ? note : `Note: ${note}`);
  }
  const fullMessage = messageLines.join('\n');

  const width = diagnosticWidth(stream);
  const region = Region({ stdout: stream, disableRendering: true, width });
  region.set(CodeDebug({
    startLine: errorLineNum,
    startColumn: column,
    endLine,
    endColumn,
    errorLine: errorLineContent,
    lineBefore,
    lineAfter,
    message: fullMessage,
    filePath: shortPath,
    fullPath,
    type
  }));

  for (let lineIndex = 1; lineIndex <= region.height; lineIndex++) {
    const line = region.getLine(lineIndex);
    stream.write(`${colors ? line : stripTerminalStyle(line)}\n`);
  }

  region.destroy(false);
}
