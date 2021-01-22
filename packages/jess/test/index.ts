import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'
import { expect } from 'chai'
import 'mocha'
import { renderModule } from '../src/render-module'

describe('Output files', () => {
  const testData = path.join(__dirname, 'files')
  const files = glob.sync(path.join(testData, '*.jess'))
  files
    .map(value => path.relative(testData, value))
    .sort()
    .forEach(file => {
      it(`${file}`, async () => {
        const jessFile = path.join(testData, file)
        const jsFile = jessFile.replace(/\.jess$/, '.js')
        const cssFile = jessFile.replace(/\.jess$/, '.css')

        /** @todo - replace with render, which uses Rollup */
        const module = await renderModule(jessFile)
        const referenceModule = await fs.promises.readFile(jsFile)

        expect(module.code).to.equal(referenceModule.toString())

        const styles = await import(jsFile)
        const css = styles.default().$CSS
        let referenceCss = (await fs.promises.readFile(cssFile)).toString()
        expect(css).to.equal(referenceCss.toString())
      })
    })
})
