describe('simple test for updated CSS', function() {
  let page
  let browser

  beforeAll(async () => {
    page = await browser.newPage()
    await page.goto('http://localhost:3000/test/files/01.html')
  })

  afterAll(async () => {
    await page.close()
  })

  it('should add a new style block', async () => {
    console.log(await browser.version())
    await page.evaluate('patchCss.updateSheet(\'body { background: blue }\', \'foo\')')
    let bg = await page.$eval('body', el => getComputedStyle(el).backgroundColor)
    expect(bg).to.eq('rgb(0, 0, 255)')
  })
})