import { describe, expect, it } from 'vitest';
import { makeLessRegistry, makeSassRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import {
  color, decl, collection, collectionEntry, collectionSpread, declarationReference, dimension, funcCall, keyword, list, mixinCall, mixinDef, propertyReference, quoted, reference, stylesheet, rule,
  variableDeclaration, variableReference, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';
import { DEFAULT_MODES } from '../value-eval.js';

const evaluator = buildEvaluator(makeLessRegistry());
const sassEvaluator = buildEvaluator(makeSassRegistry());
const render = (document: Stylesheet): string | undefined => serialize(document, { evaluator }).css;
const renderStrict = (document: Stylesheet): string | undefined =>
  serialize(document, { evaluator: sassEvaluator, modes: { ...DEFAULT_MODES, unitMode: 'strict' } }).css;

// [R16] the caller-read ($property reading the caller's timeline) is opt-in via allowCallerScope.
const renderCallerScope = (document: Stylesheet): string | undefined =>
  serialize(document, { evaluator, modes: { ...DEFAULT_MODES, allowCallerScope: true } }).css;
const entry = (name: string, value: Parameters<typeof collectionEntry>[1]): ReturnType<typeof collectionEntry> =>
  collectionEntry(keyword(name), value);

describe('direct canonical value access', () => {
  it('resolves indirect variables, typed map members, and prior property values', () => {
    const tokens = collection([
      entry('gap', dimension(8, 'px')),
      entry('tone', keyword('navy'))
    ]);
    const document = stylesheet([
      variableDeclaration('indirect-name', keyword('width'), { mode: 'declare' }),
      variableDeclaration('width', dimension(12, 'px'), { mode: 'declare' }),
      variableDeclaration('tokens', tokens, { mode: 'declare' }),
      variableDeclaration('member-name', keyword('tone'), { mode: 'declare' }),
      rule('.card', [
        /* `@@indirect-name` — a var lookup whose NAME is a node, which is what
         * `varIndirect` used to be a separate kind for. */
        decl('width', variableReference(variableReference('indirect-name', 'scoped'), 'scoped')),
        decl('gap', reference(variableReference('tokens', 'scoped'), [{ type: 'LookupStep', name: keyword('gap'), kind: 'prop' }], '@tokens[gap]')),
        decl('color', reference(variableReference('tokens', 'scoped'), [{ type: 'LookupStep', name: variableReference('member-name', 'scoped'), kind: 'var' }], '@tokens[@member-name]')),
        decl('min-width', propertyReference('width'))
      ])
    ]);

    expect(render(document)).toBe('.card {\n'
      + '  width: 12px;\n'
      + '  gap: 8px;\n'
      + '  color: navy;\n'
      + '  min-width: 12px;\n'
      + '}\n');
  });

  it('errors for missing property and map accessors', () => {
    const tokens = collection([
      entry('gap', dimension(8, 'px')),
      entry('tone', keyword('navy'))
    ]);

    expect(() => render(stylesheet([
      variableDeclaration('tokens', tokens, { mode: 'declare' }),
      rule('.card', [decl('gap', reference(
        variableReference('tokens', 'scoped'),
        [{ type: 'LookupStep', name: keyword('missing'), kind: 'prop' }],
        '@tokens[missing]'
      ))])
    ]))).toThrow(/Name not found/);

    expect(() => render(stylesheet([
      rule('.card', [decl('min-width', propertyReference('width'))])
    ]))).toThrow(/Name not found/);
  });

  it('follows ordered dot then bracket reference steps without byte recovery', () => {
    const document = stylesheet([
      variableDeclaration('theme', collection([
        entry('palette', collection([entry('accent', keyword('teal'))]))
      ]), { mode: 'declare' }),
      rule('.card', [
        decl('color', reference(
          variableReference('theme', 'scoped'),
          [{ type: 'LookupStep', kind: 'member', name: 'palette' }, { type: 'LookupStep', name: keyword('accent'), kind: 'prop' }],
          '@theme.palette[accent]'
        ))
      ])
    ]);

    expect(render(document)).toBe('.card {\n  color: teal;\n}\n');
  });

  it('keeps sibling nested collection lookup memos distinct', () => {
    const nestedMember = (name: string) => reference(
      variableReference('theme', 'scoped'),
      [
        { type: 'LookupStep' as const, kind: 'member' as const, name },
        { type: 'LookupStep' as const, kind: 'member' as const, name: 'tone' }
      ],
      `$theme.${name}.tone`
    );
    const document = stylesheet([
      variableDeclaration('theme', collection([
        entry('first', collection([entry('tone', keyword('blue'))])),
        entry('second', collection([entry('tone', keyword('red'))]))
      ]), { mode: 'declare' }),
      rule('.card', [
        decl('first', nestedMember('first')),
        decl('second', nestedMember('second'))
      ])
    ]);

    expect(render(document)).toBe('.card {\n  first: blue;\n  second: red;\n}\n');
  });

  it('looks up the effective later-wins value after collection spread', () => {
    const document = stylesheet([
      variableDeclaration('defaults', collection([entry('tone', keyword('blue'))]), { mode: 'declare' }),
      variableDeclaration('theme', collection([
        collectionSpread(variableReference('defaults', 'scoped')),
        entry('tone', keyword('teal'))
      ]), { mode: 'declare' }),
      rule('.card', [decl('color', reference(
        variableReference('theme', 'scoped'),
        [{ type: 'LookupStep', kind: 'member', name: 'tone' }],
        '@theme[tone]'
      ))])
    ]);

    expect(render(document)).toBe('.card {\n  color: teal;\n}\n');
  });

  it('uses ordered Sass equality for non-transitive collection keys in both orders', () => {
    const lookupRed = (name: string) => reference(
      variableReference(name, 'scoped'),
      [{ type: 'LookupStep' as const, kind: 'member' as const, name: keyword('red') }],
      `@${name}[red]`
    );
    const document = stylesheet([
      variableDeclaration('color-first', collection([
        collectionEntry(color('#ff0000'), keyword('color-value')),
        collectionEntry(quoted('"red"', 'red', '"', false), keyword('quoted-value'))
      ]), { mode: 'declare' }),
      variableDeclaration('quoted-first', collection([
        collectionEntry(quoted('"red"', 'red', '"', false), keyword('quoted-value')),
        collectionEntry(color('#ff0000'), keyword('color-value'))
      ]), { mode: 'declare' }),
      rule('.card', [
        decl('first', lookupRed('color-first')),
        decl('second', lookupRed('quoted-first'))
      ])
    ]);

    expect(render(document)).toBe('.card {\n  first: color-value;\n  second: quoted-value;\n}\n');
  });

  it('keeps Sass map-key equality independent of strict unit mode', () => {
    const document = stylesheet([
      variableDeclaration('key', dimension(1, 'em'), { mode: 'declare' }),
      variableDeclaration('sizes', collection([
        collectionEntry(dimension(1, 'px'), keyword('pixel')),
        collectionEntry(dimension(1, 'em'), keyword('em'))
      ]), { mode: 'declare' }),
      rule('.card', [decl('value', funcCall('map-get', [
        variableReference('sizes', 'scoped'),
        variableReference('key', 'scoped')
      ]))])
    ]);

    expect(renderStrict(document)).toBe('.card {\n  value: em;\n}\n');
  });

  it('routes computed numeric subscripts to positions before map-key lookup', () => {
    const access = (key: string) => reference(
      variableReference('values', 'scoped'),
      [{ type: 'LookupStep' as const, kind: 'var' as const, name: variableReference(key, 'scoped'), indexBase: 0 as const }],
      `@values[@${key}]`
    );
    const values = collection([
      entry('first', keyword('zero-position')),
      entry('second', keyword('one-position')),
      collectionEntry(dimension(1), keyword('numeric-key')),
      collectionEntry(dimension(1.5), keyword('fractional-key')),
      collectionEntry(dimension(1, 'px'), keyword('unit-key'))
    ]);
    const document = stylesheet([
      variableDeclaration('values', values, { mode: 'declare' }),
      variableDeclaration('zero', dimension(0), { mode: 'declare' }),
      variableDeclaration('one', dimension(1), { mode: 'declare' }),
      variableDeclaration('last', dimension(-1), { mode: 'declare' }),
      variableDeclaration('named', keyword('first'), { mode: 'declare' }),
      rule('.card', [
        decl('zero', access('zero')),
        decl('one', access('one')),
        decl('last', access('last')),
        decl('named', access('named'))
      ])
    ]);

    expect(render(document)).toBe('.card {\n'
      + '  zero: zero-position;\n'
      + '  one: one-position;\n'
      + '  last: unit-key;\n'
      + '  named: zero-position;\n'
      + '}\n');

    for (const [name, key] of [
      ['unit', dimension(1, 'px')],
      ['fraction', dimension(1.5)]
    ] as const) {
      expect(() => render(stylesheet([
        variableDeclaration('values', values, { mode: 'declare' }),
        variableDeclaration(name, key, { mode: 'declare' }),
        rule('.card', [decl('value', access(name))])
      ]))).toThrow(/Name not found/);
    }
  });

  it('resolves declaration-member references across property and variable namespaces', () => {
    const document = stylesheet([
      variableDeclaration('tokens', collection([entry('tone', keyword('blue'))]), { mode: 'declare' }),
      rule('.card', [
        variableDeclaration('local', keyword('green'), { mode: 'declare' }),
        decl('tone', keyword('red')),
        decl('from-ns', reference(declarationReference('$'), [{ type: 'LookupStep', kind: 'member', name: 'tokens' }, { type: 'LookupStep', kind: 'member', name: 'tone' }], '$tokens.tone')),
        decl('from-root', reference(declarationReference('$'), [{ type: 'LookupStep', kind: 'member', name: 'tokens' }, { type: 'LookupStep', kind: 'member', name: 'tone' }], '$.tokens.tone')),
        decl('from-var', reference(declarationReference('$'), [{ type: 'LookupStep', kind: 'member', name: 'local' }], '$.local')),
        decl('from-prop', reference(declarationReference('$'), [{ type: 'LookupStep', kind: 'member', name: 'tone' }], '$.tone'))
      ])
    ]);

    expect(render(document)).toBe('.card {\n'
      + '  tone: red;\n'
      + '  from-ns: blue;\n'
      + '  from-root: blue;\n'
      + '  from-var: green;\n'
      + '  from-prop: red;\n'
      + '}\n');
    expect(() => render(stylesheet([
      rule('.card', [
        variableDeclaration('same', keyword('blue'), { mode: 'declare' }),
        decl('same', keyword('red')),
        decl('value', reference(declarationReference('$'), [{ type: 'LookupStep', kind: 'member', name: 'same' }], '$.same'))
      ])
    ]))).toThrow(/Ambiguous reference member: same/);
    expect(() => render(stylesheet([
      rule('.card', [
        variableDeclaration('same', collection([entry('tone', keyword('blue'))]), { mode: 'declare' }),
        decl('same', keyword('red')),
        decl('value', reference(declarationReference('$'), [{ type: 'LookupStep', kind: 'member', name: 'same' }, { type: 'LookupStep', kind: 'member', name: 'tone' }], '$same.tone'))
      ])
    ]))).toThrow(/Ambiguous reference member: same/);
  });

  it('resolves an indirect map-member name in the accessor frame, not the map owner', () => {
    const document = stylesheet([
      variableDeclaration('schemes', collection([
        entry('primary', collection([entry('color', keyword('blue'))]))
      ]), { mode: 'declare' }),
      rule('.entry', [
        variableDeclaration('scheme-name', keyword('primary'), { mode: 'declare' }),
        decl('color', reference(
          variableReference('schemes', 'scoped'),
          [
            { type: 'LookupStep', name: variableReference(variableReference('scheme-name', 'scoped'), 'scoped'), kind: 'var' },
            { type: 'LookupStep', name: keyword('color'), kind: 'prop' }
          ],
          '@schemes[@@scheme-name][color]'
        ))
      ])
    ]);

    expect(render(document)).toBe('.entry {\n  color: blue;\n}\n');
  });

  it('indexes typed list items with Jess zero-based and negative bracket facts', () => {
    const sizes = list([dimension(10, 'px'), dimension(20, 'px'), dimension(30, 'px')], ',');
    const document = stylesheet([
      variableDeclaration('sizes', sizes, { mode: 'declare' }),
      rule('.card', [
        decl('first', reference(variableReference('sizes', 'live'), [{ type: 'LookupStep', name: 0, kind: 'index', indexBase: 0 }], '$sizes[0]')),
        decl('last', reference(variableReference('sizes', 'live'), [{ type: 'LookupStep', name: -1, kind: 'index', indexBase: 0 }], '$sizes[-1]'))
      ])
    ]);

    expect(render(document)).toBe('.card {\n  first: 10px;\n  last: 30px;\n}\n');
  });

  it('reads namespace call variable members from the callee, not a caller shadow', () => {
    const member = (name: string) => [{ type: 'LookupStep' as const, name: variableReference(name, 'scoped'), kind: 'var' as const }];
    const namespaceCall = mixinCall('#ns1');
    const libraryCall = {
      type: 'MixinCall' as const,
      name: '.m', args: [], path: [{ combinator: ' ' as const, selector: '#library' }], important: false, content: null
    };
    const document = stylesheet([
      variableDeclaration('foo', keyword('caller-foo'), { mode: 'declare' }),
      variableDeclaration('key', keyword('return'), { mode: 'declare' }),
      rule('#ns1', [variableDeclaration('foo', keyword('baz'), { mode: 'declare' })]),
      rule('#ns1', [variableDeclaration('foo', keyword('dos'), { mode: 'declare' })]),
      rule('#library', [mixinDef('.m', [], [
        variableDeclaration('key', keyword('callee'), { mode: 'declare' }),
        variableDeclaration('return', keyword('callee-return'), { mode: 'declare' })
      ])]),
      rule('.out', [
        decl('foo', reference(namespaceCall, member('foo'), '#ns1[@foo]')),
        decl('key', reference(libraryCall, member('key'), '#library.m()[@key]')),
        decl('returned', reference(libraryCall, member('return'), '#library.m()[@return]'))
      ])
    ]);

    expect(render(document)).toBe('.out {\n  foo: dos;\n  key: callee;\n  returned: callee-return;\n}\n');
  });

  it('uses the final local variable as a mixin call empty-bracket result', () => {
    const document = stylesheet([
      mixinDef('.add', [{ name: 'left' }, { name: 'right' }], [
        variableDeclaration('return', dimension(20, 'px'), { mode: 'declare' })
      ]),
      rule('.entry', [
        decl('width', reference(
          mixinCall('.add', [{ value: dimension(10, 'px') }, { value: dimension(10, 'px') }]),
          [{ type: 'LookupStep', name: -1, kind: 'index' }],
          '.add(10px, 10px)[-1]'
        ))
      ])
    ]);

    expect(render(document)).toBe('.entry {\n  width: 20px;\n}\n');
  });

  it('keeps the empty-accessor fallback scoped to the final index and final selected callee', () => {
    const last = (key: number) => reference(
      mixinCall('.pick'),
      [{ type: 'LookupStep' as const, name: key, kind: 'index' as const }],
      `.pick()[${key}]`
    );
    const document = stylesheet([
      mixinDef('.pick', [], [variableDeclaration('return', keyword('first'), { mode: 'declare' })]),
      mixinDef('.pick', [], [variableDeclaration('return', keyword('second'), { mode: 'declare' })]),
      rule('.entry', [decl('last', last(-1)), decl('first', last(1))])
    ]);

    expect(render(document)).toBe('.entry {\n  last: second;\n  first: .pick()[1];\n}\n');
  });

  it('propagates importance through a direct property accessor exactly once', () => {
    const document = stylesheet([
      rule('.card', [
        decl('color', keyword('red'), null, true),
        decl('background', propertyReference('color'))
      ])
    ]);

    expect(render(document)).toBe('.card {\n  color: red !important;\n  background: red !important;\n}\n');
  });

  it('carries a property accessor importance signal through a declaration merge', () => {
    const document = stylesheet([
      rule('.card', [
        decl('tone', keyword('navy'), null, true),
        decl('shadow', propertyReference('tone'), ','),
        decl('shadow', keyword('black'), ',')
      ])
    ]);

    expect(render(document)).toBe('.card {\n  tone: navy !important;\n  shadow: navy, black !important;\n}\n');
  });

  it('reads the ordered merged property value from its enclosing timeline', () => {
    const document = stylesheet([
      rule('.card', [
        decl('background-color', keyword('red'), ','),
        decl('background-color', keyword('black'), ','),
        rule('.child', [decl('background', propertyReference('background-color'))])
      ])
    ]);

    expect(render(document)).toBe('.card {\n'
      + '  background-color: red, black;\n'
      + '}\n'
      + '.card .child {\n'
      + '  background: red, black;\n'
      + '}\n');
  });

  it('resets a property-accessor importance signal before a later merge group and plain declaration', () => {
    const document = stylesheet([
      rule('.card', [
        decl('tone', keyword('navy'), null, true),
        decl('shadow', propertyReference('tone'), ','),
        decl('shadow', keyword('black'), ','),
        decl('outline', keyword('solid'), ','),
        decl('outline', keyword('transparent'), ','),
        decl('background', keyword('white'))
      ])
    ]);

    expect(render(document)).toBe('.card {\n'
      + '  tone: navy !important;\n'
      + '  shadow: navy, black !important;\n'
      + '  outline: solid, transparent;\n'
      + '  background: white;\n'
      + '}\n');
  });

  it('uses a mixin-spliced declaration as the final enclosing property value', () => {
    /*
     * The property lookup sees the mixin-spliced value, while the nested child
     * remains a cascade boundary in the authored enclosing declaration order.
     */
    const setLateColor = {
      type: 'MixinDefinition' as const,
      name: '.set-late-color',
      params: [],
      rules: [decl('color', keyword('yellow'))]
    };
    const document = stylesheet([
      setLateColor,
      rule('.block', [
        decl('color', keyword('red')),
        rule('.child', [decl('background', propertyReference('color'))]),
        decl('color', keyword('blue')),
        mixinCall('.set-late-color')
      ])
    ]);

    expect(render(document)).toBe('.block {\n'
      + '  color: red;\n'
      + '}\n'
      + '.block .child {\n'
      + '  background: yellow;\n'
      + '}\n'
      + '.block {\n'
      + '  color: blue;\n'
      + '  color: yellow;\n'
      + '}\n');
  });

  it('resolves a mixin property read after the caller timeline has spliced later declarations (allowCallerScope)', () => {
    const readColor = {
      type: 'MixinDefinition' as const,
      name: '.read-color',
      params: [],
      rules: [decl('from-mixin', propertyReference('color'))]
    };
    const document = stylesheet([
      readColor,
      rule('.card', [
        decl('color', keyword('red')),
        mixinCall('.read-color'),
        decl('color', keyword('blue'))
      ])
    ]);

    expect(renderCallerScope(document)).toBe('.card {\n'
      + '  color: red;\n'
      + '  from-mixin: blue;\n'
      + '  color: blue;\n'
      + '}\n');
  });
});
