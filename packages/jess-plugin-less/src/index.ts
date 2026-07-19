import {
  type Plugin,
  AbstractPlugin,
  TreeContext,
  JessError,
  JsFunction,
  Rules,
  getErrorFromParser,
  toDiagnostic,
  extractRelevantLines,
  type ISafeParseResult,
  type SafeParseOptions,
  type ErrorDiagnostic,
  type WarningDiagnostic
} from '@jesscss/core';
import type { EqualityMode, MathMode, UnitMode, LessOptions } from 'styles-config';
import * as lessFunctions from '@jesscss/fns';
import { Parser } from '@jesscss/less-parser/jess';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expandLessImportCandidates } from '@jesscss/style-resolver';

export type LessPluginOptions = LessOptions;

/**
 * The Less plugin's default option values — the single source of truth for the
 * v5 defaults. The `LessPlugin` constructor fills any unset option from here,
 * and the `lessc` CLI imports the same object so its defaults can never drift
 * from the engine's. Note `collapseNesting: false` — v5 preserves nesting by
 * default (Less 4.x flattened; that is now an explicit opt-in).
 */
export const lessPluginDefaults = {
  mathMode: 'parens-division' as MathMode,
  unitMode: 'preserve' as UnitMode,
  equalityMode: 'less' as EqualityMode,
  leakyScope: true,
  bubbleRootAtRules: true,
  collapseNesting: false
} as const;

/**
 * The 1-based source position of a parser diagnostic, read from its optional
 * token (the recursive parser tags deprecation warnings with a token; the
 * functional parser reports point diagnostics without one). Absent token → the
 * `1,1` fallback used for the code-frame line lookup.
 */
function diagnosticStart(d: { message?: string; token?: { startLine?: number; startColumn?: number } }): { line: number; column: number } {
  return { line: d.token?.startLine ?? 1, column: d.token?.startColumn ?? 1 };
}

export class LessPlugin extends AbstractPlugin {
  name = 'less';
  supportedExtensions = ['.less'];
  parser: Parser;
  mathMode: MathMode;
  unitMode: UnitMode;
  equalityMode: EqualityMode;
  leakyScope: boolean;
  bubbleRootAtRules: boolean;
  collapseNesting: boolean;

  constructor(public opts: LessPluginOptions = {}) {
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
      mathMode = lessPluginDefaults.mathMode;
    }
    this.mathMode = mathMode;

    // Handle deprecated strictUnits option -> unitMode conversion
    let unitMode: UnitMode;
    if (opts.unitMode !== undefined) {
      unitMode = opts.unitMode;
    } else if (opts.strictUnits === true) {
      unitMode = 'strict';
    } else {
      unitMode = lessPluginDefaults.unitMode;
    }
    this.unitMode = unitMode;
    this.equalityMode = opts.equalityMode ?? lessPluginDefaults.equalityMode;
    this.leakyScope = opts.leakyScope ?? lessPluginDefaults.leakyScope;
    this.bubbleRootAtRules = opts.bubbleRootAtRules ?? lessPluginDefaults.bubbleRootAtRules;
    this.collapseNesting = opts.collapseNesting ?? lessPluginDefaults.collapseNesting;

    // mathMode (and every other option) reaches the parser via the per-file
    // TreeContext threaded into parse() — no constructor config needed.
    this.parser = new Parser();
  }

  private createTreeContext(filePath: string, source: string): TreeContext {
    return new TreeContext({
      file: {
        name: path.basename(filePath),
        path: path.dirname(filePath),
        fullPath: filePath,
        source: source
      },
      mathMode: this.mathMode,
      unitMode: this.unitMode,
      equalityMode: this.equalityMode,
      plugin: this,
      allowExtendSelectors: (this.opts as LessOptions & { allowExtendSelectors?: string[] }).allowExtendSelectors,
      collapseNesting: this.collapseNesting,
      leakyScope: this.leakyScope,
      bubbleRootAtRules: this.bubbleRootAtRules
    });
  }

  private _registerFunctions(tree: Rules) {
    const registeredNames: string[] = [];
    for (const [key, value] of Object.entries(lessFunctions)) {
      if (typeof value !== 'function') {
        continue;
      }
      const runtimeName = value.name || key;
      tree.setFunctionBinding(runtimeName, new JsFunction({ name: runtimeName, fn: value }));
      registeredNames.push(runtimeName);
    }
  }

  expandImport(importPath: string, currentDir: string) {
    void currentDir;
    // Keep import expansion in sync with the language service.
    return expandLessImportCandidates(importPath);
  }

  override resolve(filePath: string | string[], currentDir: string, searchPaths: string[]) {
    const paths = Array.isArray(filePath) ? filePath : [filePath];
    const mapped = paths.map((candidate) => {
      if (candidate.startsWith('@less/test-import-module/')) {
        const after = candidate.slice('@less/test-import-module/'.length);
        const marker = `${path.sep}packages${path.sep}test-data${path.sep}`;
        const idx = currentDir.indexOf(marker);
        if (idx !== -1) {
          const packagesRoot = currentDir.slice(0, idx + `${path.sep}packages`.length);
          return path.join(packagesRoot, 'test-import-module', after);
        }
      }
      const m = candidate.match(/^https?:\/\/cdn\.jsdelivr\.net\/npm\/([^?#]+)(?:[?#].*)?$/i);
      if (m?.[1]) {
        return m[1];
      }
      const mProtocolRelative = candidate.match(/^\/\/cdn\.jsdelivr\.net\/npm\/([^?#]+)(?:[?#].*)?$/i);
      if (mProtocolRelative?.[1]) {
        return mProtocolRelative[1];
      }
      return candidate;
    });

    const resolved = super.resolve(mapped, currentDir, searchPaths);
    const out = [...resolved];
    const bases = [currentDir, ...searchPaths, process.cwd()];
    const looksBareSpecifier = (p: string) =>
      !path.isAbsolute(p)
      && !p.startsWith('./')
      && !p.startsWith('../')
      && !p.startsWith('/')
      && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p);

    for (const candidate of mapped) {
      if (!looksBareSpecifier(candidate)) {
        continue;
      }
      for (const base of bases) {
        const baseDir = path.isAbsolute(base) ? base : path.resolve(currentDir, base);
        try {
          const req = createRequire(path.join(baseDir, '__jess_resolve__.js'));
          const resolvedModule = req.resolve(candidate);
          if (!out.includes(resolvedModule)) {
            out.push(resolvedModule);
          }
          break;
        } catch {
          try {
            const req = createRequire(path.join(baseDir, '__jess_resolve__.js'));
            const resolvedModuleLess = req.resolve(`${candidate}.less`);
            if (!out.includes(resolvedModuleLess)) {
              out.push(resolvedModuleLess);
            }
            break;
          } catch {
            // keep trying other base dirs
          }
        }
      }
    }
    return out;
  }

  safeParse(filePath: string, source: string, parseOptions?: SafeParseOptions): ISafeParseResult {
    const context = this.createTreeContext(filePath, source);
    const output = parseOptions?.compilerOptions?.output;
    if (
      typeof output === 'object'
      && output !== null
      && 'sourceMap' in output
      && Boolean(output.sourceMap)
    ) {
      // The scalar POC deliberately retains the normal Dimension/Num node shape
      // when output maps are requested, because the value needs its own mapping
      // origin rather than the enclosing Declaration's span.
      context.opts.sourceMap = true;
    }

    const errors: ErrorDiagnostic[] = [];
    const warnings: WarningDiagnostic[] = [];
    let tree: Rules | undefined;

    try {
      // Thread the file-bearing TreeContext through the parse and read it back
      // out. Today it round-trips unchanged; it's the seam a future
      // `@compose`/`@use` rule uses to set `context.opts.strict` during parse.
      const parseResult = this.parser.parse(source, 'Stylesheet', { context });
      tree = parseResult.tree;
      const parsedContext = parseResult.context ?? context;

      // The functional Less parser does not attach the TreeContext to nodes, so
      // the root Rules has no `_treeContext` and import base-dir resolution falls
      // back to `process.cwd()`. Attach the (threaded) context to the root so
      // relative `@import` paths resolve against the importing file's directory
      // (`context.ts` `currentDirectory`).
      if (tree) {
        tree._treeContext = parsedContext;
      }

      // Thread the parser's whitespace/comment trivia into the render context so
      // the serializer can round-trip authored value whitespace (multi-line
      // lists, custom-property value spacing) AND inline comments. Standalone
      // comments already round-trip as `Comment` nodes; their source ranges are
      // reported so the render-time trivia view hides them (no double-emit). The
      // functional CSS parser forwards trivia the same way (cssParser.ts).
      context.opts.trivia = parseResult.trivia;
      context.opts.liftedCommentRanges = parseResult.liftedCommentRanges;

      // Convert parser deprecation warnings to diagnostics
      if ('warnings' in parseResult && parseResult.warnings) {
        for (const warning of parseResult.warnings) {
          const { line, column } = diagnosticStart(warning);
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

      // Convert parser errors to normalized diagnostics. The functional parser
      // has no separate lexer phase, so there are no lexer errors to convert.
      if (parseResult.errors.length) {
        for (const error of parseResult.errors) {
          const { line } = diagnosticStart(error);
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
      }
    } catch (error: unknown) {
      // Convert caught error to diagnostic
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
          reason: message || 'An unexpected error occurred during parsing.',
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
const lessPlugin = ((opts?: LessPluginOptions) => {
  return new LessPlugin(opts);
}) satisfies Plugin;

export default lessPlugin;
