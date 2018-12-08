(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(factory((global.howLongUntilLunch = {})));
}(this, (function (exports) { 'use strict';

var postcss = require('postcss');
var postcssNested = require('postcss-nested');
var autoprefixer = require('autoprefixer');

function compile(source) {
	postcss([postcssNested, autoprefixer]).process(source).then(function (result) {
		console.log(result.css);
	});
}

exports.compile = compile;

Object.defineProperty(exports, '__esModule', { value: true });

})));
