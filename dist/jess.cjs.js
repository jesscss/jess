'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var postcss = require('postcss');
var postcssNested = require('postcss-nested');
var autoprefixer = require('autoprefixer');

function compile(source) {
	postcss([postcssNested, autoprefixer]).process(source).then(function (result) {
		console.log(result.css);
	});
}

exports.compile = compile;
