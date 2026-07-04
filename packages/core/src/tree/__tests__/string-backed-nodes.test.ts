import { describe, expect, test } from 'vitest';
import { Context } from '../../context.js';
import {
  N,
  Declaration,
  Node,
  any,
  atrule,
  atrulestatement,
  decl,
  ref,
  rules,
  ruleset,
  vardecl
} from '../index.js';
import { isNode } from '../util/is-node.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { serializeTypes } from '../util/serialize-types.js';

describe('string-backed scanner-first proof nodes', () => {
  test('renders string-backed core declarations without allocating value wrappers', () => {
    const declaration = decl({
      name: 'color',
      value: ['blue']
    });

    expect(declaration).toBeInstanceOf(Declaration);
    expect(declaration.toTrimmedString()).toBe('color: blue');
    expect(declaration.name).toBe('color');
    expect(declaration.value).toEqual(['blue']);
    expect(serializeTypes(declaration)).toBeString(`
      (Declaration
        name: 'color'
        value:
          [
            'blue'
          ]
      )
    `);
  });

  test('writes string-backed core declaration render output without allocating value wrappers', () => {
    const context = new Context();
    const buffer = createRenderBuffer('segmented');
    const declaration = decl({
      name: 'width',
      value: ['calc(', '100%', ' - ', '1px', ')'],
      important: true
    });

    expect(declaration.render(context, buffer)).toBe('width: calc(100% - 1px) !important');
    expect(buffer.segments).toEqual(['width: calc(100% - 1px) !important']);
  });

  test('writes multiline string-backed core declaration values on continuation lines', () => {
    const declaration = decl({
      name: 'grid-template-areas',
      value: ['"header header header"\n    "content . sidebar"\n    "footer footer footer"']
    });

    expect(declaration.toTrimmedString()).toBe([
      'grid-template-areas: "header header header"',
      '    "content . sidebar"',
      '    "footer footer footer"'
    ].join('\n'));
  });

  test('parents explicit declaration node segments without value wrapper allocation', () => {
    const segment = any('100%');
    const declaration = decl({
      name: 'width',
      value: ['calc(', segment, ' - 1px)']
    });

    expect(segment.parent).toBe(declaration);
    expect(declaration.value).toEqual(['calc(', segment, ' - 1px)']);
    expect(declaration.toTrimmedString()).toBe('width: calc(100% - 1px)');
    expect(serializeTypes(declaration)).toBeString(`
      (Declaration
        name: 'width'
        value:
          [
            'calc('
            (Any '100%')
            ' - 1px)'
          ]
      )
    `);
  });

  test('materializes explicit declaration node segments when semantic registration asks', () => {
    const context = new Context();
    const segment = any('100%');
    const declaration = decl({
      name: 'width',
      value: [segment]
    });

    void declaration.prepareRegistration(context);
    expect(declaration.value).toBe(segment);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    expect((declaration.value as Node).parent).toBe(declaration);
  });

  test('materializes mixed declaration segments into a reachable value container', () => {
    const context = new Context();
    const segment = any('100%');
    const declaration = decl({
      name: 'width',
      value: ['calc(', segment, ' - 1px)']
    });

    void declaration.prepareRegistration(context);
    expect(isNode(declaration.value, N.Sequence)).toBe(true);
    expect(segment.parent).toBe(declaration.value);
    expect(serializeTypes(declaration)).toContain('(Sequence');
  });

  test('renders string-backed core declarations through existing rule containers', () => {
    const rootDeclaration = decl({
      name: 'color',
      value: ['blue']
    });
    const childDeclaration = decl({
      name: 'color',
      value: ['blue']
    });
    const root = rules([rootDeclaration]);
    const childRuleset = ruleset({
      selector: '.a',
      rules: [childDeclaration]
    });

    expect(root.toTrimmedString()).toBe('color: blue;');
    expect(childRuleset.toTrimmedString()).toBe('.a {\n  color: blue;\n}\n');
  });

  test('renders string-selector core rulesets without selector child nodes', () => {
    const node = ruleset({
      selector: '.a',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    expect(node.toTrimmedString()).toBe('.a {\n  color: blue;\n}\n');
    expect(node.selector).toBe('.a');
    expect(serializeTypes(node)).toBeString(`
      (Ruleset
        selector: '.a'
        rules:
          [
            (Declaration
              name: 'color'
              value:
                [
                  'blue'
                ]
            )
          ]
      )
    `);
  });

  test('materializes string core ruleset selectors only when semantic registration asks', () => {
    const context = new Context();
    const node = ruleset({
      selector: '.a',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    expect(node.selector).toBe('.a');
    void node.prepareRegistration(context);
    expect(node.selector).toBeDefined();
    const selector = node.selector;
    expect(isNode(selector, N.CompoundSelector)).toBe(true);
    if (!selector || !isNode(selector, N.CompoundSelector)) {
      throw new Error('Expected string selector to remain a CompoundSelector.');
    }
    expect(selector.value).toEqual(['.a']);
    const types = serializeTypes(node);
    expect(types).toContain('(CompoundSelector');
    expect(types).toContain('\'.a\'');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('rawSelector');
  });

  test('keeps cheap compound ruleset selectors as strings until semantic registration', () => {
    const context = new Context();
    const classCompound = ruleset({
      selector: '.a.b',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    const elementCompound = ruleset({
      selector: 'button.primary',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    expect(classCompound.toTrimmedString()).toBe('.a.b {\n  color: blue;\n}\n');
    expect(classCompound.selector).toBe('.a.b');
    expect(serializeTypes(classCompound)).toContain('selector: \'.a.b\'');
    void classCompound.prepareRegistration(context);
    expect(classCompound.selector).toBeDefined();
    const classTypes = serializeTypes(classCompound);
    expect(classTypes).toContain('(CompoundSelector');
    if (!classCompound.selector || !isNode(classCompound.selector, N.CompoundSelector)) {
      throw new Error('Expected class compound string selector to materialize as a CompoundSelector.');
    }
    expect(classCompound.selector.value).toEqual(['.a', '.b']);
    expect(classTypes).not.toContain('(BasicSelector');
    expect(classTypes).not.toContain('rawSelector');

    expect(elementCompound.toTrimmedString()).toBe('button.primary {\n  color: blue;\n}\n');
    expect(elementCompound.selector).toBe('button.primary');
    void elementCompound.prepareRegistration(context);
    const elementTypes = serializeTypes(elementCompound);
    expect(elementTypes).toContain('(CompoundSelector');
    if (!elementCompound.selector || !isNode(elementCompound.selector, N.CompoundSelector)) {
      throw new Error('Expected element compound string selector to materialize as a CompoundSelector.');
    }
    expect(elementCompound.selector.value).toEqual(['button', '.primary']);
    expect(elementTypes).not.toContain('(BasicSelector');
  });

  test('materializes string ampersand pseudo selectors only when semantic registration asks', () => {
    const context = new Context();
    const node = ruleset({
      selector: '&:focus',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    expect(node.toTrimmedString()).toBe('&:focus {\n  color: blue;\n}\n');
    expect(node.selector).toBe('&:focus');
    expect(serializeTypes(node)).toContain('selector: \'&:focus\'');
    void node.prepareRegistration(context);
    const selector = node.selector;
    expect(selector).toBeDefined();
    expect(isNode(selector, N.CompoundSelector)).toBe(true);
    if (!selector || !isNode(selector, N.CompoundSelector)) {
      return;
    }
    expect(selector.parent).toBe(node);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    expect((selector.value[0]! as Node).parent).toBe(selector);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    expect((selector.value[1]! as Node).parent).toBe(selector);
    const types = serializeTypes(node);
    expect(types).toContain('(CompoundSelector');
    expect(types).toContain('(Ampersand');
    expect(types).toContain('(PseudoSelector');
    expect(types).toContain('name: \':focus\'');
    expect(types).not.toContain('rawSelector');
  });

  test('materializes string pseudo selector atoms as string components only when semantic registration asks', () => {
    const context = new Context();
    for (const selectorText of [':root', '.a:hover', '[data-kind]']) {
      const node = ruleset({
        selector: selectorText,
        rules: [
          decl({
            name: 'color',
            value: ['blue']
          })
        ]
      });

      expect(node.toTrimmedString()).toBe(`${selectorText} {\n  color: blue;\n}\n`);
      expect(node.selector).toBe(selectorText);
      expect(serializeTypes(node)).toContain(`selector: '${selectorText}'`);
      void node.prepareRegistration(context);
      const selector = node.selector;
      expect(selector).toBeDefined();
      expect(isNode(selector, N.CompoundSelector)).toBe(true);
      if (!selector || !isNode(selector, N.CompoundSelector)) {
        throw new Error(`Expected ${selectorText} to materialize as a compound selector.`);
      }
      expect(selector.value).toEqual(
        selectorText === '.a:hover'
          ? ['.a', ':hover']
          : [selectorText]
      );
      const types = serializeTypes(node);
      expect(types).toContain('(CompoundSelector');
      expect(types).not.toContain('(PseudoSelector');
      expect(types).not.toContain('(AttributeSelector');
      expect(types).not.toContain('(BasicSelector');
      expect(types).not.toContain('rawSelector');
    }
  });

  test('accepts string-backed ruleset selectors verbatim (the parser is the authority)', () => {
    // The runtime no longer has an opinion on selector syntax: it stores whatever
    // string the parser produced, materializing to nodes lazily when needed.
    for (const selector of [':hover(1)', '&:focus, .b', '.a &:focus', '0%']) {
      const node = ruleset({ selector, rules: [] });
      expect(node.selector).toBe(selector);
    }
  });

  test('renders string-backed core at-rules without name or prelude child nodes', () => {
    const node = atrule({
      name: '@media',
      prelude: 'screen',
      rules: [
        ruleset({
          selector: '.a',
          rules: [
            decl({
              name: 'color',
              value: ['blue']
            })
          ]
        })
      ]
    });

    expect(node.toTrimmedString()).toBe('@media screen {\n  .a {\n    color: blue;\n  }\n}\n');
    expect(node.name).toBe('@media');
    expect(node.prelude).toBe('screen');
    expect(serializeTypes(node)).toBeString(`
      (AtRule
        name: '@media'
        prelude: 'screen'
        rules:
          [
            (Ruleset
              selector: '.a'
              rules:
                [
                  (Declaration
                    name: 'color'
                    value:
                      [
                        'blue'
                      ]
                  )
                ]
            )
          ]
      )
    `);
  });

  test('prepares string-backed rulesets under string-backed at-rule parents without materializing the header', () => {
    const context = new Context();
    const child = ruleset({
      selector: '.a',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });
    const node = atrule({
      name: '@media',
      prelude: 'screen',
      rules: [child]
    });

    expect(node.name).toBe('@media');
    expect(() => child.prepareRegistration(context)).not.toThrow();
    expect(node.name).toBe('@media');
  });

  test('keeps string-backed core at-rule headers during semantic registration when strings are enough', () => {
    const context = new Context();
    const node = atrule({
      name: '@media',
      prelude: 'screen',
      rules: [
        ruleset({
          selector: '.a',
          rules: []
        })
      ]
    });

    expect(node.name).toBe('@media');
    expect(node.prelude).toBe('screen');
    void node.prepareRegistration(context);
    expect(node.name).toBe('@media');
    expect(node.prelude).toBe('screen');
    const types = serializeTypes(node);
    expect(types).toContain('name: \'@media\'');
    expect(types).toContain('prelude: \'screen\'');
    expect(types).not.toContain('(Any [role=atkeyword] \'@media\')');
  });

  test('renders string-backed core at-rule statements without name or prelude child nodes', () => {
    const context = new Context();
    const node = atrulestatement({
      name: '@charset',
      prelude: '"UTF-8"'
    });

    expect(node.toTrimmedString()).toBe('@charset "UTF-8";');
    expect(node.name).toBe('@charset');
    expect(node.prelude).toBe('"UTF-8"');
    expect(serializeTypes(node).trim()).toBe(`(AtRuleStatement
  name: '@charset'
  prelude: '"UTF-8"'
)`);

    void rules([node]).prepareRegistration(context);
    expect(node.name).toBe('@charset');
    expect(node.prelude).toBe('"UTF-8"');
  });

  test('evaluates node preludes on string-name core at-rule statements', async () => {
    const context = new Context();
    const node = atrulestatement({
      name: '@import',
      prelude: ref({ key: 'target' }, { type: 'variable' })
    });
    const root = rules([
      vardecl({ name: 'target', value: any('"theme.css"') }),
      node
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    await expect(Promise.resolve(node.render(context))).resolves.toBe('@import "theme.css";');
  });

  test('renders string-backed core import statements without name or prelude child nodes', () => {
    const node = atrulestatement({
      name: '@import',
      prelude: '"theme.css" screen'
    });

    expect(node.toTrimmedString()).toBe('@import "theme.css" screen;');
    expect(node.name).toBe('@import');
    expect(node.prelude).toBe('"theme.css" screen');
    expect(serializeTypes(node).trim()).toBe(`(AtRuleStatement
  name: '@import'
  prelude: '"theme.css" screen'
)`);
  });

  test('materializes string-backed core declarations only when semantic registration asks', () => {
    const context = new Context();
    const declaration = decl({
      name: 'color',
      value: ['blue']
    });

    expect(declaration.name).toBe('color');
    expect(declaration.value).toEqual(['blue']);
    void declaration.prepareRegistration(context);
    expect(declaration.name).toBeDefined();
    expect(declaration.value).toBeDefined();
    expect(declaration.name).toBe('color');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    expect((declaration.value as Node).parent).toBe(declaration);
    expect(declaration.toTrimmedString()).toBe('color: blue');
    expect(serializeTypes(declaration)).toContain('name: \'color\'');
  });
});
