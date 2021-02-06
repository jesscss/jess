import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'
import { expect } from 'chai'
import 'mocha'
import { render } from 'jess/lib/render'

describe('Output files', () => {
  const testData = path.join(__dirname, 'files')
  const files = glob.sync(path.join(testData, '*.jess'))
  files
    .map(value => path.relative(testData, value))
    .sort()
    .forEach(file => {
      it(`${file}`, async () => {
        const jessFile = path.join(testData, file)
        const cssFile = jessFile.replace(/\.jess$/, '.css')

        const output = await render(jessFile)
        let referenceCss = (await fs.promises.readFile(cssFile)).toString()
        expect(output.$toCSS()).to.equal(referenceCss.toString())
      })
    })
})
