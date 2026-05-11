import type { IToken } from 'chevrotain';
import { decl, spaced, color, rules, any, ref, atrule, ruleset, el, forNode, List, VarDeclaration, op, num, dimension, AssignmentType, vardecl, interpolated, call, JsFunction, customdecl, Node, Any } from '../index.js';
import { Context } from '../../context.js';
import { INTERPOLATION_PLACEHOLDER } from '../interpolated.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { renderNodeToString } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

let context: Context;

const token = (image: string, tokenTypeName = 'WS', startOffset = 0): IToken => ({
  image,
  tokenType: { name: tokenTypeName } as IToken['tokenType'],
  startOffset,
  endOffset: startOffset + image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length
});

describe('Declaration', () => {
  beforeEach(() => {
    context = new Context();
  });
  it('should serialize to CSS', () => {
    let rule = decl({ name: 'color', value: color('#eee') });
    expect(`${rule}`).toBe('color: #eee');
  });

  it('does not allocate options when serializing a default declaration', () => {
    const rule = decl({ name: 'color', value: color('#eee') });

    expect(rule.toTrimmedString()).toBe('color: #eee');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('streams non-custom declaration syntax without capture scaffolding', () => {
    const writer = new CountingWriter();
    const rule = decl({
      name: any('color'),
      value: any('red'),
      important: any('!important', { role: 'flag' })
    });

    expect(rule.toTrimmedString({ writer })).toBe('color: red !important');
    expect(writer.toString()).toBe('color: red !important');
    expect(writer.captures).toBe(0);
  });

  it('renders resolved declarations through render(context)', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const rendered = decl({
      name: any('color'),
      value: ref({ key: 'tone' }, { type: 'variable' })
    }).render(context);

    expect(rendered).toBe('color: red');
  });

  it('keeps toTrimmedString canonical even when a render context is present', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const node = decl({
      name: any('color'),
      value: ref({ key: 'tone' }, { type: 'variable' })
    });

    expect(node.toTrimmedString({ context })).toBe('color: $tone');
    expect(node.render(context)).toBe('color: red');
  });

  it('resolves declarations without touching render state', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const node = decl({
      name: any('color'),
      value: ref({ key: 'tone' }, { type: 'variable' })
    });
    const sourceValue = node.value.value;

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('color: red');
    expect(sourceValue.parent).toBe(node);
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('reuses source-free scalar leaves when deriving interpolated declaration names', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const originalClone = Node.prototype.clone;
    let clonedNameLeaves = 0;
    Node.prototype.clone = function cloneForCounting(
      this: Node,
      ...cloneArgs: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      if (this.valueOf() === 'color') {
        clonedNameLeaves++;
      }
      return originalClone.apply(this, cloneArgs);
    };

    try {
      const sourceNameLeaf = any('color');
      const node = decl({
        name: interpolated({
          source: `border-${INTERPOLATION_PLACEHOLDER}`,
          replacements: [sourceNameLeaf]
        }),
        value: ref({ key: 'tone' }, { type: 'variable' })
      });
      const sourceName = node.value.name;
      const resolved = await node.resolve(context);

      expect(resolved.toTrimmedString()).toBe('border-color: red');
      expect(clonedNameLeaves).toBe(0);
      expect(sourceName.parent).toBe(node);
      expect(sourceNameLeaf.parent).toBe(sourceName);
    } finally {
      Node.prototype.clone = originalClone;
    }
  });

  it('resolves custom declarations without touching render state', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const node = customdecl({
      name: any('--color'),
      value: ref({ key: 'tone' }, { type: 'variable' })
    });

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('--color:red');
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.inCustom).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('renders indexed references inside custom property values through render(context)', async () => {
    const root = rules([
      vardecl({
        name: any('tone'),
        value: any('red')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const node = decl({
      name: any('--custom'),
      value: ref({ key: 'tone' }, { type: 'index' })
    });

    expect(node.toTrimmedString()).toBe('--custom:$[tone]');
    expect(node.render(context)).toBe('--custom:red');
  });

  it('renders interpolated custom property values through render(context)', async () => {
    const root = rules([
      vardecl({
        name: any('tone'),
        value: any('red')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const node = decl({
      name: any('--custom'),
      value: interpolated({
        source: `prefix-${INTERPOLATION_PLACEHOLDER}`,
        replacements: [ref({ key: 'tone' }, { type: 'variable' })]
      })
    });

    expect(node.toTrimmedString()).toBe('--custom:prefix-$tone');
    expect(node.render(context)).toBe('--custom:prefix-red');
  });

  it('keeps a single space before block-comment custom property values after evaluation', async () => {
    const root = rules([
      vardecl({
        name: any('commentText'),
        value: any('/* // Not commented out // */')
      }),
      decl({
        name: any('--comment'),
        value: ref({ key: 'commentText' }, { type: 'variable' })
      })
    ]);

    expect(await renderNodeToString(root, context)).toBeString(`
      --comment: /* // Not commented out // */;
    `);
  });

  it('preserves generic calls in custom property values during render(context)', () => {
    const node = decl({
      name: any('--custom'),
      value: call({
        name: 'if',
        args: new List([
          call({ name: 'not', args: new List([any('true')]) }),
          any('5')
        ])
      })
    });

    expect(node.toTrimmedString()).toBe('--custom:if(not(true), 5)');
    expect(node.render(context)).toBe('--custom:if(not(true), 5)');
  });

  it('preserves Less-style function calls in custom property values during render(context)', () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'rgba',
      fn: () => any('rgb(0, 30, 0)')
    }));
    context.root = root;
    context.rulesContext = root;

    const node = decl({
      name: any('--custom'),
      value: call({
        name: ref('rgba', { type: 'function', fallbackValue: true }),
        args: new List([num(0), num(30), num(0), num(238)])
      }, { silentFail: true })
    });

    expect(node.render(context)).toBe(node.toTrimmedString());
  });

  it('streams custom declaration values without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = decl({
      name: any('--custom'),
      value: call({
        name: 'if',
        args: new List([
          call({ name: 'not', args: new List([any('true')]) }),
          any('5')
        ])
      })
    });

    expect(node.toTrimmedString({ writer })).toBe('--custom:if(not(true), 5)');
    expect(writer.toString()).toBe('--custom:if(not(true), 5)');
    expect(writer.captures).toBe(0);
  });

  it('serializes important declarations with one space before !important', async () => {
    const node = rules([
      decl({
        name: any('color'),
        value: any('red'),
        important: any('!important', { role: 'flag' })
      })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      color: red !important;
    `);
  });

  it('derives source-backed important flags without deep-cloning the flag leaf', async () => {
    const originalClone = Any.prototype.clone;
    let clonedImportantFlags = 0;
    Any.prototype.clone = function cloneForCounting(
      this: Any,
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      if (this.value === '!important') {
        clonedImportantFlags++;
      }
      return originalClone.apply(this, args);
    };

    try {
      const important = any('!important', { role: 'flag' });
      important._location = [12, 1, 13, 21, 1, 22];
      const node = decl({
        name: any('color'),
        value: any('red'),
        important
      });

      const evald = await node.resolve(context);

      expect(`${evald}`).toBe('color: red !important');
      expect(clonedImportantFlags).toBe(0);
      expect(important.parent).toBe(node);
    } finally {
      Any.prototype.clone = originalClone;
    }
  });

  it('serializes comment trivia between declaration values and semicolons', () => {
    const value = any('yes');
    value._location = [7, 1, 8, 9, 1, 10];
    const node = decl({ name: any('b'), value });
    node._location = [4, 1, 5, 25, 1, 26];
    const tokens = [token(' '), token('/* comment */', 'BlockComment')];
    const trivia = createTriviaMap({
      before: new Map([[23, tokens]]),
      after: new Map([[value.location[3], tokens]])
    }) satisfies TriviaMap;

    expect(rules([node]).toString({ trivia })).toBeString(`
      b: yes /* comment */;
    `);
  });

  it('serializes comment trivia between declaration names and separators', () => {
    const name = any('color', { role: 'property' });
    name._location = [4, 1, 5, 8, 1, 9];
    const node = decl({ name, value: any('grey') });
    const tokens = [token('/* survive */', 'BlockComment'), token(' '), token('/* me too */', 'BlockComment')];
    const trivia = createTriviaMap({
      before: new Map([[35, tokens]]),
      after: new Map([[name.location[3], tokens]])
    }) satisfies TriviaMap;

    expect(node.toString({ trivia })).toBe('color/* survive */ /* me too */: grey');
  });

  it('does not keep an empty leading item when += normalization has no prior declaration', async () => {
    const node = rules([
      decl({
        name: any('background-color'),
        value: any('red')
      }, { assign: '+:' }),
      decl({
        name: any('background-color'),
        value: any('foo')
      }, { assign: '+:' })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      background-color: red, foo;
    `);
  });

  it('normalizes merged declaration placeholders without recopying scalar leaves', async () => {
    const node = rules([
      decl({
        name: any('background-color'),
        value: any('red')
      }, { assign: '+:' }),
      decl({
        name: any('background-color'),
        value: any('foo')
      }, { assign: '+:' })
    ]);
    const originalCopy = Node.prototype.copy;
    let scalarCopies = 0;
    Node.prototype.copy = function copyForCounting(this: Node, ...args: Parameters<typeof originalCopy>): ReturnType<typeof originalCopy> {
      if (this.type === 'Any' && /^(red|foo)$/u.test(String(this.valueOf()))) {
        scalarCopies++;
      }
      return originalCopy.apply(this, args);
    };

    try {
      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        background-color: red, foo;
      `);
      expect(scalarCopies).toBe(0);
    } finally {
      Node.prototype.copy = originalCopy;
    }
  });

  it('resolves merged declaration lookups without duplicating or keeping empty placeholders', async () => {
    const node = rules([
      decl({
        name: any('background-color'),
        value: any('red')
      }, { assign: '+:' }),
      decl({
        name: any('background-color'),
        value: any('foo')
      }, { assign: '+:' }),
      decl({
        name: any('background'),
        value: ref({ key: 'background-color' }, { type: 'declaration' })
      })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      background-color: red, foo;
      background: red, foo;
    `);
  });

  it('resolves merged declaration lookups from a nested child ruleset in source order', async () => {
    const node = rules([
      rules([
        decl({
          name: any('background-color'),
          value: any('red')
        }, { assign: '+:' }),
        decl({
          name: any('background-color'),
          value: any('foo')
        }, { assign: '+:' }),
        rules([
          decl({
            name: any('background'),
            value: ref({ key: 'background-color' }, { type: 'declaration' })
          })
        ])
      ])
    ]);

    const parent = node.value[0]!;
    const child = parent.value[2]!;
    child.parent = parent;

    expect(await renderNodeToString(node, context)).toBeString(`
      background-color: red, foo;
      background: red, foo;
    `);
  });

  it('does not pull a prior plain declaration into Less-style property merge chains', async () => {
    const node = rules([
      decl({
        name: any('src'),
        value: any('base')
      }),
      decl({
        name: any('src'),
        value: any('one')
      }, { assign: AssignmentType.MergeList }),
      decl({
        name: any('src'),
        value: any('two')
      }, { assign: AssignmentType.MergeSequence }),
      decl({
        name: any('src'),
        value: any('three')
      }, { assign: AssignmentType.MergeList })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      src: base;
      src: one two, three;
    `);
  });

  it('coalesces merged declaration lists without recopying copied leaves', async () => {
    const node = rules([
      rules([
        decl({
          name: any('src'),
          value: any('one')
        }, { assign: AssignmentType.MergeList })
      ]),
      rules([
        decl({
          name: any('src'),
          value: any('two')
        }, { assign: AssignmentType.MergeList })
      ]),
      rules([
        decl({
          name: any('src'),
          value: any('three')
        }, { assign: AssignmentType.MergeList })
      ])
    ]);
    const originalCopy = Node.prototype.copy;
    let srcValueCopies = 0;
    Node.prototype.copy = function copyForCounting(this: Node, ...args: Parameters<typeof originalCopy>): ReturnType<typeof originalCopy> {
      if (this.type === 'Any' && /^(one|two|three)$/u.test(String(this.valueOf()))) {
        srcValueCopies++;
      }
      return originalCopy.apply(this, args);
    };

    try {
      const css = await renderNodeToString(node, context);

      expect(css).toBeString(`
        src: one, two, three;
      `);
      expect(srcValueCopies).toBe(0);
    } finally {
      Node.prototype.copy = originalCopy;
    }
  });

  it('preserves authored multiline declaration values with a minimum continuation indent', async () => {
    const node = rules([
      decl({ name: any('background'), value: any('the,\n              great,\n              wall') }),
      decl({ name: any('color'), value: any('\nwhite') }),
      decl({ name: any('background-position'), value: any('45\n-23') })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      background: the,
                    great,
                    wall;
      color:
        white;
      background-position: 45
        -23;
    `);
  });

  it('does not treat boundary trivia before a value as authored multiline value text', () => {
    const name = any('color', { role: 'property' });
    name._location = [0, 1, 1, 5, 1, 6];
    const value = any('white');
    value._location = [8, 2, 1, 12, 2, 6];
    const node = decl({ name, value });
    node._location = [0, 1, 1, 12, 2, 6];
    const trivia = createTriviaMap({
      before: new Map([[value.location[0], [token('\n', 'WS', 6)]]])
    }) satisfies TriviaMap;

    expect(node.toTrimmedString({ trivia })).toBe('color: white');
  });

  it('does not re-merge sequence assignments during post-eval coalescing in nested at-rules', async () => {
    context = new Context({ collapseNesting: true, leakyRules: true });
    const node = rules([
      ruleset({
        selector: el('nav'),
        rules: rules([
          atrule({
            name: any('@starting-style', { role: 'atkeyword' }),
            rules: rules([
              decl({ name: any('padding'), value: any('10px') }, { assign: AssignmentType.MergeSequence }),
              decl({ name: any('padding'), value: any('8px') }, { assign: AssignmentType.MergeSequence }),
              decl({ name: any('padding'), value: any('6px') }, { assign: AssignmentType.MergeSequence }),
              decl({ name: any('padding'), value: any('4px') }, { assign: AssignmentType.MergeSequence })
            ])
          })
        ])
      })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      nav {
        @starting-style {
          padding: 10px 8px 6px 4px;
        }
      }
    `);
  });

  it('coalesces sequence assignments emitted through nested $for output rules', async () => {
    context = new Context({ collapseNesting: true, leakyRules: true });
    const node = rules([
      ruleset({
        selector: el('aside'),
        rules: rules([
          atrule({
            name: any('@starting-style', { role: 'atkeyword' }),
            rules: rules([
              forNode({
                pattern: {
                  kind: 'single',
                  value: new VarDeclaration({
                    name: any('value', { role: 'property' }),
                    value: any('_')
                  })
                },
                iterable: {
                  kind: 'node',
                  value: new List([
                    any('10px'),
                    any('20px'),
                    any('30px'),
                    any('40px')
                  ])
                },
                rules: rules([
                  decl({ name: any('padding'), value: ref('value', { type: 'variable' }) }, { assign: AssignmentType.MergeSequence })
                ])
              })
            ])
          })
        ])
      })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      aside {
        @starting-style {
          padding: 10px 20px 30px 40px;
        }
      }
    `);
  });

  it('coalesces sequence assignments emitted through tuple-pattern each()-style loops', async () => {
    context = new Context({ collapseNesting: true, leakyRules: true });
    const node = rules([
      ruleset({
        selector: el('aside'),
        rules: rules([
          atrule({
            name: any('@starting-style', { role: 'atkeyword' }),
            rules: rules([
              forNode({
                pattern: {
                  kind: 'tuple',
                  values: [
                    new VarDeclaration({ name: any('value', { role: 'property' }), value: any('_') }),
                    new VarDeclaration({ name: any('key', { role: 'property' }), value: any('_') }),
                    new VarDeclaration({ name: any('index', { role: 'property' }), value: any('_') })
                  ]
                },
                iterable: {
                  kind: 'node',
                  value: new List([
                    num(1),
                    num(2),
                    num(3),
                    num(4)
                  ])
                },
                rules: rules([
                  decl({
                    name: any('padding'),
                    value: op([ref('value', { type: 'variable' }), '*', dimension([10, 'px'])])
                  }, { assign: AssignmentType.MergeSequence })
                ])
              })
            ])
          })
        ])
      })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      aside {
        @starting-style {
          padding: 10px 20px 30px 40px;
        }
      }
    `);
  });
  // it('should serialize to a module', () => {
  //   let rule = decl({ name: expr([any('color')]), value: spaced([any('#eee')]) })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.decl({\n  name: $J.expr([$J.any("color")]),\n  value: $J.spaced([$J.any("#eee")])\n})'
  //   )
  // })
});
