import {
  type Plugin,
  type PluginInterface,
  AbstractPlugin,
  TreeContext,
  MathMode,
  UnitMode,
  JessError,
  logger,
  JsFunction,
  type Rules,
  getErrorFromParser
} from '@jesscss/core';
import * as lessFunctions from '@jesscss/fns';
import { Parser } from '@jesscss/less-parser';
import path from 'node:path';

const { isArray } = Array;

export class LessPlugin extends AbstractPlugin {
  name = 'less';
  supportedExtensions = ['.less'];
  parser = new Parser();

  constructor(
    public opts: Record<string, any> = {},
    public mathMode: MathMode = opts.mathMode ?? MathMode.PARENS_DIVISION,
    public unitMode: UnitMode = opts.unitMode ?? UnitMode.LOOSE
  ) {
    super();
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

  async parse(filePath: string, source: string) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jess-plugin-less/index.ts:47',message:'LessPlugin.parse entry',data:{filePath,sourceLength:source.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
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
      hoistDeclarations: true,
      /** @todo - write a test to make sure `@use` doesn't leak */
      leakVariablesIntoScope: true,
      mathMode: this.mathMode,
      unitMode: this.unitMode,
      plugin: this,
      collapseNesting: this.opts.collapseNesting
    });
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jess-plugin-less/index.ts:66',message:'LessPlugin.parse calling parser.parse',data:{filePath,sourceLength:source.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    let tree: Rules;
    let errors: any[];
    let lexerResult: any;
    try {
      const parseResult = this.parser.parse(source, 'stylesheet', { context });
      tree = parseResult.tree;
      errors = parseResult.errors;
      lexerResult = parseResult.lexerResult;
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jess-plugin-less/index.ts:71',message:'LessPlugin.parse parser.parse completed',data:{filePath,errorsCount:errors.length,lexerErrorsCount:lexerResult.errors.length,treeType:tree?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jess-plugin-less/index.ts:75',message:'LessPlugin.parse parser.parse error',data:{filePath,error:error?.toString(),errorMessage:error?.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      throw error;
    }
    if (errors.length || lexerResult.errors.length) {
      const error = (lexerResult.errors[0] ?? errors[0])!;
      throw getErrorFromParser(error, filePath, source);
    } else {
      this._registerFunctions(tree);
      return tree;
    }
  }
}

type LessOptions = Record<string, any>;

/** @todo - do something with less options */
const lessPlugin: Plugin = (opts?: LessOptions) => {
  return new LessPlugin(opts);
};

export default lessPlugin;