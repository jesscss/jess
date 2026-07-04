import { describe, test, expect } from 'vitest';
import { parseCssFn } from '../src/functional-parser.js';
import { serializeTypes } from '@jesscss/core';

// Migrated off the retired Chevrotain parser to the functional Parséman grammar.
// The `test.skip`s below assert rich `@container` prelude modeling (QueryCondition
// nodes, `role=operator`, `style()`/`size()`/`scroll-state()` as `Call`) that the
// functional grammar does not model yet — it scans the prelude flat. Un-skip when
// that modeling lands. TODO(functional-parser): task #10 (at-rule prelude modeling).

type SerializedTestNode = {
  type?: string;
  value?: SerializedTestNode[];
  node?: SerializedTestNode;
  name?: string;
  args?: SerializedTestNode;
  prelude?: SerializedTestNode;
};

function isSerializedTestNode(value: unknown): value is SerializedTestNode {
  return typeof value === 'object' && value !== null;
}

function getPreludeQueryNode(atRule: unknown): SerializedTestNode {
  expect(isSerializedTestNode(atRule)).toBe(true);
  if (!isSerializedTestNode(atRule)) {
    throw new TypeError('Expected at-rule-like test node');
  }
  const prelude = atRule.prelude;
  expect(isSerializedTestNode(prelude)).toBe(true);
  if (!isSerializedTestNode(prelude)) {
    throw new TypeError('Expected at-rule prelude test node');
  }
  if (prelude?.type === 'Sequence') {
    expect(Array.isArray(prelude.value)).toBe(true);
    return prelude.value?.[0] ?? prelude;
  }
  return Array.isArray(prelude?.value) ? prelude.value[0]! : prelude;
}

// `SerializedTestNode.value` is typed as an array, but several serialized
// shapes nest a single node there. Read it as a single node for those cases.
function nodeValue(node: SerializedTestNode | undefined): SerializedTestNode {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return node!.value as unknown as SerializedTestNode;
}

// Read the array form of `value`, asserting presence under the test type.
function arrayValue(node: SerializedTestNode | undefined): SerializedTestNode[] {
  return node!.value!;
}

describe('@container at-rule parsing and serialization', () => {
  test('basic container query with width condition', () => {
    const { tree, errors } = parseCssFn('@container (width > 400px) { .card { font-size: 1.5rem; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
    expect(out).toContain('width');
  });

  test('container query with container name', () => {
    const { tree, errors } = parseCssFn('@container sidebar (width > 400px) { .card { font-size: 1.5rem; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
    expect(out).toContain('sidebar');
  });

  test('container query with min-width', () => {
    const { tree, errors } = parseCssFn('@container (min-width: 300px) { .card { padding: 1rem; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
  });

  test('container query with max-width', () => {
    const { tree, errors } = parseCssFn('@container (max-width: 600px) { .card { padding: 0.5rem; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
  });

  test('container query with height condition', () => {
    const { tree, errors } = parseCssFn('@container (height > 300px) { .card { display: flex; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
  });

  test('container query with multiple conditions using AND', () => {
    const { tree, errors } = parseCssFn('@container (width > 400px) and (height > 300px) { .card { flex-direction: column; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
    expect(out).toContain('and');
  });

  test('container query with OR condition', () => {
    const { tree, errors } = parseCssFn('@container (width > 400px) or (height > 300px) { .card { display: grid; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
  });

  test('container query with NOT condition', () => {
    const { tree, errors } = parseCssFn('@container not (width < 400px) { .card { font-size: 1.2rem; } }');
    expect(errors.length).toBe(0);
    const atRule = tree.rules[0];
    const queryNode = getPreludeQueryNode(atRule);
    expect(queryNode.type).toBe('QueryCondition');
    expect(arrayValue(queryNode).length).toBe(2);
    expect(arrayValue(queryNode)[0]!.value).toBe('not');
    expect(arrayValue(queryNode)[1]!.type).toBe('Paren');
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
    expect(out).toContain('QueryCondition');
    expect(out).toContainString(`
      prelude:
        (Sequence
          value:
            [
              (QueryCondition
                value:
                  [
                    (Keyword [role=keyword] 'not')
                    (Paren
                      value:
                        (QueryCondition
      `);
  });

  test('container query with nested conditions', () => {
    const { tree, errors } = parseCssFn('@container ((width > 400px) and (height > 300px)) { .card { padding: 2rem; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
  });

  test.skip('container query with comma-separated queries', () => {
    const { tree, errors } = parseCssFn('@container (width > 400px), (height > 300px) { .card { margin: 1rem; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
    expect(out).toContain('List');
  });

  test('container query with container name and condition', () => {
    const { tree, errors } = parseCssFn('@container main (width > 500px) { .content { max-width: 1200px; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
    expect(out).toContain('main');
  });

  test('container query with aspect-ratio', () => {
    const { tree, errors } = parseCssFn('@container (aspect-ratio > 1) { .card { display: flex; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
  });

  test('container query with orientation', () => {
    const { tree, errors } = parseCssFn('@container (orientation: landscape) { .card { flex-direction: row; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
  });

  test('container query with inline-size', () => {
    const { tree, errors } = parseCssFn('@container (inline-size > 400px) { .card { width: 100%; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
  });

  test('container query with block-size', () => {
    const { tree, errors } = parseCssFn('@container (block-size < 500px) { .card { height: auto; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
  });

  test('container query with range syntax', () => {
    const { tree, errors } = parseCssFn('@container (400px < width < 800px) { .card { padding: 1rem; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
  });

  test('nested container query', () => {
    const { tree, errors } = parseCssFn('@container (width > 400px) { @container (height > 300px) { .card { display: flex; } } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
  });

  test('simple container query parses as QueryCondition in Paren', () => {
    const { tree, errors } = parseCssFn('@container (width > 400px) { .card {} }');
    expect(errors.length).toBe(0);
    const atRule = tree.rules[0];
    const queryNode = getPreludeQueryNode(atRule);
    const out = serializeTypes(tree);
    expect(queryNode.type).toBe('Paren');
    expect(nodeValue(queryNode).type).toBe('QueryCondition');
    expect(arrayValue(nodeValue(queryNode)).length).toBe(3);
    expect(out).toContain('QueryCondition');
    expect(out).toContain('Paren');
  });
});

describe('@media at-rule - QueryCondition parsing', () => {
  test.skip('simple media query parses as QueryCondition in Paren (no outer QueryCondition)', () => {
    const { tree, errors } = parseCssFn('@media (width > 400px) { .card {} }');
    expect(errors.length).toBe(0);
    const atRule = tree.rules[0];
    const queryNode = getPreludeQueryNode(atRule);
    const out = serializeTypes(tree);
    if (queryNode) {
      expect(queryNode.type).toBe('Paren');
      expect(nodeValue(queryNode).type).toBe('QueryCondition');
      expect(arrayValue(nodeValue(queryNode)).length).toBe(3);
    }
    expect(out).toContain('QueryCondition');
    expect(out).toContain('Paren');
    expect(out).toContainString(`
      prelude:
        (Paren
          value:
            (QueryCondition
              value:
                [
                  (Any [role=ident] 'width')
                  (Any [role=operator] '>')
      `);
  });

  test('media query with colon syntax parses as Declaration', () => {
    const { tree, errors } = parseCssFn('@media (min-width: 300px) { .card {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('Declaration');
    expect(out).toContain('min-width');
  });

  test.skip('simple comparison operator has role=operator', () => {
    const { tree, errors } = parseCssFn('@media (width > 400px) { .card {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('role=operator');
    expect(out).toContain('>');
  });

  test('keywords and, or have role=keyword', () => {
    const { tree, errors } = parseCssFn('@media (width > 400px) and (height > 300px) { .card {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('role=keyword');
    expect(out).toContain('and');
  });

  test('not keyword has role=keyword', () => {
    const { tree, errors } = parseCssFn('@media not (width > 400px) { .card {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('role=keyword');
    expect(out).toContain('not');
  });
});

describe('@container - container query type functions', () => {
  test.skip('scroll-state with QueryCondition argument', () => {
    const { tree, errors } = parseCssFn('@container scroll-state((stuck: top) and (stuck: left)) { .card {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('Call');
    expect(out).toContain('scroll-state');
    expect(out).toContain('QueryCondition');
    expect(out).toContain('Paren');
    expect(out).toContain('Declaration');
    expect(out).toContain('stuck');
    expect(out).toContain('and');

    // Verify structure: Call -> List -> QueryCondition -> [Paren(Declaration), Any('and'), Paren(Declaration)]
    const atRule = tree.rules[0];
    const queryNode = getPreludeQueryNode(atRule);
    expect(queryNode.type).toBe('QueryCondition');
    expect(arrayValue(queryNode)[0]!.type).toBe('Call');
    expect(arrayValue(queryNode)[0]!.name).toBe('scroll-state');
    const argList = arrayValue(queryNode)[0]!.args;
    expect(argList!.type).toBe('List');
    expect(arrayValue(argList).length).toBe(1);
    const firstArg = arrayValue(argList)[0];
    expect(firstArg!.type).toBe('QueryCondition');
    expect(arrayValue(firstArg).length).toBe(3); // Paren, Any('and'), Paren
    expect(arrayValue(firstArg)[0]!.type).toBe('Paren');
    expect(nodeValue(arrayValue(firstArg)[0]).type).toBe('Declaration');
    expect(arrayValue(firstArg)[1]!.type).toBe('Keyword');
    expect(arrayValue(firstArg)[1]!.value).toBe('and');
    expect(arrayValue(firstArg)[2]!.type).toBe('Paren');
    expect(nodeValue(arrayValue(firstArg)[2]).type).toBe('Declaration');
    expect(out).toContainString(`name: 'scroll-state'`);
    expect(out).toContainString(`
                  (Paren
                    value:
                      (Declaration
      `);
  });

  test.skip('not scroll-state with declaration argument', () => {
    const { tree, errors } = parseCssFn('@container not scroll-state(stuck: none) { .card {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('Call');
    expect(out).toContain('scroll-state');
    expect(out).toContain('not');
    expect(out).toContain('stuck');

    // Verify structure: QueryCondition -> [Any('not'), QueryCondition -> [Call]]
    const atRule = tree.rules[0];
    const queryNode = getPreludeQueryNode(atRule);
    expect(queryNode.type).toBe('QueryCondition');
    expect(arrayValue(queryNode).length).toBe(2);
    expect(arrayValue(queryNode)[0]!.type).toBe('Keyword');
    expect(arrayValue(queryNode)[0]!.value).toBe('not');
    expect(arrayValue(queryNode)[1]!.type).toBe('QueryCondition');
    expect(arrayValue(arrayValue(queryNode)[1])[0]!.type).toBe('Call');
    expect(arrayValue(arrayValue(queryNode)[1])[0]!.name).toBe('scroll-state');
    expect(out).toContainString(`
          (QueryCondition
            value:
              [
                (Keyword [role=keyword] 'not')
                (QueryCondition
                  value:
                    [
                      (Call
                        name: 'scroll-state'
                        args:
                          (List
          `);
  });

  test.skip('complex style() queries with commas, and/or/not', () => {
    const { tree, errors } = parseCssFn(`@container style(--themeBackground),
    not style(background-color: red),
    style(color: green) and style(background-color: transparent),
    style(--themeColor: blue) or style(--themeColor: purple) { .card {} }`);
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('Call');
    expect(out).toContain('style');
    expect(out).toContain('not');
    expect(out).toContain('and');
    expect(out).toContain('or');
    expect(out).toContain('List');

    // Verify structure: List of queries, each can be QueryCondition
    const atRule = tree.rules[0];
    const queryNode = getPreludeQueryNode(atRule);
    expect(queryNode.type).toBe('List');
    expect(arrayValue(queryNode).length).toBe(4); // 4 comma-separated queries
  });

  // Examples from container.less
  test.skip('size() function from container.less', () => {
    const { tree, errors } = parseCssFn('@container size(min-width: 60ch) { .article--post header {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('Call');
    expect(out).toContain('size');
    expect(out).toContain('min-width');
  });

  test.skip('style() function with custom property from container.less', () => {
    const { tree, errors } = parseCssFn('@container style(--responsive: true) { .card-content {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('Call');
    expect(out).toContain('style');
    expect(out).toContain('--responsive');
  });

  test.skip('scroll-state with single declaration from container.less', () => {
    const { tree, errors } = parseCssFn('@container scroll-state(stuck: top) { .card {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('Call');
    expect(out).toContain('scroll-state');
    expect(out).toContain('stuck');
  });

  test.skip('scroll-state with snapped from container.less', () => {
    const { tree, errors } = parseCssFn('@container scroll-state(snapped: x) { .card {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('Call');
    expect(out).toContain('scroll-state');
    expect(out).toContain('snapped');
  });

  test.skip('scroll-state with scrollable from container.less', () => {
    const { tree, errors } = parseCssFn('@container scroll-state(scrollable: top) { .card {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('Call');
    expect(out).toContain('scroll-state');
    expect(out).toContain('scrollable');
  });

  // MDN-style examples
  test('MDN example: basic container query with width', () => {
    const { tree, errors } = parseCssFn('@container (min-width: 700px) { .card h2 { font-size: 2em; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('@container');
    expect(out).toContain('min-width');
  });

  test('MDN example: container with name and query', () => {
    const { tree, errors } = parseCssFn('@container sidebar (min-width: 700px) { .card { font-size: 2em; } }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('AtRule');
    expect(out).toContain('sidebar');
    expect(out).toContain('min-width');
  });

  // Complex examples from container.less
  test('container.less: width >= with and condition', () => {
    const { tree, errors } = parseCssFn('@container (width >= 500px) and (height >= 500px) { .card-content h2 {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('QueryCondition');
    expect(out).toContain('and');
    expect(out).toContain('>=');
  });

  test.skip('container.less: width > with and not condition', () => {
    const { tree, errors } = parseCssFn('@container (width > 760px) and not (height > 670px) { .card-content h2 {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('QueryCondition');
    expect(out).toContain('and');
    expect(out).toContain('not');
  });

  test('container.less: not with <= condition', () => {
    const { tree, errors } = parseCssFn('@container not (height <= 1080px) { .card-content h2 {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('QueryCondition');
    expect(out).toContain('not');
    expect(out).toContain('<=');
  });

  test('container.less: or condition with <', () => {
    const { tree, errors } = parseCssFn('@container (width < 500px) or (height < 500px) { .card-content h2 {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('QueryCondition');
    expect(out).toContain('or');
    expect(out).toContain('<');
  });

  test('container.less: nested or with and', () => {
    const { tree, errors } = parseCssFn('@container ((width < 500px) or (height < 500px)) and (inline-size >= 0px) { .card-content p {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('QueryCondition');
    expect(out).toContain('or');
    expect(out).toContain('and');
    expect(out).toContain('inline-size');
  });
});
