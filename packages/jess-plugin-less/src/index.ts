import {
  type Plugin,
  type PluginInterface,
  AbstractPlugin,
  TreeContext,
  JessError,
  logger,
  JsFunction,
  Rules,
  getErrorFromParser,
  toDiagnostic,
  extractRelevantLines,
  type ISafeParseResult,
  type ErrorDiagnostic,
  type WarningDiagnostic
} from '@jesscss/core';
import type { MathMode, UnitMode, LessOptions } from 'styles-config';
import * as lessFunctions from '@jesscss/fns';
import { Parser } from '@jesscss/less-parser';
import path from 'node:path';

export class LessPlugin extends AbstractPlugin {
  name = 'less';
  supportedExtensions = ['.less'];
  parser: Parser;
  mathMode: MathMode;
  unitMode: UnitMode;
  leakyRules: boolean;
  bubbleRootAtRules: boolean;
  collapseNesting: boolean;

  constructor(public opts: LessOptions = {}) {
    super();

    // Handle deprecated math option -> mathMode conversion
    let mathMode: MathMode;
    if (opts.mathMode !== undefined) {
      mathMode = opts.mathMode;
    } else if (opts.math !== undefined) {
      // Convert deprecated math option to mathMode
      if (opts.math === 0 || opts.math === 'always') {
        mathMode = 'always';
      } else if (opts.math === 1 || opts.math === 'parens-division') {
        mathMode = 'parens-division';
      } else if (opts.math === 2 || opts.math === 'parens' || opts.math === 'strict') {
        mathMode = 'parens';
      } else {
        // 3 or 'strict-legacy' -> 'parens' (deprecated, use 'strict' instead)
        mathMode = 'parens';
      }
    } else {
      mathMode = 'parens-division';
    }
    this.mathMode = mathMode;

    // Handle deprecated strictUnits option -> unitMode conversion
    let unitMode: UnitMode;
    if (opts.unitMode !== undefined) {
      unitMode = opts.unitMode;
    } else if (opts.strictUnits === true) {
      unitMode = 'strict';
    } else {
      unitMode = 'loose';
    }
    this.unitMode = unitMode;
    this.leakyRules = opts.leakyRules ?? true;
    this.bubbleRootAtRules = opts.bubbleRootAtRules ?? true;
    this.collapseNesting = opts.collapseNesting ?? false;

    // Pass options to parser (including leakyRules, defaulting to true)
    this.parser = new Parser();
  }

  private _registerFunctions(tree: Rules) {
    for (const [key, value] of Object.entries(lessFunctions)) {
      tree.register('function', new JsFunction({ name: key, fn: value }));
    }
  }

  expandImport(importPath: string, currentDir: string) {
    const ext = path.extname(importPath);
    if (ext !== '.less') {
      return [`${importPath}.less`, `${importPath}`];
    }
    return [importPath];
  }

  safeParse(filePath: string, source: string): ISafeParseResult {
    const context = new TreeContext({
      file: {
        name: path.basename(filePath),
        path: path.dirname(filePath),
        fullPath: filePath,
        source: source
      },
      mathMode: this.mathMode,
      unitMode: this.unitMode,
      plugin: this,
      collapseNesting: this.collapseNesting,
      leakyRules: this.leakyRules,
      bubbleRootAtRules: this.bubbleRootAtRules
    });

    const errors: ErrorDiagnostic[] = [];
    const warnings: WarningDiagnostic[] = [];
    let tree: Rules | undefined;

    try {
      const parseResult = this.parser.parse(source, 'stylesheet', { context });
      tree = parseResult.tree;

      // Convert all parser/lexer errors to normalized diagnostics
      if (parseResult.errors.length || parseResult.lexerResult?.errors?.length) {
        // Convert each parser error to a diagnostic
        for (const error of parseResult.errors) {
          const line = error.token?.startLine ?? (error as any).line ?? 1;
          const jessError = getErrorFromParser([error], undefined, filePath, source, { file: context.file });
          const diagnostic = toDiagnostic(jessError);
          // Ensure lines are extracted
          if (!diagnostic.lines) {
            diagnostic.lines = extractRelevantLines(source, line);
          }
          if ('errors' in diagnostic) {
            errors.push(diagnostic);
          } else {
            warnings.push(diagnostic);
          }
        }
        // Convert lexer errors
        if (parseResult.lexerResult?.errors) {
          for (const lexError of parseResult.lexerResult.errors) {
            const line = (lexError as any).line ?? 1;
            const jessError = getErrorFromParser([], [lexError], filePath, source, { file: context.file });
            const diagnostic = toDiagnostic(jessError);
            // Ensure lines are extracted
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
      }
    } catch (error: any) {
      // Convert caught error to diagnostic
      if (error && typeof error === 'object' && 'severity' in error) {
        const diagnostic = toDiagnostic(error as JessError);
        if ('errors' in diagnostic) {
          errors.push(diagnostic);
        } else {
          warnings.push(diagnostic);
        }
      } else {
        errors.push({
          code: 'JESS0000',
          phase: 'parse',
          message: error?.message || 'Unknown parsing error',
          reason: error?.message || 'An unexpected error occurred during parsing.',
          fix: 'Check the file syntax and ensure it is valid.',
          file: context.file,
          filePath: filePath,
          line: 1,
          column: 1,
          lines: extractRelevantLines(source, 1)
        });
      }
      // Return with errors/warnings only (no tree)
      return { errors, warnings };
    }

    // Only register functions if parsing succeeded without errors
    if (tree && errors.length === 0) {
      this._registerFunctions(tree);
    }

    return {
      tree,
      errors,
      warnings
    };
  }
}

export type { LessOptions } from 'styles-config';

const lessPlugin = ((opts?: LessOptions) => {
  return new LessPlugin(opts);
}) satisfies Plugin;

export default lessPlugin;