import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'
import { expect } from 'chai'
import 'mocha'
import { render } from '../src/render'

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
        const output = await render(jessFile)
        const referenceModule = await fs.promises.readFile(jsFile)

        expect(output.$JS).to.equal(referenceModule.toString())

        let referenceCss = (await fs.promises.readFile(cssFile)).toString()
        expect(output.$CSS).to.equal(referenceCss.toString())
      })
    })
})
