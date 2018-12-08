/**
// Anything without "from", preserve
@import {vars} from '';
@import "something.css";

@fixed something = 'value';
@fixed colors = {foreground: 'red'};

.box {
	foo: ${something};
}
 */

const DeepProxy = require('proxy-deep')

const root = (typeof self === 'object' && self.self === self && self) ||
	(typeof global === 'object' && global.global === global && global) ||
	this

// let builtins
// (() => {
// 	const {JSON, Object, Function, Array, String, Boolean, Number, Date, RegExp} = root
// 	builtins = {JSON, Object, Function, Array, String, Boolean, Number, Date, RegExp}
// })()

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

const def = config => {
	const eval = () => {

		const hash = Math.random().toString(36).substr(2, 9)
		const _VARS = {
			_DYNAMIC: [],
			_DYNAMIC_ACCESSED: false
		}

		const template = [
			'.box {\n  .foo: ',
			'${something}',
			' ',
			'${colors.foreground.a}',
			' ',
			'${blah}',
			';\n}'
		]

		// vars 0 = fixed, 1 = dynamic
		_VARS.something = 'value'
		_VARS.colors = {foreground: {a: 'red'}}
		_VARS.blah = 'foo'
		_VARS._DYNAMIC = ['blah', 'colors']

		const _CONTEXT = store(_VARS)

		const CSSVars = []

		const output = template.map((fragment, i) => {
			const func = new Function(
				"let val; with(this) { val = `" + fragment + "`}" +
				"return [val, this._DYNAMIC_ACCESSED]"
			)
			const test = func.call(_CONTEXT)
			if (test[1] === true) {
				let cssVar = `--var-${hash}-${i}`
				CSSVars.push(cssVar, function() { return func.call(_CONTEXT)[0] })
				return `var(${cssVar}, ${test[0]})`
			}
			return test[0]
		})
		console.log(CSSVars)
		return output.join('')
	}
	return eval()
}

console.log(def())