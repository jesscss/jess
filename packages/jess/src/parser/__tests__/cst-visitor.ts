import { expect } from 'chai'
import 'mocha'

import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'
const testData = path.dirname(require.resolve('@less/test-data'))

import { parse } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

const serialize = async (str: string, expectStr?: string) => {
  expectStr = expectStr || str
  const node = await parse(str)
  expect(node.toString()).to.eq(expectStr)
}

describe('CST-to-AST', () => {
  beforeEach(() => {
    context = new Context({ global: true })
    context.id = 'testing'
    out = new OutputCollector
  })

  // it(`rule #1`, async () => {
  //   const node = await parse(`.box> #foo.bar { a: b; }`)
  //   expect(node.toString()).to.eq('.box > #foo.bar {\n  a: b;\n}\n')
  // })

  // it(`rule #2`, async () => {
  //   const node = await parse(`@import url("something.css");`)
  //   expect(node.toString()).to.eq(`@import url("something.css");\n`)
  // })

  // it(`rule #3`, async () => {
  //   const node = await parse(`@import foo from 'foo.ts';`)
  //   node.toModule(context, out)
  //   expect(out.toString()).to.eq('import * as $JESS from \'jess\'\nconst $J = $JESS.tree\nconst $CONTEXT = new $JESS.Context\n$CONTEXT.id = \'testing\'\nimport foo from \'foo.ts\'\nfunction $DEFAULT ($VARS = {}, $RETURN_NODE) {\n  \n  const $TREE = $J.root((() => {\n    const $OUT = []\n    return $OUT\n  })(),[1,1,0,1,26,25])\n  if ($RETURN_NODE) {\n    return $TREE\n  }\n  return $JESS.renderCss($TREE, $CONTEXT)\n}\nexport default $DEFAULT')
  //   out = new OutputCollector
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('import foo from \'foo.ts\'')
  // })

  // it(`rule #4`, async () => {
  //   const node = await parse(`@import foo, { bar } from 'foo.ts';`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('import foo, { bar } from \'foo.ts\'')
  // })

  // it(`rule #5`, async () => {
  //   const node = await parse(`@import * as foo from 'foo.ts';`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('import * as foo from \'foo.ts\'')
  // })

  // it(`rule #6`, async () => {
  //   const node = await parse(`@import { default as foo, bar } from 'foo.ts';`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('import { default as foo, bar } from \'foo.ts\'')
  // })

  // it(`rule #7`, async () => {
  //   const node = await parse(`@let foo: 1;`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('export let foo = $J.num({\n  value: 1\n  unit: ""\n})\nlet $BK_foo = foo')
  // })

  // it(`rule #8`, async () => {
  //   const node = await parse(`@let foo { color: #FFF }`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('export let foo = {\n  "color": $J.anon("#FFF")\n}\nlet $BK_foo = foo')
  // })

  // it(`rule #9`, async () => {
  //   const node = await parse(`@let foo { color: #FFF; nested {} }`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('export let foo = {\n  "color": $J.anon("#FFF"),\n  "nested": {\n  }\n}\nlet $BK_foo = foo')
  // })

  // it(`rule #10`, async () => {
  //   const node = await parse(`@let foo { color: #FFF; nested { color: black } }`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('export let foo = {\n  "color": $J.anon("#FFF"),\n  "nested": {\n    "color": $J.anon("black")\n  }\n}\nlet $BK_foo = foo')
  // })

  // it(`rule #11`, async () => {
  //   const node = await parse(`@let foo: $value.foo`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('export let foo = $J.cast(value.foo)\nlet $BK_foo = foo')
  // })

  // it(`rule #12`, async () => {
  //   const node = await parse(`@let foo: $value.foo #FFF`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('export let foo = $J.expr([$J.cast(value.foo), $J.ws(), $J.anon("#FFF")])\nlet $BK_foo = foo')
  // })

  // it(`rule #13`, async () => {
  //   const node = await parse(`@let foo: $(value.foo && value.bar)`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('export let foo = $J.cast((value.foo && value.bar))\nlet $BK_foo = foo')
  // })

  // it(`rule #14`, async () => {
  //   const node = await parse(`@mixin foo {}`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('export let foo = () => $J.ruleset(\n  (() => {\n    const $OUT = []\n    return $OUT\n  })()\n)\nlet $BK_foo = foo')
  // })

  // it(`rule #15`, async () => {
  //   const node = await parse(`@mixin foo() {}`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('export let foo = () => $J.ruleset(\n  (() => {\n    const $OUT = []\n    return $OUT\n  })()\n)\nlet $BK_foo = foo')
  // })

  // it(`rule #16`, async () => {
  //   const node = await parse(`@mixin foo(bar, foo: 1px) {}`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('export let foo = (bar, foo = $J.num({\n  value: 1\n  unit: "px"\n})) => $J.ruleset(\n  (() => {\n    const $OUT = []\n    return $OUT\n  })()\n)\nlet $BK_foo = foo')
  // })

  // it(`rule #17`, async () => {
  //   const node = await parse(`@include each($list, $mixin);`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('$J.call({\n  name: "each",\n  value: $J.list([\n    $J.cast(list),\n    $J.cast(mixin)\n  ]),\n  ref: () => each,\n})\n')
  // })

  // it(`rule #18`, async () => {
  //   const node = await parse(`@include $each(list, mixin);`)
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('$J.cast(each(list, mixin))')
  // })
  
  // it(`rule #19`, async () => {
  //   const node = await parse(
  //     `@supports (property: value) {
  //       @media (max-size: 2px) {
  //         @supports (whatever: something) {
  //           .inner {
  //             property: value;
  //           }
  //         }
  //       }
  //     }`
  //   )
  //   expect(node.toString()).to.eq('@supports (property: value) {\n  @media (max-size: 2px) {\n    @supports (whatever: something) {\n      .inner {\n        property: value;\n      }\n    }\n  }\n}\n')
  // })

  // it(`rule #20`, async () => {
  //   let node = await parse(
  //     `&:hover {}`
  //   )
  //   node.value[0].toModule(context, out)
  //   expect(out.toString()).to.eq('$J.rule({\n  sels: $J.list([\n    $J.sel([$J.amp(), $J.el($J.anon(":hover"))])\n  ]),\n  value: $J.ruleset(\n    (() => {\n      const $OUT = []\n      return $OUT\n    })()\n  )},[1,1,0,1,10,9])')
    
  //   node = node.eval(context)
  //   expect(node.value[0].toString()).to.eq(':hover {\n}')
  // })

  // it(`rule #21`, async () => {
  //   let node = await parse(
  //     `
  //     a, b {
  //       &:hover {
  //         background: blue;
  //       }
  //     }
  //     `
  //   )  
  //   node = node.eval(context)
  //   expect(node.toString()).to.eq('a:hover, b:hover {\n  background: blue;\n}\n')
  // })

  it(`rule #22`, async () => {
    let node = await parse(
      `
      a, b {
        + c {
          background: blue;
        }
      }
      `
    )  
    node = node.eval(context)
    expect(node.toString()).to.eq('a + c,\nb + c {\n  background: blue;\n}\n')
  })

  it(`rule #23`, async () => {
    let node = await parse(
      `
      a, b, c {
        [foo]& {
          background: blue;
        }
      }
      `
    )  
    node = node.eval(context)
    expect(node.toString()).to.eq('[foo]a,\n[foo]b,\n[foo]c {\n  background: blue;\n}\n')
  })

  it(`rule #24`, async () => {
    let node = await parse(
      `
      a, b {
        & + & {
          background: blue;
        }
      }
      `
    )  
    node = node.eval(context)
    expect(node.toString()).to.eq('a + a,\nb + a,\na + b,\nb + b {\n  background: blue;\n}\n')
  })

  it(`rule #25`, async () => {
    let node = await parse(
      `
      @media all {
        a {
          b {
            color: rebeccapurple;
          }
        }
      }
      `
    )  
    node = node.eval(context)
    expect(node.toString()).to.eq('@media all {\n  a b {\n    color: rebeccapurple;\n  }\n}\n')
  })

  it(`rule #26`, async () => {
    let node = await parse(
      `
      a {
        color: blue;
        @media all { 
          color: rebeccapurple;
        }
      }
      `
    )  
    node = node.eval(context)
    expect(node.toString()).to.eq('a {\n  color: blue;\n}\n@media all {\n  a {\n    color: rebeccapurple;\n  }\n}\n')
  })
})

/**
 * Jess doesn't output comments, so
 * this is a list of Less CSS output w/o comments
 * and with valid CSS.
 */
const validCSS = [
  "css/_main/calc.css",
  "css/_main/charsets.css",
  "css/_main/colors.css",
  "css/_main/colors2.css",
  "css/_main/css-grid.css",
  "css/_main/css-guards.css",
  "css/_main/empty.css",
  "css/_main/extend-chaining.css",
  "css/_main/extend-clearfix.css",
  "css/_main/extend-exact.css",
  "css/_main/extend-media.css",
  "css/_main/extend-nest.css",
  "css/_main/extend-selector.css",
  "css/_main/extend.css",
  "css/_main/extract-and-length.css",
  "css/_main/functions-each.css",
  "css/_main/ie-filters.css",
  "css/_main/import-module.css",
  "css/_main/import-once.css",
  "css/_main/import-remote.css",
  "css/_main/javascript.css",
  "css/_main/lazy-eval.css",
  "css/_main/merge.css",
  "css/_main/mixin-noparens.css",
  "css/_main/mixins-closure.css",
  "css/_main/mixins-guards-default-func.css",
  "css/_main/mixins-important.css",
  "css/_main/mixins-named-args.css",
  "css/_main/mixins-nested.css",
  "css/_main/mixins-pattern.css",
  "css/_main/mixins.css",
  "css/_main/no-output.css",
  "css/_main/operations.css",
  "css/_main/parse-interpolation.css",
  "css/_main/permissive-parse.css",
  "css/_main/plugin-preeval.css",
  "css/_main/property-accessors.css",
  "css/_main/rulesets.css",
  "css/_main/scope.css",
  "css/_main/strings.css",
  "css/_main/urls.css",
  "css/_main/variables-in-at-rules.css",
  "css/_main/variables.css"
]

describe('can turn CSS into an AST', () => {
  validCSS.forEach(file => {
    it(`${file}`, async () => {
      const result = fs.readFileSync(path.join(testData, file)).toString()
      await serialize(result)
    })
  })
})

