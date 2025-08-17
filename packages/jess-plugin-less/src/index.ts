import {
  type Plugin,
  type PluginObject,
  FileManager,
  type FileManagerOptions,
  TreeContext,
  MathMode,
  UnitMode,
  JessError,
  logger,
  JsFunction,
  type Rules,
  getErrorFromParser
} from '@jesscss/core';
import * as lessFunctions from '@jesscss/fns/lib/less';
import { Parser } from '@jesscss/less-parser';

export interface LessFileManagerOptions extends FileManagerOptions {
  plugin: PluginObject;
  mathMode?: TreeContext['mathMode'];
  unitMode?: TreeContext['unitMode'];
}

export class LessFileManager extends FileManager<LessFileManagerOptions> {
  supportedExtensions = ['.less'];
  parser = new Parser();

  private _registerFunctions(tree: Rules) {
    for (const [key, value] of Object.entries(lessFunctions)) {
      tree.register('function', new JsFunction({ name: key, fn: value }));
    }
  }

  async _getTree(fullPath: string, options: Record<string, any>) {
    const source = await this.loadFile(fullPath);
    /**
     * @todo - handle / pretty print errors
     * @todo - add contents to Jess error handler
     */
    const context = new TreeContext({
      hoistDeclarations: true,
      /** @todo - write a test to make sure `@use` doesn't leak */
      leakVariablesIntoScope: true,
      mathMode: this.opts.mathMode ?? MathMode.PARENS_DIVISION,
      unitMode: this.opts.unitMode ?? UnitMode.LOOSE
    });
    const { tree, errors, lexerResult } = this.parser.parse(source, 'stylesheet', { context });
    if (errors.length || lexerResult.errors.length) {
      const error = (lexerResult.errors[0] ?? errors[0])!;
      throw getErrorFromParser(error, fullPath, source);
    } else {
      this._registerFunctions(tree);
      tree.treeContext.plugin = this.opts.plugin;
      return tree;
    }
  }
}

type LessOptions = Record<string, any>;

/** @todo - do something with less options */
const lessPlugin: Plugin = (opts?: LessOptions) => {
  const plugin: PluginObject = {
    name: 'less'
  };
  plugin.fileManager = new LessFileManager({ ...opts, plugin });
  return plugin;
};

export default lessPlugin;