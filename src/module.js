const postcss = require('postcss')
const postcssNested = require('postcss-nested')
const autoprefixer = require('autoprefixer')

import {evaluator} from './evaluator/index.js'

export const compile = (filePath, imports, vars, template) => {
  const result = evaluator(filePath, imports, vars, template)

  console.log(result)

  var compiled = postcss([postcssNested, autoprefixer]).process(result.output)

  console.log(compiled.toString())
}