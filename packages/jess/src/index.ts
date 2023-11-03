import * as path from 'path'
import { getConfig } from './config'
import {
  Context,
  type TreeContextOptions,
  type PluginObject
} from '@jesscss/core'
import merge from 'lodash-es/merge'

export type ConfigOptions = TreeContextOptions & {
  plugins?: PluginObject[]
}

export class JessCompiler {
  constructor(
    public opts: ConfigOptions = {}
  ) {}

  /**
   * Render CSS and (optionally) a runtime module
   */
  async render(filePath: string) {
    const opts: ConfigOptions = merge({}, this.opts, getConfig(path.dirname(filePath)))
    const { plugins, ...rest } = opts
    const context = new Context(rest, plugins)
    const tree = context.getTree(filePath, process.cwd())
    const evald = await tree.eval(context)
    const css = evald.toString()
    return css
  }
}
