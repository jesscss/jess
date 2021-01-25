(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
	typeof define === 'function' && define.amd ? define(factory) :
	(global.jess = factory());
}(this, (function () { 'use strict';

var _require = require('vm2');
var NodeVM = _require.NodeVM;
var VMScript = _require.VMScript;

var vm = new NodeVM({
  console: 'inherit',
  sandbox: {},
  require: {
    external: true,
    builtin: ['path']
  }
});

var vmSandbox = new VMScript('\n  require = require(\'esm\')(module)\n  module.exports = require(\'./vm.js\')\n');

var index = vm.run(vmSandbox, __dirname);

// const postcss = require('postcss')
// const postcssNested = require('postcss-nested')
// const autoprefixer = require('autoprefixer')

// const result = await postcss([postcssNested, autoprefixer])
// .process(output.join(''))

return index;

})));
