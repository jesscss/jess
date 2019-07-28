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
const jess = require('../')

const otherStylesheet = `
import {Color} from 'color'

export default (config) => {
	const {
		theme = {
			foreground: '#FFF',
			accent: 'red',
			mix: Color(theme.foreground, '#CCC')
		}
	} = config

	return {
		theme
	}
}
`

const eventualOutput = `
import styles from './otherStylesheet.jess'

export default (config) => {
	const {
		something = 'value'
		, colors = {foreground: {a: 'red'}}  // was styles().theme.accent
		, blah = 'foo'
	} = config

	const vars = {
		'--var-j0sf5m-3': function() { try { return colors.foreground.a } catch() { return '' } }
		, '--var-j0sf5m-6': function() { try { return blah } catch() { return '' } }
	}

	return {
		staticCss: '.box { foo: value var(--var-j0sf5m-3, red);} @media (min-width: 250px) {.box { foo: var(--var-j0sf5m-6, foo)} }'
		, cssVariables: [ '--var-j0sf5m-3', vars['--var-j0sf5m-3'], '--var-j0sf5m-6', vars['--var-j0sf5m-6'] ]
		, box: 'box',
		, something
		, colors
		, blah
	}
}

`
const imports = [
	'import {val} from \'./export\''
]

const vars = [
	['something', '\'value\''],
	['colors', '{foreground: {a: \'red\'}}', 1],
	['blah', 'val()', 1],
	['blah2', "process.env['HOME']"],
	['math', "Math.round(1.1)"]
]

const template = [
	'.box {\n  foo: ',
	'${something}',
	' ',
	'${colors.foreground.a}',
	';\n',
	'@media (min-width: 250px) { foo: ',
	'${blah}',
	' ',
	'${blah2}',
	' }',
	'}'
]

var results = jess.compile(__filename, imports, vars, template)