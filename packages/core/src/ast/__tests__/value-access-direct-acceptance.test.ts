import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import {
  decl, collection, collectionEntry, dimension, keyword, list, mixinCall, mixinDef, propertyReference, reference, stylesheet, rule,
  variableDeclaration, varIndirect, variableReference, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';

const evaluator = buildEvaluator(makeLessRegistry());
const render = (document: Stylesheet): string | undefined => serialize(document, { evaluator }).css;
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
        decl('width', varIndirect(variableReference('indirect-name', 'scoped'), 'scoped')),
        decl('gap', reference(variableReference('tokens', 'scoped'), [{ type: 'BracketLookup', key: keyword('gap'), keyKind: 'prop' }], '@tokens[gap]')),
        decl('color', reference(variableReference('tokens', 'scoped'), [{ type: 'BracketLookup', key: variableReference('member-name', 'scoped'), keyKind: 'var' }], '@tokens[@member-name]')),
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
        [{ type: 'BracketLookup', key: keyword('missing'), keyKind: 'prop' }],
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
          [{ type: 'DotLookup', name: 'palette' }, { type: 'BracketLookup', key: keyword('accent'), keyKind: 'prop' }],
          '@theme.palette[accent]'
        ))
      ])
    ]);

    expect(render(document)).toBe('.card {\n  color: teal;\n}\n');
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
            { type: 'BracketLookup', key: varIndirect(variableReference('scheme-name', 'scoped'), 'scoped'), keyKind: 'var' },
            { type: 'BracketLookup', key: keyword('color'), keyKind: 'prop' }
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
        decl('first', reference(variableReference('sizes', 'live'), [{ type: 'BracketLookup', key: 0, keyKind: 'index', indexBase: 0 }], '$sizes[0]')),
        decl('last', reference(variableReference('sizes', 'live'), [{ type: 'BracketLookup', key: -1, keyKind: 'index', indexBase: 0 }], '$sizes[-1]'))
      ])
    ]);

    expect(render(document)).toBe('.card {\n  first: 10px;\n  last: 30px;\n}\n');
  });

  it('reads namespace call variable members from the callee, not a caller shadow', () => {
    const member = (name: string) => [{ type: 'BracketLookup' as const, key: variableReference(name, 'scoped'), keyKind: 'var' as const }];
    const namespaceCall = mixinCall('#ns1');
    const libraryCall = {
      type: 'MixinCall' as const,
      name: '.m', args: [], path: [{ comb: ' ' as const, sel: '#library' }], important: false
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
          [{ type: 'BracketLookup', key: -1, keyKind: 'index' }],
          '.add(10px, 10px)[-1]'
        ))
      ])
    ]);

    expect(render(document)).toBe('.entry {\n  width: 20px;\n}\n');
  });

  it('keeps the empty-accessor fallback scoped to the final index and final selected callee', () => {
    const last = (key: number) => reference(
      mixinCall('.pick'),
      [{ type: 'BracketLookup' as const, key, keyKind: 'index' as const }],
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

  it('resolves a mixin property read after the caller timeline has spliced later declarations', () => {
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

    expect(render(document)).toBe('.card {\n'
      + '  color: red;\n'
      + '  from-mixin: blue;\n'
      + '  color: blue;\n'
      + '}\n');
  });
});
