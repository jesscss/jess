/**

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

/** https://stackoverflow.com/questions/2051678/getting-all-variables-in-scope */

const pathsAccessed = []

const store = target => {
	return new DeepProxy(target, {
		has(target, prop) { return true },
		get(target, path, receiver) {
			const val = Reflect.get(target, path, receiver) || Reflect.get(root, path, receiver)
			if (typeof val === 'object' && val !== null) {
				return this.nest(val)
			} else {
				if (typeof path === 'string') {
					pathsAccessed.push(this.path.concat(path))
				}
				return val !== undefined ? val : ''
			}
		}
	})
}

const vars = {}

const def = config => {
	const eval = () => {
		with(store(vars)) {
			var something = 'value'
			var colors = {foreground: {a: 'red'}}
			return `
				.box {
					foo: ${something} ${1 + 1};
				}
			`
		}
	}
	return eval()
}

console.log(def(), pathsAccessed)