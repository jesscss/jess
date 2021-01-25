'use strict';

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

module.exports = index;
