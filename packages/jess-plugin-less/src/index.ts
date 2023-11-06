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
  getErrorFromParser
} from '@jesscss/core'
import { Parser } from '@jesscss/less-parser'

export interface LessFileManagerOptions extends FileManagerOptions {
  plugin: PluginObject
  mathMode?: TreeContext['mathMode']
  unitMode?: TreeContext['unitMode']
}

export class LessFileManager extends FileManager<LessFileManagerOptions> {
  supportedExtensions = ['.less']
  parser = new Parser()

  async _getTree(fullPath: string, options: Record<string, any>) {
    const source = await this.loadFile(fullPath)
    /**
     * @todo - handle / pretty print errors
     * @todo - add contents to Jess error handler
     */
    const context = new TreeContext({
      parentScope: options.parentScope,
      hoistDeclarations: true,
      leakVariablesIntoScope: true,
      mathMode: this.opts.mathMode ?? MathMode.PARENS_DIVISION,
      unitMode: this.opts.unitMode ?? UnitMode.LOOSE
    })
    const { tree, errors, lexerResult } = this.parser.parse(source, 'stylesheet', { context })
    if (errors.length || lexerResult.errors.length) {
      const error = (lexerResult.errors[0] ?? errors[0])!
      throw getErrorFromParser(error, fullPath, source)
    } else {
      tree.treeContext.plugin = this.opts.plugin
      return tree
    }
  }
}

type LessOptions = Record<string, any>

/** @todo - do something with less options */
const lessPlugin: Plugin = (opts?: LessOptions) => {
  const plugin: PluginObject = {
    name: 'less'
  }
  plugin.fileManager = new LessFileManager({ ...opts, plugin })
  return plugin
}

export default lessPlugin