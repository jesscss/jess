import type { TreeContextOptions } from './context'
import type { Root } from './tree/root'
import * as path from 'node:path'

export abstract class FileManager {
  abstract supportedExtensions: string[]
  /**
   * @param filePath Will be a partial path
   * @param paths The paths to search. This should always contain
   * the directory context where the file was imported. Can be
   * a fully-qualified path or a glob. Relative paths
   * will be resolved relative to process.cwd(). Plugins
   * may alter the paths array and return false to let another
   * plugin handle the path resolution.
   * @param options Determined by the file manager
   */
  abstract getPath(filePath: string, paths: string[], options: Record<string, any>): string | false

  /**
   * Can override this instead of `getTree` if we want
   * to preserve extension-checking logic.
   */
  protected _getTree(fullPath: string): Root | false {
    return false
  }

  /**
   * @param fullPath The fully resolved path
   */
  getTree(fullPath: string): Root | false {
    if (!this.supportedExtensions.includes(path.extname(fullPath))) {
      return false
    }
    return this._getTree(fullPath)
  }
}

export type PluginObject = {
  /**
   * Will be the key name used if passing
   * an explicit type.
   * e.g. 'less'
   */
  name: string
  /** e.g. '.less' */
  ext: string
  fileManager: FileManager
}

export type Plugin = (opts: TreeContextOptions) => PluginObject