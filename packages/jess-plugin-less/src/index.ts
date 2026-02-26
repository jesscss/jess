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
import { expandLessImportCandidates } from '@jesscss/style-resolver';

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
      unitMode = 'preserve';
    }
    this.unitMode = unitMode;
    this.leakyRules = opts.leakyRules ?? true;
    this.bubbleRootAtRules = opts.bubbleRootAtRules ?? true;
    this.collapseNesting = opts.collapseNesting ?? false;

    // Pass options to parser (including leakyRules, defaulting to true)
    this.parser = new Parser();
  }

  private _registerFunctions(tree: Rules) {
    const registeredNames: string[] = [];
    for (const [key, value] of Object.entries(lessFunctions)) {
      if (typeof value !== 'function') {
        continue;
      }
      const runtimeName = ((value as any).name as string | undefined) ?? key;
      tree.register('function', new JsFunction({ name: runtimeName, fn: value as (...args: any[]) => any }));
      registeredNames.push(runtimeName);
    }
    const expected = ['replace', '%', 'iscolor', 'iskeyword', 'isnumber', 'isstring', 'isunit', 'get-unit'];
    const missingExpected = expected.filter(name => !registeredNames.includes(name));
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '34ceef'
      },
      body: JSON.stringify({
        sessionId: '34ceef',
        runId: 'function-resolution',
        hypothesisId: 'H2',
        location: 'packages/jess-plugin-less/src/index.ts:_registerFunctions',
        message: 'Registered Less function names',
        data: {
          total: registeredNames.length,
          missingExpected,
          hasAdd: registeredNames.includes('add'),
          hasIncrement: registeredNames.includes('increment'),
          hasUnderscoreColor: registeredNames.includes('_color'),
          hasBoolean: registeredNames.includes('boolean'),
          hasIf: registeredNames.includes('if'),
          hasPi: registeredNames.includes('pi'),
          hasPow: registeredNames.includes('pow'),
          hasMod: registeredNames.includes('mod'),
          hasHsvHue: registeredNames.includes('hsvhue'),
          hasHsvSaturation: registeredNames.includes('hsvsaturation'),
          hasHsvValue: registeredNames.includes('hsvvalue')
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
  }

  expandImport(importPath: string, currentDir: string) {
    void currentDir;
    // Keep import expansion in sync with the language service.
    return expandLessImportCandidates(importPath);
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

      // Convert parser deprecation warnings to diagnostics
      if ('warnings' in parseResult && parseResult.warnings) {
        for (const warning of parseResult.warnings) {
          const line = warning.token?.startLine ?? 1;
          const column = warning.token?.startColumn ?? 1;
          warnings.push({
            code: 'parse/deprecated',
            phase: 'parse',
            message: warning.message,
            reason: warning.message,
            fix: 'Update your code to use the recommended syntax.',
            file: context.file,
            filePath: filePath,
            line,
            column,
            lines: extractRelevantLines(source, line)
          });
        }
      }

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
          code: 'internal/unknown',
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