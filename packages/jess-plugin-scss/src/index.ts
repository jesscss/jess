import {
  type Plugin,
  AbstractPlugin,
  TreeContext,
  type ISafeParseResult,
  type SafeParseOptions,
  type ErrorDiagnostic,
  type WarningDiagnostic,
  JessError,
  getErrorFromParser,
  toDiagnostic,
  extractRelevantLines,
  type Rules
} from '@jesscss/core';
import { Parser } from '@jesscss/scss-parser';
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
  parser: Parser;
  unitMode: UnitMode;
  equalityMode: EqualityMode;

  constructor(public opts: ScssPluginOptions = {}) {
    super();
    this.unitMode = opts.unitMode ?? 'preserve';
    this.equalityMode = opts.equalityMode ?? 'strict';
    this.parser = new Parser();
  }

  expandImport(importPath: string) {
    // Keep import expansion in sync with the language service.
    return expandScssImportCandidates(importPath);
  }

  safeParse(filePath: string, source: string, parseOptions?: SafeParseOptions): ISafeParseResult {
    const allowExtendSelectors = this.opts.allowExtendSelectors
      ?? parseOptions?.compilerOptions?.allowExtendSelectors
      ?? ['simple'];

    const context = new TreeContext({
      file: {
        name: path.basename(filePath),
        path: path.dirname(filePath),
        fullPath: filePath,
        source
      },
      plugin: this,
      allowExtendSelectors,
      unitMode: this.unitMode,
      equalityMode: this.equalityMode,
      collapseNesting: this.opts.collapseNesting ?? false
    });

    const errors: ErrorDiagnostic[] = [];
    const warnings: WarningDiagnostic[] = [];
    let tree: Rules | undefined;

    try {
      const parseResult = this.parser.parse(source, 'stylesheet', { context });
      tree = parseResult.tree;

      // Convert parser errors to normalized diagnostics
      if (parseResult.errors.length) {
        for (const error of parseResult.errors) {
          const line = error.token?.startLine ?? 1;
          const jessError = getErrorFromParser([error], undefined, filePath, source, { file: context.file });
          const diagnostic = toDiagnostic(jessError);
          if (!diagnostic.lines) {
            diagnostic.lines = extractRelevantLines(source, line);
          }
          if ('errors' in diagnostic) {
            errors.push(diagnostic);
          } else {
            warnings.push(diagnostic);
          }
        }
      }

      // Convert lexer errors
      const lexErrors = parseResult.lexerResult?.errors ?? [];
      if (lexErrors.length) {
        for (const lexError of lexErrors) {
          const line = typeof lexError.line === 'number' ? lexError.line : 1;
          const jessError = getErrorFromParser([], [lexError], filePath, source, { file: context.file });
          const diagnostic = toDiagnostic(jessError);
          if (!diagnostic.lines) {
            diagnostic.lines = extractRelevantLines(source, line);
          }
          if ('errors' in diagnostic) {
            errors.push(diagnostic);
          } else {
            warnings.push(diagnostic);
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof JessError) {
        const diagnostic = toDiagnostic(error);
        if ('errors' in diagnostic) {
          errors.push(diagnostic);
        } else {
          warnings.push(diagnostic);
        }
      } else {
        const message = error instanceof Error ? error.message : 'Unknown parsing error';
        errors.push({
          code: 'internal/unknown',
          phase: 'parse',
          message,
          reason: message,
          fix: 'Check the file syntax and ensure it is valid.',
          file: context.file,
          filePath,
          line: 1,
          column: 1,
          lines: extractRelevantLines(source, 1)
        });
      }
      return { errors, warnings };
    }

    return { tree, errors, warnings };
  }
}

const scssPlugin = ((opts?: ScssPluginOptions) => new ScssPlugin(opts)) satisfies Plugin;

export default scssPlugin;
