// const {NodeVM, VMScript} = require('vm2')

// const vm = new NodeVM({
//   console: 'inherit',
//   sandbox: {},
//   require: {
//     external: true,
//     builtin: ['path'],
//     context: 'sandbox'
//   }
// })

// var vmPath = require.resolve('./esm.js')

// let vmSandbox = new VMScript(`
//   module.exports = require('${vmPath}')
// `)

// export const evaluator = vm.run(vmSandbox, __filename)

export const evaluator = require('./eval')
