import * as path from 'path'
import { getConfig } from './config'
import {
  Context,
  type TreeContextOptions,
  type PluginObject,
  type JessError,
  logger
} from '@jesscss/core'
import merge from 'lodash-es/merge'
import lessPlugin from 'jess-plugin-less'

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
    /** @todo Add CSS and Jess plugins */
    let corePlugins = [
      lessPlugin()
    ]
    const pluginMap = new Map<string, PluginObject>()
    for (const plugin of corePlugins) {
      pluginMap.set(plugin.name, plugin)
    }
    if (plugins) {
      for (const plugin of plugins) {
        pluginMap.set(plugin.name, plugin)
      }
    }
    const context = new Context(rest, [...pluginMap.values()])
    // eslint-disable-next-line @typescript-eslint/await-thenable
    try {
      const tree = await context.getTree(filePath, process.cwd())
      const evald = await tree.eval(context)
      const css = evald.toString()
      return css
    } catch (err: any) {
      logger.error(err.toString())
      throw err
    }
  }
}
