
const DeepProxy = require('proxy-deep')
const transform = require('es6-module-jstransform')
const path = require('path')

const store = obj => {
	return new DeepProxy(obj, {
		get(target, path, receiver) {
      const val = Reflect.get(target, path, receiver)

			if (typeof val === 'object' && val !== null) {
				return this.nest(val)
			} else {
				let fullPath = this.path.concat(path)
				if (val !== undefined) {
					if (obj._DYNAMIC.indexOf(fullPath[0]) > -1) {
						obj._DYNAMIC_ACCESSED = true
					} else {
						obj._DYNAMIC_ACCESSED = false
					}
					return val
				}
				return ''
			}
		}
	})
}

function evaluate (filePath, imports, vars, template) {
  const variableExports = []
  const CSSVars = []
  const errors = []
  const hash = Math.random().toString(36).substr(2, 6)

  const _SCOPE = {
    _IMPORTS: [],
    _VARS: vars,
    _DYNAMIC: [],
    _DYNAMIC_ACCESSED: false
  }

  const dirname = path.dirname(filePath)
  const requireRelative = function(id) {
    var str = id.substr(0, 2);
    if (str === '..' || str === './') {
      return require(path.join(dirname, id));
    }
    else {
      return require(id);
    }
  }

  imports.forEach(imp => {
    _SCOPE._IMPORTS.push(transform(imp).code)
  })

  const _CONTEXT = store(_SCOPE)

  const evaluator = fragment => {
    let functionBody = _SCOPE._IMPORTS.join('\n') +
    "\nlet _RETURN_VALUE; with(this) { _RETURN_VALUE = " + fragment + " }" +
      "return [_RETURN_VALUE, this._DYNAMIC_ACCESSED]"
    try {
      return new Function("require", functionBody).call(_CONTEXT, requireRelative)
    } catch(e) {
      errors.push([e, fragment])
    }
  }

  _SCOPE._VARS.forEach((item) => {
    const varName = item[0]
    const varStringValue = item[1]

    const test = evaluator(varStringValue)
    const evalValue = test[0]

    _SCOPE[varName] = evalValue
    if (item[2] === 1) {
      _SCOPE._DYNAMIC.push(varName)
      variableExports.push([varName, varStringValue])
    } else {
      variableExports.push([varName, JSON.stringify(test[0])])
    }
  })

  const output = template.map((fragment, i) => {
    const test = evaluator('`' + fragment.replace('`', '\`') + '`')
    if (test[1] === true) {
      let cssVar = `--var-${hash}-${i}`
      CSSVars.push([cssVar, fragment])
      return `var(${cssVar}, ${test[0]})`
    }
    return test[0]
  }).join('')

  return {
    output,
    CSSVars,
    variableExports
  }
}

module.exports = evaluate
