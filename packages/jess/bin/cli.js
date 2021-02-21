#!/usr/bin/env node
const render = require('../lib/render').render
const yargs = require('yargs/yargs')
const fs = require('fs')
const path = require('path')
const chalk = require('chalk')

const rollup = require('rollup')
const commonJs = require('@rollup/plugin-commonjs')
const nodeResolve = require('@rollup/plugin-node-resolve').default
const jess = require('../lib/plugin/runtime').default
const terser = require('rollup-plugin-terser').terser


const { hideBin } = require('yargs/helpers')
const args =
  yargs(hideBin(process.argv))
    .check(argv => {
      const filePaths = argv._
      if (!filePaths.length) {
        throw new Error(chalk.yellow('Input filename required.'))
      } else {
        return true
      }
    })
    .option('o', {
      alias: 'out',
      describe: 'Output folder',
      type: 'string'
    })
    .option('b', {
      alias: 'bundle',
      default: false,
      type: 'boolean',
      describe: 'Create a runtime bundle module'
    })
    .example([
      ['$0 input.jess', 'Compile to input.css'],
      ['$0 input.jess output.css', 'Customize output file'],
      ['$0 input.jess -o dist', 'Output to the dist directory']
    ])

const argv = args.argv

const start = async () => {
  const startTime = new Date()
  const files = argv._
  const inFile = files[0]
  let cssFile = files[1] || inFile.replace(/\.jess/, '.css')
  const outDir = path.resolve(process.cwd(), argv.o || path.dirname(cssFile))
  cssFile = path.basename(cssFile)

  try {
    const hasErr = await fs.promises.access(path.resolve(process.cwd(), inFile), fs.constants.R_OK)
    if (hasErr) {
      throw ''
    }
  } catch (e) {
    throw new Error(`Could not read "${inFile}"`)
  }
  
  let css

  if (argv.b) {
    const bundle = await rollup.rollup({
      input: inFile,
      plugins: [
        commonJs(),
        nodeResolve(),
        jess()
      ]
    })
    const { output } = await bundle.generate({
      plugins: [terser()]
    })
    const js = output[0].code
    const jsFile = cssFile.replace(/\.css/, '.js')
    await fs.promises.writeFile(path.resolve(outDir, jsFile), js)
    css = output[1].source
  } else {
    /** @todo - Allow setting of options in the cli? */
    /** @todo - Write bundles and map */
    const result = await render(inFile, {})
    css = result.$toCSS()
  }

  await fs.promises.writeFile(path.resolve(outDir, cssFile), css)

  const endTime = new Date()
  const seconds = Math.round((endTime - startTime) / 10) / 100
  console.log(`${chalk.blue('Finished in')} ${chalk.cyan(seconds + 's')}`)
}

start()
  .catch(e => {
    console.error(chalk.red(e.message))
  })