import styles from './files/import-func'
import { expect } from 'chai'
import 'mocha'

describe('Output files', () => {
  it('should render CSS', ()=> {
    const css = styles()
    console.log(css)
  })
})
