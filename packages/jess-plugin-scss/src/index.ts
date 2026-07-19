import {
  type Plugin,
  AbstractPlugin,
  type ISafeParseResult,
  type ErrorDiagnostic,
  extractRelevantLines,
} from '@jesscss/core';
import path from 'node:path';
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
    const error: ErrorDiagnostic = {
      code: 'parse/unavailable',
      phase: 'parse',
      message: 'SCSS AST parsing is unavailable: the legacy parser entry was deleted.',
      reason: 'SCSS AST parsing is unavailable: the legacy parser entry was deleted.',
      fix: 'Use the SCSS CST parser while the direct AST parser is implemented.',
      file: { name: path.basename(filePath), path: path.dirname(filePath), fullPath: filePath, source },
      filePath,
      line: 1,
      column: 1,
      lines: extractRelevantLines(source, 1)
    };
    return { errors: [error], warnings: [] };
  }
}

const scssPlugin = ((opts?: ScssPluginOptions) => new ScssPlugin(opts)) satisfies Plugin;

export default scssPlugin;
