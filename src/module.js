const postcss = require('postcss')
const postcssNested = require('postcss-nested')
const autoprefixer = require('autoprefixer')

import {evaluator} from './evaluator/index.js'

export const compile = (filePath, imports, vars, template) => {
  const result = evaluator(filePath, imports, vars, template)

  var compiled = postcss([postcssNested, autoprefixer]).process(result.output)

  let assignments = []
  let outputModule = `
${imports.join('\n')}\n
export default (config) => {
  const {\n`
    result.variableExports.forEach(assignment => {
      assignments.push(`    ${assignment[0]} = ${assignment[1]}`)
    })
    outputModule += assignments.join(',\n') + `\n  } = config

  const vars = {\n`
    assignments = []
    result.CSSVars.forEach(CSSVar => {
      assignments.push(`    '${CSSVar[0]}': ({ try { return \`${CSSVar[1]}\` } catch(e) { return '' })()`)
    })
		outputModule += assignments.join(',\n') + `
	}

	return {
		staticCss: \`${compiled.toString().replace("`", "\`")}\`
    , cssVariables: vars\n`
  
  result.variableExports.forEach(exp => {
    outputModule += `    , ${exp[0]}\n`
  })

  outputModule += `
	}
}
  `
  console.log(outputModule)
}