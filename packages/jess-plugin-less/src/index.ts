import {
  type Plugin,
  type PluginObject,
  FileManager,
  type FileManagerOptions
} from '@jesscss/core'
import { Parser } from '@jesscss/less-parser'

export interface LessFileManagerOptions extends FileManagerOptions {
  plugin: PluginObject
}

export class LessFileManager extends FileManager<LessFileManagerOptions> {
  supportedExtensions = ['.less']
  parser = new Parser()

  async _getTree(fullPath: string, options: Record<string, any>) {
    const file = await this.loadFile(fullPath)
    /**
     * @todo - handle / pretty print errors
     * @todo - add contents to Jess error handler
     */
    const { tree, contents } = this.parser.parse(file, 'stylesheet')
    tree.treeContext.plugin = this.opts.plugin
    return tree
  }
}

type LessOptions = Record<string, any>

/** @todo - do something with less options */
const lessPlugin: Plugin = (opts?: LessOptions) => {
  const plugin: PluginObject = {
    name: 'less'
  }
  plugin.fileManager = new LessFileManager({ plugin })
  return plugin
}

export default lessPlugin