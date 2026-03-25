import { describe, test, expect } from 'vitest';
import {
  Ampersand,
  Any,
  AtRule,
  AttributeSelector,
  BasicSelector,
  Block,
  Bool,
  Call,
  Collection,
  Color,
  Comment,
  Combinator,
  ComplexSelector,
  CompoundSelector,
  Condition,
  Declaration,
  DefaultGuard,
  Dimension,
  Extend,
  ExtendFlag,
  Expression,
  Func,
  Interpolated,
  InterpolatedSelector,
  JsArray,
  JsFunction,
  JsImport,
  JsObject,
  Keyword,
  List,
  Log,
  Mixin,
  Negative,
  Nil,
  Num,
  Operation,
  Paren,
  PseudoSelector,
  QueryCondition,
  Quoted,
  Range,
  RawRules,
  Reference,
  Rest,
  Rules,
  Ruleset,
  SelectorCapture,
  SelectorList,
  Sequence,
  StyleImport,
  Url,
  VarDeclaration,
  serializeTypes
} from '../../index.js';
import { Node, defineType, type NodeOptions } from '../node.js';
import { ExtendList } from '../extend-list.js';

type LooseNodeOptions = NodeOptions & {
  tags?: string[];
  nested?: {
    enabled?: boolean;
  };
};

class LooseNode extends Node<undefined, LooseNodeOptions> {
  static override childKeys = null as null;

  extra = 'kept';

  constructor(options?: LooseNodeOptions) {
    super(undefined, options);
  }
}
defineType(LooseNode, 'LooseNode', 'loose');

class CyclicNode extends Node<Node> {
  static override childKeys = ['value'] as const;

  value!: Node;

  constructor() {
    super(undefined as unknown as Node);
    this.value = this;
  }
}
defineType(CyclicNode, 'CyclicNode', 'cycle');

class SparseNode extends Node<{ left?: Node; right?: Node }> {
  static override childKeys = ['left', 'right'] as const;

  left: Node | undefined;
  right: Node | undefined;

  constructor() {
    super({});
    this.left = undefined;
    this.right = undefined;
  }
}
defineType(SparseNode, 'SparseNode', 'sparse');

const ident = (value: string) => new Any(value, { role: 'ident' });
const property = (value: string) => new Any(value, { role: 'property' });
const atkeyword = (value: string) => new Any(value, { role: 'atkeyword' });

describe('serializeTypes utility coverage', () => {
  test('serializes primitives and non-node containers', () => {
    expect(serializeTypes('abcdef', { maxStringLength: 4 })).toBeString(`'abc…'`);
    expect(serializeTypes([1, 'two', false])).toBeString(`[1, 'two', false]`);
    expect(serializeTypes([new BasicSelector('.a')])).toBeString(`[BasicSelector]`);
    expect(serializeTypes([new BasicSelector('.a')], { useShortType: true })).toBeString(`[el]`);
    expect(serializeTypes([[1, 'two']])).toBeString(`[[1, 'two']]`);
    expect(serializeTypes({ foo: 'bar', ok: true })).toBeString(`{ foo: 'bar', ok: true }`);
    expect(serializeTypes(Symbol.for('token'))).toBeString(`Symbol(token)`);
    expect(serializeTypes(undefined)).toBeString(`undefined`);
    expect(serializeTypes(null)).toBeString(`null`);
    expect(serializeTypes(new Rules([]))).toBeString(`
      (Rules
        []
      )
    `);
  });

  test('serializes fallback object fields, options, short types, and cycles', () => {
    const loose = new LooseNode({
      tags: ['alpha', 'beta'],
      nested: { enabled: true }
    });
    const cycle = new CyclicNode();
    const emptyNested = new LooseNode({ nested: {} });
    const hiddenValue = new Comment('// note', { lineComment: true });
    const counted = new Num(5, { semi: true });
    const weirdNum = new Num(7, { semi: true });
    const fnNode = new JsFunction(() => true, { semi: true });
    const emptyObject = new JsObject({});
    const emptyObjectWithOptions = new JsObject({}, { semi: true });
    const optionless = new Comment('/* visible */');
    const rgbColor = new Color({ rgb: [12, 34, 56] });
    const hslColor = new Color({
      hsl: [
        [120, 'deg'],
        [50, '%'],
        [25, '%']
      ],
      alpha: 0.25
    });
    const emptyColor = new Color({ rgb: [1, 2, 3] });
    Object.defineProperty(optionless, 'options', {
      value: undefined,
      configurable: true
    });
    weirdNum.unit = 'px';
    emptyColor._rgbChannels = undefined;
    emptyColor._hslChannels = undefined;
    emptyColor._alphaValue = undefined;
    emptyColor._nodeValue = undefined;

    expect(serializeTypes(loose, { showOptions: true, useShortType: true })).toContainString(`
      (loose
          tags:
            ['alpha', 'beta']
          nested: {
            enabled: true
          }
        extra: 'kept'
      )
    `);
    expect(serializeTypes(emptyNested, { showOptions: true, useShortType: true })).toContainString(`
      (loose
          nested: {}
        extra: 'kept'
      )
    `);
    expect(serializeTypes(cycle, { useShortType: true })).toBeString(`
      (cycle
        (cycle …)
      )
    `);
    expect(serializeTypes(emptyObject)).toBeString(`(JsObject)`);
    expect(serializeTypes(emptyObjectWithOptions, { showOptions: true })).toContainString(`
      (JsObject
        semi: true
      )
    `);
    expect(serializeTypes(hiddenValue, { showOptions: true, showValues: false })).toContainString(`
      (Comment
        lineComment: true
      )
    `);
    expect(serializeTypes(counted, { showOptions: true })).toContainString(`
      (Num
        semi: true
        5
      )
    `);
    expect(serializeTypes(weirdNum, { showOptions: true })).toContainString(`
      (Num
        semi: true
        number: 7
        unit: 'px'
      )
    `);
    expect(serializeTypes(fnNode, { showOptions: true })).toContainString(`
      (JsFunction
        semi: true
      )
    `);
    expect(serializeTypes(new SparseNode())).toBeString(`(SparseNode)`);
    expect(serializeTypes(optionless, { showOptions: true })).toBeString(`(Comment '/* visible */')`);
    expect(serializeTypes(rgbColor)).toContainString(`
      (Color
        rgb:
    `);
    expect(serializeTypes(hslColor)).toContainString(`
      (Color
        hsl:
    `);
    expect(serializeTypes(emptyColor)).toBeString(`(Color)`);
  });

  test('serializes representative core tree nodes', () => {
    const quoted = new Quoted('theme.css', { quote: '\'' });
    const attrValue = new Quoted('bar', { quote: '\'' });
    const decl = new Declaration({
      name: property('color'),
      value: new Color('#112233')
    });
    const varParam = new VarDeclaration({
      name: property('size'),
      value: new Nil()
    }, { paramVar: true });
    const mixinRules = new Rules([decl]);
    const selectorList = new SelectorList([
      new BasicSelector('.alpha'),
      new BasicSelector('.beta')
    ]);
    const interpolated = new Interpolated({
      source: '--%%',
      replacements: [ident('token')]
    }, { role: 'property' });
    const inventory = new Rules([
      new Comment('/* note */'),
      new Declaration({
        name: property('width'),
        value: new Dimension({ number: 10, unit: 'px' })
      }),
      new Declaration({
        name: property('opacity'),
        value: new Num(2)
      }),
      new Declaration({
        name: property('background'),
        value: new Url(new Any('asset.png', { role: 'urlvalue' }))
      }),
      new Declaration({
        name: property('font-family'),
        value: new Quoted('serif', { quote: '\'' })
      }),
      new Declaration({
        name: property('fallback'),
        value: new Expression(
          new Operation([
            new Negative(new Num(2)),
            '+',
            new Num(3)
          ])
        )
      }),
      new Declaration({
        name: property('tokens'),
        value: new Sequence([
          ident('solid'),
          new Dimension({ number: 1, unit: 'px' }),
          new Color({ rgb: [255, 0, 0], alpha: 0.5 })
        ])
      }),
      new Declaration({
        name: property('choices'),
        value: new List([new Num(1), new Num(2)], { sep: ',' })
      }),
      new Declaration({
        name: property('wrapped'),
        value: new Paren(
          new QueryCondition([
            ident('width'),
            new Any('>', { role: 'operator' }),
            new Dimension({ number: 400, unit: 'px' })
          ])
        )
      }),
      new Declaration({
        name: property('logic'),
        value: new Condition([
          new Bool(true),
          'and',
          new Bool(false)
        ], { negate: true })
      }),
      new Declaration({
        name: property('range'),
        value: new Range({
          start: new Num(1),
          end: new Num(3),
          step: new Num(1)
        }, { includeEnd: false })
      }),
      new Declaration({
        name: property('ref'),
        value: new Reference({
          target: new Reference('theme', { type: 'ruleset' }),
          key: 'color'
        }, { type: 'variable', role: 'ident', fallbackValue: true })
      }),
      new Declaration({
        name: property('call'),
        value: new Call({
          name: new Reference('rgb', { type: 'function' }),
          args: new List([new Num(1), new Num(2), new Num(3)])
        }, { silentFail: true })
      }),
      new Declaration({
        name: property('capture'),
        value: new SelectorCapture(
          new CompoundSelector([
            new BasicSelector('.button'),
            new PseudoSelector({
              name: ':is',
              arg: selectorList
            })
          ])
        )
      }),
      new Declaration({
        name: property('interpolated'),
        value: interpolated
      }),
      new Declaration({
        name: property('selector-interpolated'),
        value: new InterpolatedSelector(
          new Interpolated({
            source: '.%%',
            replacements: [ident('dynamic')]
          })
        )
      }),
      new Declaration({
        name: property('extend-list'),
        value: new ExtendList([
          new Extend({
            selector: new Ampersand({ template: '-tail' }),
            target: new BasicSelector('.base'),
            flag: ExtendFlag.Exact
          })
        ])
      }),
      new Declaration({
        name: property('selector'),
        value: new ComplexSelector([
          new BasicSelector('.nav'),
          new Combinator('>'),
          new AttributeSelector({
            name: 'href',
            op: '=',
            value: attrValue,
            mod: 'i'
          })
        ])
      }),
      new Declaration({
        name: property('default'),
        value: new DefaultGuard('default()')
      }),
      new Declaration({
        name: property('rest'),
        value: new Rest(new Reference('args', { type: 'variable' }))
      }),
      new Declaration({
        name: property('js-array'),
        value: new JsArray([1, 'two'])
      }),
      new Declaration({
        name: property('js-object'),
        value: new JsObject({ foo: 'bar' })
      }),
      new Declaration({
        name: property('js-function'),
        value: new JsFunction({ name: 'fn', fn: () => true })
      }),
      new Declaration({
        name: property('block'),
        value: new Block(new Any('raw', { role: 'any' }), { type: 'curly' })
      }),
      new AtRule({
        name: atkeyword('@media'),
        prelude: new QueryCondition([
          ident('width'),
          new Any('>', { role: 'operator' }),
          new Dimension({ number: 600, unit: 'px' })
        ]),
        rules: new Rules([
          new Ruleset({
            selector: new BasicSelector('.card'),
            rules: new Rules([decl])
          })
        ])
      }),
      new Ruleset({
        selector: new CompoundSelector([
          new BasicSelector('.box'),
          new PseudoSelector({ name: ':hover' })
        ]),
        rules: new RawRules([
          new Declaration({
            name: property('padding'),
            value: new Dimension({ number: 1, unit: 'rem' })
          })
        ])
      }),
      new Collection([
        new Declaration({
          name: property('nested'),
          value: new Keyword('auto')
        })
      ]),
      new Mixin({
        name: new Any('theme', { role: 'name' }),
        params: new List([varParam]),
        guard: new Condition([new Bool(true)]),
        rules: mixinRules
      }, { hasDefault: true }),
      new Func({
        name: new Any('compute', { role: 'name' }),
        params: new List([varParam]),
        body: new Rules([
          new Declaration({
            name: property('return'),
            value: new Num(42)
          })
        ])
      }),
      new StyleImport({
        path: quoted,
        withNode: new Collection([
          new Declaration({
            name: property('accent'),
            value: new Color('#ff00ff')
          })
        ])
      }, {
        type: 'import',
        importOptions: {
          reference: true,
          forward: true
        },
        namespace: 'theme'
      }),
      new JsImport({
        path: new Quoted('module.js', { quote: '\'' }),
        imports: [['foo', 'bar']]
      }, { namespace: 'mod' }),
      new Log({
        level: 'warn',
        message: new Quoted('watch out', { quote: '\'' })
      })
    ]);

    const serialized = serializeTypes(inventory, { showOptions: true });
    for (const typeName of [
      'Rules',
      'Comment',
      'Declaration',
      'Color',
      'Dimension',
      'Num',
      'Url',
      'Quoted',
      'Expression',
      'Operation',
      'Negative',
      'Sequence',
      'List',
      'Paren',
      'QueryCondition',
      'Condition',
      'Range',
      'Reference',
      'Call',
      'SelectorCapture',
      'Interpolated',
      'InterpolatedSelector',
      'ExtendList',
      'Extend',
      'Ampersand',
      'ComplexSelector',
      'CompoundSelector',
      'BasicSelector',
      'PseudoSelector',
      'AttributeSelector',
      'AtRule',
      'Ruleset',
      'RawRules',
      'Collection',
      'Mixin',
      'Func',
      'DefaultGuard',
      'Rest',
      'JsArray',
      'JsObject',
      'JsFunction',
      'Block',
      'StyleImport',
      'JsImport',
      'Log',
      'Keyword',
      'Bool',
      'Nil',
      'Combinator'
    ]) {
      expect(serialized).toContainString(`(${typeName}`);
    }
    expect(serialized).toContainString(`fallbackValue: true`);
    expect(serialized).toContainString(`silentFail: true`);
    expect(serialized).toContainString(`hasDefault: true`);
    expect(serialized).toContainString(`namespace: 'theme'`);
    expect(serialized).toContainString(`[role=ident]`);
  });
});
