import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'
import { invalidLess } from '@jesscss/shared'
import { JessCompiler } from '../src'

const testData = path.dirname(require.resolve('@less/test-data'))

const compiler = new JessCompiler()

describe('Can render Less files to CSS', () => {
  const files = glob.sync(path.join(testData, 'less/**/*.less'))
  files
    .map(value => path.relative(testData, value))
    .filter(value => !invalidLess.includes(value))
    .sort()
    .forEach(file => {
      it(`${file}`, async () => {
        const lessPath = path.join(testData, file)
        const cssPath = lessPath.replace(/\.less$/, '.css').replace('/less/', '/css/')
        const css = fs.readFileSync(cssPath).toString()
        const output = compiler.render(lessPath)
        expect(output).toBe(css)
      })
    })
})