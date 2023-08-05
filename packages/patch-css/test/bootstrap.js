const puppeteer = require('puppeteer')

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
      ready() {
        resolve(browserSync)
      }
    }
  })
})
let browserSync
let browser
// expose variables
beforeAll(async () => {
  browserSync = await startServer()
  global.expect = expect
  browser = global.browser = await puppeteer.launch(opts)
})

// close browser and reset global variables
afterAll(() => {
  browser.close()
  browserSync.exit()

  global.browser = globalVariables.browser
  global.expect = globalVariables.expect
})