const {NodeVM, VMScript} = require('vm2')

const vm = new NodeVM({
  console: 'inherit',
  sandbox: {},
  require: {
    external: true,
    builtin: ['path']
  }
})

var vmPath = require.resolve('./vm.js')

let vmSandbox = new VMScript(`
  require = require('esm')(module)
  module.exports = require('${vmPath}')
`)

export const evaluator = vm.run(vmSandbox, __filename)
