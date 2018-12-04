const postcss = require('postcss')
const postcssNested = require('postcss-nested')
const autoprefixer = require('autoprefixer')

export function compile(source) {
	postcss([postcssNested, autoprefixer])
		.process(source)
		.then(result => {
			console.log(result.css)
		})
}