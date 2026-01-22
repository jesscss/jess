import {
  type Plugin,
  AbstractPlugin,
  TreeContext,
  type ISafeParseResult,
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

export type ScssPluginOptions = {
  /**
   * Whether to collapse nested selectors (flatten nesting during print).
   * This is a Jess output option, not a Sass option.
   */
  collapseNesting?: boolean;
};

export class ScssPlugin extends AbstractPlugin {
  name = 'scss';
  supportedExtensions = ['.scss'];
  parser: Parser;

  constructor(public opts: ScssPluginOptions = {}) {
    super();
    this.parser = new Parser();
  }

  expandImport(importPath: string) {
    // Keep import expansion in sync with the language service.
    return expandScssImportCandidates(importPath);
  }

  safeParse(filePath: string, source: string): ISafeParseResult {
    const context = new TreeContext({
      file: {
        name: path.basename(filePath),
        path: path.dirname(filePath),
        fullPath: filePath,
        source
      },
      plugin: this,
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
          if ('errors' in diagnostic) errors.push(diagnostic);
          else warnings.push(diagnostic);
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
          if ('errors' in diagnostic) errors.push(diagnostic);
          else warnings.push(diagnostic);
        }
      }
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'severity' in error) {
        const diagnostic = toDiagnostic(error as JessError);
        if ('errors' in diagnostic) errors.push(diagnostic);
        else warnings.push(diagnostic);
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