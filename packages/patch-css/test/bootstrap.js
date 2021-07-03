const puppeteer = require('puppeteer')
const { expect } = require('chai')
const globalVariables = {
  browser: global.browser,
  expect: global.expect
}

// puppeteer options
const opts = {
  headless: true,
  timeout: 10000
}

const startServer = () => new Promise((resolve) => {
  const browserSync = require('browser-sync').create()
  browserSync.init({
    watch: true,
    open: false,
    server: {
      baseDir: './',
      directory: true
    },
    callbacks: {
      ready(err, bs) {
        resolve(browserSync)
      }
    }
  })
})
let browserSync
// expose variables
before (async () => {
  browserSync = await startServer()
  global.expect = expect
  global.browser = await puppeteer.launch(opts)
})

// close browser and reset global variables
after (() => {
  browser.close()
  browserSync.exit()

  global.browser = globalVariables.browser
  global.expect = globalVariables.expect
})