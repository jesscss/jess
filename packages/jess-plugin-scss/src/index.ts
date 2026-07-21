import {
  type Plugin,
  AbstractPlugin,
  type ISafeParseResult,
  type ErrorDiagnostic,
  extractRelevantLines,
} from '@jesscss/core';
import { parse } from '@jesscss/scss-parser';
import { expandScssImportCandidates } from '@jesscss/style-resolver';
import type { EqualityMode, UnitMode } from '@jesscss/core';

export type ScssPluginOptions = {
  allowExtendSelectors?: ExtendSelectorKind[];
  /**
   * Unit mode for handling unit arithmetic.
   * - 'loose': Convert units when possible (default for Less)
   * - 'preserve': Create calc() expressions for unit errors (default for SCSS)
   * - 'strict': Throw errors for unit mismatches
   * @default 'preserve'
   */
  unitMode?: UnitMode;
  /**
   * Equality mode for guard/comparison semantics.
   * @default 'strict'
   */
  equalityMode?: EqualityMode;
  /**
   * Whether to collapse nested selectors (flatten nesting during print).
   * This is a Jess output option, not a Sass option.
   */
  collapseNesting?: boolean;
};

type ExtendSelectorKind = 'simple' | 'basic' | 'pseudo' | 'complex' | 'compound';

function parseErrorLocation(source: string, error: unknown): { line: number; column: number } {
  const offset = typeof error === 'object' && error !== null && 'offset' in error && typeof error.offset === 'number'
    ? Math.max(0, Math.min(source.length, error.offset))
    : 0;
  const before = source.slice(0, offset);
  return {
    line: before.split('\n').length,
    column: offset - (before.lastIndexOf('\n') + 1) + 1
  };
}

export class ScssPlugin extends AbstractPlugin {
  name = 'scss';
  supportedExtensions = ['.scss'];
  unitMode: UnitMode;
  equalityMode: EqualityMode;

  constructor(public opts: ScssPluginOptions = {}) {
    super();
    this.unitMode = opts.unitMode ?? 'preserve';
    this.equalityMode = opts.equalityMode ?? 'sass';
  }

  expandImport(importPath: string) {
    // Keep import expansion in sync with the language service.
    return expandScssImportCandidates(importPath);
  }

  safeParse(filePath: string, source: string): ISafeParseResult {
    try {
      return { document: parse(source), errors: [], warnings: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const location = parseErrorLocation(source, error);
      return {
        errors: [{
          code: 'parse/syntax-error',
          phase: 'parse',
          message,
          reason: message,
          fix: 'Check the SCSS source against the supported grammar.',
          filePath,
          line: location.line,
          column: location.column,
          lines: extractRelevantLines(source, location.line)
        } satisfies ErrorDiagnostic],
        warnings: []
      };
    }
  }
}

const scssPlugin = ((opts?: ScssPluginOptions) => new ScssPlugin(opts)) satisfies Plugin;

export default scssPlugin;
