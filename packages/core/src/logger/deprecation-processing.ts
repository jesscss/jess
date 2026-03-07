import type { Deprecation } from '../deprecation.js';
import type { Logger } from '../logger.js';
import type { WarningDiagnostic } from '../jess-error.js';

/**
 * The maximum number of repetitions of the same deprecation warning
 * that will be emitted before hiding the rest.
 */
const MAX_REPETITIONS = 5;

/**
 * A logger wrapper that provides special handling for deprecation warnings:
 * - Making deprecations fatal (throwing errors)
 * - Limiting repetition (max 5 per deprecation)
 */
export class DeprecationProcessingLogger implements Logger {
  /** A map of how many times each deprecation has been emitted */
  private readonly _warningCounts = new Map<Deprecation, number>();

  /** The inner logger to delegate to */
  private readonly _inner: Logger;

  /** Deprecation warnings of these types will cause an error to be thrown */
  readonly fatalDeprecations: Set<Deprecation>;

  /** Whether repetitions of the same warning should be limited */
  readonly limitRepetition: boolean;

  constructor(
    inner: Logger,
    options: {
      fatalDeprecations?: Iterable<Deprecation>;
      limitRepetition?: boolean;
    } = {}
  ) {
    this._inner = inner;
    this.fatalDeprecations = new Set(options.fatalDeprecations ?? []);
    this.limitRepetition = options.limitRepetition ?? true;
  }

  /**
   * Processes a deprecation warning.
   *
   * If the deprecation is in fatalDeprecations, this throws an error.
   * If it's already been warned for MAX_REPETITIONS times and limitRepetition is true, the warning is dropped.
   * Otherwise, this is passed on to the inner logger.
   */
  warnForDeprecation(
    deprecation: Deprecation,
    warning: WarningDiagnostic
  ): void {
    if (this.fatalDeprecations.has(deprecation)) {
      const message = `${warning.message}\n\nThis is only an error because you've set the ${deprecation.id} deprecation to be fatal.\nRemove this setting if you need to keep using this feature.`;
      const error = new Error(message);
      error.name = 'DeprecationError';
      throw error;
    }

    if (this.limitRepetition) {
      const count = (this._warningCounts.get(deprecation) ?? 0) + 1;
      this._warningCounts.set(deprecation, count);
      if (count > MAX_REPETITIONS) {
        return;
      }
    }

    // Pass to inner logger
    this._inner.warn?.(warning.message);
  }

  /**
   * Prints a warning indicating the number of deprecation warnings that were
   * omitted due to repetition.
   */
  summarize(): void {
    let total = 0;
    for (const [deprecation, count] of this._warningCounts.entries()) {
      if (count > MAX_REPETITIONS) {
        total += count - MAX_REPETITIONS;
      }
    }
    if (total > 0) {
      this._inner.warn?.(
        `${total} repetitive deprecation warnings omitted.\nRun in verbose mode to see all warnings.`
      );
    }
  }

  // Delegate other logger methods to inner logger
  configure?(log: Logger): void {
    this._inner.configure?.(log);
  }

  log?(...args: any[]): void {
    this._inner.log?.(...args);
  }

  info?(...args: any[]): void {
    this._inner.info?.(...args);
  }

  warn?(...args: any[]): void {
    this._inner.warn?.(...args);
  }

  error?(...args: any[]): void {
    this._inner.error?.(...args);
  }
}
