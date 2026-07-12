import { expect } from 'chai'

import type { ScopeObj } from '../types'
import { Scope } from '..'
import { rules } from '../symbols'
import { createMixin } from '../mixins'

describe('Scope', () => {
  /**
  ```
  $var1 = 1;
  $var2 = 2;

  @mixin foo() {

  }
  ```
  */
  it('can set up a new scope and assign values', () => {
    const $ = Scope({})
    $.$var1 = 1
    $.$var2 = 2
    expect($.$var1).to.eq(1)
    expect($.$var2).to.eq(2)
    /** Variables are not iterable, so the object appears "empty" */
    expect($).to.eql({})
  })

  it('can inherit scope', () => {
    const root = Scope({})
    root.$var1 = 1
    root.$var3 = 3
    const $ = Scope(root)
    $.$var1 = 5
    $.$var2 = 2
    expect($.$var1).to.eq(5)
    expect($.$var2).to.eq(2)
    expect($.$var3).to.eq(3)
  })

  it('can assign properties (rules)', () => {
    const $ = Scope({})
    $.property = 'value'
    $.property = 'foo'
    expect($.property).to.eq('foo')
    expect($).to.eql({ property: 'foo' })
    expect($[rules]).to.eql([
      { property: 'value' },
      { property: 'foo' }
    ])
  })

  it('can assign mixins', () => {
    const $ = Scope({})
    $.$var1 = 1
    let foo: ScopeObj
    $.$mixin = createMixin(
      function(this: ScopeObj) {
        foo = this
        this.prop = 'value'
        return this
      },
      $
    )
    $.$mixin = createMixin(
      function(this: ScopeObj) {
        this.foo = 'bar'
        return this
      },
      $
    )
    expect($.$mixin()).to.eql({ prop: 'value' })
    expect(foo!.$var1).to.eq(1)
  })
})
// const rootScope = Scope({})
// rootScope['$var1'] = 2
// rootScope['$var2'] = 3
// rootScope['$foo'] = function() {}
// rootScope[register](['#foo','>','.bar'])
// rootScope[register](['#foo','>','.bar'])
// rootScope[register](['#foo','>','.bar'], ['.inline'])

// console.log(rootScope['$var1'], rootScope['$var2'])
// console.log(JSON.stringify(rootScope[map], undefined, '  '))
// console.log(JSON.stringify(rootScope, undefined, '  '))

// const inherited = rootScope['$my-mixin'] = Scope(rootScope)
// inherited['$var1'] = 4
// inherited['$var3'] = 8

// console.log(inherited['$var1'], inherited['$var2'], inherited['$var3'])
// console.log(rootScope['$my-mixin']['$var1'])