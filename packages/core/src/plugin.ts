import type { TreeContextOptions } from './context'
import type { Root } from './tree/root'
import { join, isAbsolute, extname } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

type PathOptions = Record<string, any> & {
  allowBareRelative?: boolean
}

export type FileManagerOptions = {
  /**
   * If the resolver can't resolve, it must return the same path.
   * You can use this to resolve alias paths, for example.
   */
  resolver: (filePath: string) => string
}

export abstract class FileManager<O extends FileManagerOptions = FileManagerOptions> {
  abstract supportedExtensions?: string[]
  opts: O

  constructor(
    opts: Partial<O> = {}
  ) {
    opts.resolver ??= filePath => filePath
    this.opts = opts as O
  }

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
  getPath(
    filePath: string,
    currentDir: string,
    paths: string[],
    options: PathOptions
  ): string | string[] {
    filePath = this.opts.resolver(filePath)
    const pathsTried: string[] = []
    if (isAbsolute(filePath)) {
      pathsTried.push(filePath)
      if (existsSync(filePath)) {
        return filePath
      }
    }
    let isRelative = filePath.startsWith('.')
    let tryPath: string | undefined
    if (options.allowBareRelative || isRelative) {
      tryPath = join(currentDir, filePath)
      pathsTried.push(tryPath)
      if (existsSync(tryPath)) {
        return tryPath
      }
    }

    if (!isRelative) {
      try {
        tryPath = require.resolve(filePath)
        if (existsSync(tryPath)) {
          return tryPath
        }
      } catch (err) {
        // ignore
      }
    }

    for (let i = 0; i < paths.length; i++) {
      tryPath = join(paths[i]!, filePath)
      pathsTried.push(tryPath)
      if (existsSync(tryPath)) {
        return tryPath
      }
    }
    return pathsTried
  }

  async loadFile(fullPath: string) {
    return await readFile(fullPath, 'utf8')
  }

  /**
   * Can override this instead of `getTree` if we want
   * to preserve extension-checking logic.
   */
  protected async _getTree(fullPath: string, options?: Record<string, any>): Promise<Root | false> {
    return false
  }

  /**
   * @param fullPath The fully resolved path
   */
  async getTree(fullPath: string, options?: Record<string, any>): Promise<Root | false> {
    const supported = this.supportedExtensions
    if (supported && !supported.includes(extname(fullPath))) {
      return false
    }
    return await this._getTree(fullPath, options)
  }
}

export type PluginObject = {
  /**
   * Will be the key name used if passing
   * an explicit type.
   * e.g. 'less'
   */
  name: string
  fileManager?: FileManager
}

export type Plugin = <T extends TreeContextOptions>(opts?: T) => PluginObject