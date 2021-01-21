import { Context } from './context'
import { OutputCollector } from './output'
import * as fs from 'fs'
import * as path from 'path'
import { parse } from './parser'

const hashCode = (str: string) => {
  var hash = 0
  for (let i = 0; i < str.length; i++) {
    let chr = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0 // Convert to 32bit integer
  }
  return hash
}

export const renderModule = async (filePath: string) => {
  const readPath = path.resolve(process.cwd(), filePath)
  try {
    const contents = await fs.promises.readFile(readPath)
    const root = await parse(contents.toString(), {
      filename: filePath,
      rootpath: process.cwd()
    })
    const context = new Context
    context.id = hashCode(readPath).toString(16)
    const out = new OutputCollector
    /** 
     * We evaluate the tree but don't return it.
     * We just want to attach eval'd classes to
     * the default function. 
     */
    root.eval(context)
    root.toModule(context, out)
    return {
      code: out.toString()
    }
  } catch (e) {
    /**
     * @todo - format errors a la eslint
     */
    if (e.errors) {
      e.errors.forEach(err => {
        console.error(err.message)
      })
    }
  }
}
