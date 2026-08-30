import type { WarningDiagnostic } from './jess-error.js';

/**
 * Presentation tier for a diagnostic (increasing per-occurrence detail):
 * - `summary` one line per CODE (count + files) — most compact
 * - `line`    one line per SITE (message + clickable file:line:col link)
 * - `frame`   full code frame per site (+ any include/call stack it carries)
 *
 * (`trace` is deliberately not part of the ladder; a diagnostic with no
 * location is rendered as a message-style one-liner regardless of tier.)
 */
export type DiagnosticDisplay = 'summary' | 'line' | 'frame';

/**
 * User-facing configuration for the unified warnings processor.
 *
 * All the code-matching fields accept either an exact diagnostic `code`
 * (e.g. `extend/not-found`) or a trailing-wildcard category (`extend/*`,
 * `deprecation/*`), plus the catch-all `*`.
 */
export interface WarningsConfig {
  /** Presentation tier for warnings. Default `line`. */
  display?: DiagnosticDisplay;

  /** Codes (or `cat/*` wildcards) whose warnings are dropped silently. */
  silence?: string[];

  /** Codes (or `cat/*` wildcards) whose warnings are thrown as errors. */
  fatal?: string[];

  /**
   * Codes (or `cat/*` wildcards) the author opts into early — reserved for
   * surfacing warnings that will become fatal at the next major version.
   */
  future?: string[];

  /** Cap repeated warnings per code/site. Default `true`. */
  limitRepetition?: boolean;

  /** Distinct sites emitted per code before the rest are summarized. Default `5`. */
  maxSitesPerCode?: number;
}

/**
 * The `warnings` compile option, accepting either a bare display tier
 * (`'summary' | 'line' | 'frame'`) or the full config object.
 */
export type WarningsConfigInput = DiagnosticDisplay | WarningsConfig;

/** User-facing configuration for how errors are displayed. */
export interface ErrorsConfig {
  /** Presentation tier for errors. Default `frame`. */
  display?: DiagnosticDisplay;
}

/**
 * The `errors` compile option, accepting either a bare display tier or the
 * config object.
 */
export type ErrorsConfigInput = DiagnosticDisplay | ErrorsConfig;

/** The fully-resolved config the processor reads on every `warn()`. */
export interface ResolvedWarningsConfig {
  display: DiagnosticDisplay;
  silence: string[];
  fatal: string[];
  future: string[];
  limitRepetition: boolean;
  maxSitesPerCode: number;
  verbose: boolean;
}

/** The fully-resolved error-display config. */
export interface ResolvedErrorsConfig {
  display: DiagnosticDisplay;
}

const DEFAULT_MAX_SITES_PER_CODE = 5;
const DEFAULT_WARNINGS_DISPLAY: DiagnosticDisplay = 'line';
const DEFAULT_ERRORS_DISPLAY: DiagnosticDisplay = 'frame';

/** Normalize the scalar-or-object `warnings` option into the object form. */
function normalizeWarningsConfig(input: WarningsConfigInput | undefined): WarningsConfig {
  if (input === undefined) {
    return {};
  }
  return typeof input === 'string' ? { display: input } : input;
}

/** Normalize the scalar-or-object `errors` option into the object form. */
function normalizeErrorsConfig(input: ErrorsConfigInput | undefined): ErrorsConfig {
  if (input === undefined) {
    return {};
  }
  return typeof input === 'string' ? { display: input } : input;
}

/**
 * Match a diagnostic `code` against a single pattern. Supported forms:
 * - `*`            — matches any code
 * - `cat/*`        — matches any code beginning `cat/`
 * - exact          — matches only that code
 */
export function warnCodeMatches(code: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }
  if (pattern.endsWith('/*')) {
    // Keep the trailing slash so `deprecation/*` does not match `deprecationX/y`.
    return code.startsWith(pattern.slice(0, -1));
  }
  return code === pattern;
}

/** True if `code` matches any pattern in `patterns`. */
export function warnCodeMatchesAny(code: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (warnCodeMatches(code, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Inputs from the compile options that feed the warnings config, kept minimal so
 * this stays testable without a full {@link Context}.
 */
export interface WarningsConfigInputs {
  warnings?: WarningsConfigInput;

  /** Legacy Less option — silences everything. */
  suppressWarnings?: boolean;
  verbose?: boolean;

  /** Legacy deprecation ids to make fatal (mapped onto `deprecation/<id>`). */
  fatalDeprecations?: string[];

  /** Legacy deprecation ids to opt into early (mapped onto `deprecation/<id>`). */
  futureDeprecations?: string[];
}

/**
 * Fold the compile options into a single resolved warnings config. Legacy
 * `suppressWarnings` maps to a silence-all; legacy `fatal/futureDeprecations`
 * map onto `deprecation/<id>` codes.
 */
export function resolveWarningsConfig(opts: WarningsConfigInputs): ResolvedWarningsConfig {
  const base = normalizeWarningsConfig(opts.warnings);

  const silence = [...(base.silence ?? [])];
  if (opts.suppressWarnings) {
    silence.push('*');
  }

  const fatal = [...(base.fatal ?? [])];
  for (const id of opts.fatalDeprecations ?? []) {
    fatal.push(`deprecation/${id}`);
  }

  const future = [...(base.future ?? [])];
  for (const id of opts.futureDeprecations ?? []) {
    future.push(`deprecation/${id}`);
  }

  return {
    display: base.display ?? DEFAULT_WARNINGS_DISPLAY,
    silence,
    fatal,
    future,
    limitRepetition: base.limitRepetition ?? true,
    maxSitesPerCode: base.maxSitesPerCode ?? DEFAULT_MAX_SITES_PER_CODE,
    verbose: opts.verbose ?? false
  };
}

/**
 * Fold the `errors` compile option (scalar-or-object) into its resolved form.
 * Defaults the display tier to `frame`.
 */
export function resolveErrorsConfig(errors?: ErrorsConfigInput): ResolvedErrorsConfig {
  const base = normalizeErrorsConfig(errors);
  return {
    display: base.display ?? DEFAULT_ERRORS_DISPLAY
  };
}

/** Per-code bookkeeping used for de-duplication, capping and the tail summary. */
export interface CodeWarnStats {
  /** Phase captured from the first diagnostic (for the summary diagnostic). */
  phase: WarningDiagnostic['phase'];

  /** Distinct site keys that were emitted (used for dedup + the site cap). */
  readonly emittedSites: Set<string>;

  /** Distinct site keys that had at least one suppressed warning. */
  readonly suppressedSites: Set<string>;

  /** Total number of suppressed warning occurrences. */
  suppressedCount: number;
}

/** Build the tail-summary diagnostic for a code that had suppressed warnings. */
export function makeSuppressionSummary(
  code: string,
  stats: CodeWarnStats
): WarningDiagnostic {
  const sites = stats.suppressedSites.size;
  return {
    code,
    phase: stats.phase,
    message: `${code}: ${stats.suppressedCount} warnings suppressed across ${sites} sites — run with { verbose: true } to see all.`,
    reason: '',
    fix: '',
    line: 0,
    column: 0
  };
}
