#!/usr/bin/env node
const render = require('../lib/render').render
const yargs = require('yargs/yargs')
const fs = require('fs')
const path = require('path')
const chalk = require('chalk')

const rollup = require('rollup')
const commonJs = require('@rollup/plugin-commonjs')
const nodeResolve = require('@rollup/plugin-node-resolve').default
const jess = require('rollup-plugin-jess').default


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
      default: '.',
      describe: 'Output folder',
      type: 'string'
    })
    .example([
      ['$0 input.jess', 'Compile to input.css'],
      ['$0 input.jess output.css', 'Customize output file']
    ])

const argv = args.argv

const start = async () => {
  const startTime = new Date()
  const files = argv._
  let inFile = files[0]
  let outCss = files[1] || files[0].replace(/\.jess/, '.css')
  let outJs = outCss.replace(/\.css/, '.js')

  try {
    const hasErr = await fs.promises.access(path.resolve(process.cwd(), inFile), fs.constants.R_OK)
    if (hasErr) {
      throw ''
    }
  } catch (e) {
    throw new Error(`Could not read "${inFile}"`)
  }
  
  const bundle = await rollup.rollup({
    input: inFile,
    plugins: [
      commonJs(),
      nodeResolve(),
      jess()
    ]
  })
  const dir = path.resolve(process.cwd(), path.dirname(inFile), argv.o)


  /** @todo - Allow setting of options in the cli? */
  // const result = await render(inFile, {})
  await bundle.write({ dir })


  /** @todo - Write bundles and map */
  // await fs.promises.writeFile(path.resolve(process.cwd(), outCss), result.$toCSS())

  const endTime = new Date()
  const seconds = Math.round((endTime - startTime) / 10) / 100
  console.log(`${chalk.blue('Finished in')} ${chalk.cyan(seconds + 's')}`)
}

start()
  .catch(e => {
    console.error(chalk.red(e.message))
  })