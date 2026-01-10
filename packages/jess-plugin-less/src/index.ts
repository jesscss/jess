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
  type ISafeParseResult
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
    /**
     * @todo - handle / pretty print errors
     * @todo - add contents to Jess error handler
     */
    const context = new TreeContext({
      file: {
        name: path.basename(filePath),
        path: path.dirname(filePath),
        fullPath: filePath
      },
      mathMode: this.mathMode,
      unitMode: this.unitMode,
      plugin: this,
      collapseNesting: this.collapseNesting,
      leakyRules: this.leakyRules,
      bubbleRootAtRules: this.bubbleRootAtRules
    });
    let tree: Rules;
    let errors: any[];
    let lexerResult: any;
    try {
      const parseResult = this.parser.parse(source, 'stylesheet', { context });
      tree = parseResult.tree;
      errors = parseResult.errors;
      lexerResult = parseResult.lexerResult;
    } catch (error: any) {
      return { errors: [error] };
    }

    if (!errors.length && !lexerResult.errors.length) {
      this._registerFunctions(tree);
    }
    return { tree, errors, lexerResult };
  }
}

export type { LessOptions } from 'styles-config';

const lessPlugin = ((opts?: LessOptions) => {
  return new LessPlugin(opts);
}) satisfies Plugin;

export default lessPlugin;