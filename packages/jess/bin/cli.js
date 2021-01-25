#!/usr/bin/env node
const render = require('../lib/render').render
const yargs = require('yargs/yargs')
const fs = require('fs')
const path = require('path')
const chalk = require('chalk')

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
    .example([
      ['$0 input.jess', 'Compile to input.css'],
      ['$0 input.jess output.css', 'Customize output file']
    ])

const argv = args.argv

const start = async () => {
  const startTime = new Date()
  const files = argv._
  let inFile = files[0]
  let outFile = files[1] || files[0].replace(/\.jess/, '.css')

  try {
    const hasErr = await fs.promises.access(path.resolve(process.cwd(), inFile), fs.constants.R_OK)
    if (hasErr) {
      throw ''
    }
  } catch (e) {
    throw new Error(`Could not read "${inFile}"`)
  }
  /** @todo - Allow setting of options */
  const result = await render(inFile, { global: true })

  /** @todo - Write bundles and map */
  await fs.promises.writeFile(path.resolve(process.cwd(), outFile), result.$CSS)

  const endTime = new Date()
  const seconds = Math.round((endTime - startTime) / 10) / 100
  console.log(`${chalk.blue('Finished in')} ${chalk.cyan(seconds + 's')}`)
}

start()
  .catch(e => {
    console.error(chalk.red(e.message))
  })