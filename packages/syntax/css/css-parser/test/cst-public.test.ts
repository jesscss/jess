import { describe, expect, it } from 'vitest';
import { absolutizeCST } from 'parseman';
import { parseCssCst, parseCssDoc } from '../src/cst-css.js';
import type { CssCstChild } from '../src/cst-css.js';

/**
 * Structural CST equality (type + absolute span + children, leaves by value+span).
 * `parseDoc().tree` carries PARENT-RELATIVE spans, so absolutize before comparing
 * to a one-shot `parseCst().tree` (absolute).
 */
function cstStructKey(node: CssCstChild): unknown {
  if (node._tag === 'leaf') {
    return { l: node.value, s: node.span.start, e: node.span.end };
  }
  if (node._tag === 'error') {
    return { err: node.type, s: node.span.start, e: node.span.end, rules: node.rules.map(cstStructKey) };
  }
  return { t: node.type, s: node.span.start, e: node.span.end, rules: node.rules.map(cstStructKey) };
}

type CstNode = ReturnType<typeof parseCssCst>['tree'];

function nodesByGrammarType(tree: CstNode, grammarType: string): CstNode[] {
  const matches: CstNode[] = [];
  const visit = (node: CstNode | CstNode['children'][number]) => {
    if (node._tag !== 'node') {
      return;
    }
    if (node.grammarType === grammarType) {
      matches.push(node);
    }
    node.rules.forEach(visit);
  };
  visit(tree);
  return matches;
}

function collect(tree: CstNode) {
  let leaves = 0;
  let basicSelectors = 0;
  const types = new Set<string>();
  const visit = (node: CstNode | CstNode['children'][number]) => {
    if (node._tag === 'leaf') {
      leaves++;
      return;
    }
    if (node._tag === 'node') {
      types.add(node.type);
      if (node.type === 'BasicSelector') {
        basicSelectors++;
      }
      node.rules.forEach(visit);
    }
  };
  visit(tree);
  return { leaves, basicSelectors, types };
}

describe('@jesscss/css-parser/cst', () => {
  it('parses CSS through the public core-free CST entry', () => {
    const result = parseCssCst('a { color: red; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.tree.type).toBe('StyleSheet');
    expect(result.tree.rules.some(c => c._tag === 'node' && c.type === 'QualifiedRule')).toBe(true);
  });

  it('ignores trailing CSS trivia but reports a non-trivia tail', () => {
    const trailingTrivia = parseCssCst('a { color: red; } /* trailing */\n');
    const trailingJunk = parseCssCst('a { color: red; } ???');

    expect(trailingTrivia.errors).toHaveLength(0);
    expect(trailingTrivia.unconsumedFrom).toBeNull();
    expect(trailingJunk.unconsumedFrom).not.toBeNull();
  });

  it('exports parseCssCst and accepts collapse mode', () => {
    const result = parseCssCst('a.foo { color: red; }', 'Stylesheet', { collapse: true });

    expect(result.errors).toHaveLength(0);
    expect(result.tree.rules.some(c => c._tag === 'node' && c.type === 'QualifiedRule')).toBe(true);
  });

  it('keeps named CSS CST nodes stable with and without collapse mode', () => {
    const expanded = parseCssCst('a.foo { color: red; }');
    const collapsed = parseCssCst('a.foo { color: red; }', 'Stylesheet', { collapse: true });

    expect(expanded.errors).toHaveLength(0);
    expect(collapsed.errors).toHaveLength(0);
    expect([...collect(collapsed.tree).types]).not.toContain('Unknown');
    expect(collect(collapsed.tree)).toMatchObject({ leaves: collect(expanded.tree).leaves, basicSelectors: 2 });
  });

  it('keeps CSS static escaped strings as a sigil plus a normal Quoted CST node', () => {
    const result = parseCssCst('.asset { theme: ~"dark"; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(nodesByGrammarType(result.tree, 'Quoted').map(node => [
      node.span.start,
      node.span.end
    ])).toEqual([[17, 23]]);
  });

  it('does not recognize comment-delimited url identifiers as url or function tokens', () => {
    const ordinary = parseCssCst('.asset { background: url(icon.svg); }');
    const commentDelimited = parseCssCst('.asset { background: url/* name-open */(icon.svg); }');

    expect(ordinary.errors).toHaveLength(0);
    expect(commentDelimited.errors).toHaveLength(0);
    expect(nodesByGrammarType(ordinary.tree, 'Url')).toHaveLength(1);
    expect(nodesByGrammarType(commentDelimited.tree, 'Url')).toHaveLength(0);
    expect(nodesByGrammarType(commentDelimited.tree, 'Call')).toHaveLength(0);
  });

  it('does not recognize spaced known function names as dedicated function CST nodes', () => {
    for (const source of [
      '.asset { background: url (x); }',
      '.asset { width: calc (1px + 2px); }',
      '.asset { color: var (--x); }'
    ]) {
      const result = parseCssCst(source);

      expect(result.errors, source).toHaveLength(0);
      expect(result.unconsumedFrom, source).toBeNull();
      expect(nodesByGrammarType(result.tree, 'Url'), source).toHaveLength(0);
      expect(nodesByGrammarType(result.tree, 'Call'), source).toHaveLength(0);
      expect(nodesByGrammarType(result.tree, 'CalcCall'), source).toHaveLength(0);
      expect(nodesByGrammarType(result.tree, 'VarCall'), source).toHaveLength(0);
    }
  });

  it('does not unglue spaced query function names into QueryFunction CST nodes', () => {
    const invalidStyle = parseCssCst('@container style (--theme: dark) { .card { color: red; } }');
    const spacedScrollState = parseCssCst('@container scroll-state (stuck: block-start) { .card { color: red; } }');

    expect(invalidStyle.errors.length + (invalidStyle.unconsumedFrom === null ? 0 : 1)).toBeGreaterThan(0);
    expect(nodesByGrammarType(invalidStyle.tree, 'QueryFunction')).toHaveLength(0);
    expect(spacedScrollState.errors).toHaveLength(0);
    expect(spacedScrollState.unconsumedFrom).toBeNull();
    expect(nodesByGrammarType(spacedScrollState.tree, 'QueryFunction')).toHaveLength(0);
  });

  it('routes query identifier and function terms without leaking the dispatcher node', () => {
    const result = parseCssCst('@media screen and style(--theme: dark) { .card { color: red; } }');
    const queryFunction = nodesByGrammarType(result.tree, 'QueryFunction')[0];

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(nodesByGrammarType(result.tree, 'QueryNonOnlyKeyword')).toHaveLength(2);
    expect(nodesByGrammarType(result.tree, 'QueryFunction')).toHaveLength(1);
    expect(nodesByGrammarType(result.tree, 'QueryIdentOrFunction')).toHaveLength(0);
    expect(queryFunction?.rules[0]).toMatchObject({
      _tag: 'leaf',
      value: 'style('
    });
  });

  it('keeps reserved query keyword checks at word boundaries', () => {
    const onlyscreen = parseCssCst('@media onlyscreen and (hover) { .card { color: red; } }');
    const layerish = parseCssCst('@media layerish and (hover) { .card { color: red; } }');
    const noneish = parseCssCst('@container noneish (min-width: 1px) { .card { color: red; } }');
    const bareOnly = parseCssCst('@media only (hover) { .card { color: red; } }');

    expect(onlyscreen.errors).toHaveLength(0);
    expect(onlyscreen.unconsumedFrom).toBeNull();
    expect(layerish.errors).toHaveLength(0);
    expect(layerish.unconsumedFrom).toBeNull();
    expect(noneish.errors).toHaveLength(0);
    expect(noneish.unconsumedFrom).toBeNull();
    expect(bareOnly.errors.length + (bareOnly.unconsumedFrom === null ? 0 : 1)).toBeGreaterThan(0);
  });

  it('keeps the public url opener as one CST leaf while matching case-insensitively', () => {
    const result = parseCssCst('.asset { background: URL(icon.svg); }');

    expect(result.errors).toHaveLength(0);
    const url = nodesByGrammarType(result.tree, 'Url')[0];
    expect(url?.rules[0]).toMatchObject({
      _tag: 'leaf',
      value: 'URL('
    });
  });

  it('routes calc identifier and function atoms without leaking the dispatcher node', () => {
    const result = parseCssCst('.asset { width: calc(var(--x) + foo(1px)); }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(nodesByGrammarType(result.tree, 'CalcCall')).toHaveLength(1);
    expect(nodesByGrammarType(result.tree, 'VarCall')).toHaveLength(1);
    expect(nodesByGrammarType(result.tree, 'Call')).toHaveLength(1);
    expect(nodesByGrammarType(result.tree, 'CalcIdentOrFunction')).toHaveLength(0);
  });

  it('does not recognize whitespace-separated identifiers as function calls', () => {
    const glued = parseCssCst('.asset { filter: alpha(opacity=50); }');
    const spaced = parseCssCst('.asset { filter: alpha (opacity=50); }');

    expect(glued.errors).toHaveLength(0);
    expect(spaced.errors).toHaveLength(0);
    expect(nodesByGrammarType(glued.tree, 'Call').length).toBeGreaterThan(0);
    expect(nodesByGrammarType(spaced.tree, 'Call')).toHaveLength(0);
  });

  it('keeps legacy public CST labels for punctuation and parenthesized value helpers', () => {
    const result = parseCssCst('.asset { a: (foo); b: foo|bar; c: foo (bar); }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(nodesByGrammarType(result.tree, 'DeclarationParen').length).toBeGreaterThan(0);
    expect(nodesByGrammarType(result.tree, 'DeclarationAny').length).toBeGreaterThan(0);
    expect(nodesByGrammarType(result.tree, 'DeclarationRawParen').length).toBeGreaterThan(0);
    expect(nodesByGrammarType(result.tree, 'PunctuationValue')).toHaveLength(0);
    expect(nodesByGrammarType(result.tree, 'ParenValue')).toHaveLength(0);
    expect(nodesByGrammarType(result.tree, 'RawParenValue')).toHaveLength(0);
  });

  it('keeps percentage recognition separate from dimensions and numbers', () => {
    const result = parseCssCst('.asset { width: 50%; height: 10px; opacity: .5; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(nodesByGrammarType(result.tree, 'Percentage')).toHaveLength(1);
    expect(nodesByGrammarType(result.tree, 'Dimension')).toHaveLength(1);
    expect(nodesByGrammarType(result.tree, 'Num')).toHaveLength(1);
  });

  it('uses spec dashed-ident recognition for custom property names', () => {
    const escapedName = parseCssCst('.asset { --\\78: red; }');
    const bareReservedName = parseCssCst('.asset { --: red; }');

    expect(escapedName.errors).toHaveLength(0);
    expect(escapedName.unconsumedFrom).toBeNull();
    expect(nodesByGrammarType(escapedName.tree, 'CustomDeclaration')).toHaveLength(1);
    expect(bareReservedName.errors.length + (bareReservedName.unconsumedFrom === null ? 0 : 1)).toBeGreaterThan(0);
  });

  it('uses container-specific conditional at-rule preludes', () => {
    const namedOnly = parseCssCst('@container only { .card { color: red; } }');
    const namedQuery = parseCssCst('@container only (min-width: 1px) { .card { color: red; } }');
    const functionQuery = parseCssCst('@container style(--theme: dark) { .card { color: red; } }');
    const reservedName = parseCssCst('@container none { .card { color: red; } }');
    const supportsWithContainerName = parseCssCst('@supports only (display: grid) { .card { color: red; } }');

    expect(namedOnly.errors).toHaveLength(0);
    expect(namedQuery.errors).toHaveLength(0);
    expect(functionQuery.errors).toHaveLength(0);
    expect(nodesByGrammarType(functionQuery.tree, 'QueryFunction')).toHaveLength(1);
    expect(reservedName.errors.length + (reservedName.unconsumedFrom === null ? 0 : 1)).toBeGreaterThan(0);
    expect(supportsWithContainerName.errors.length + (supportsWithContainerName.unconsumedFrom === null ? 0 : 1)).toBeGreaterThan(0);
  });

  it('uses media-specific conditional at-rule preludes', () => {
    const mediaType = parseCssCst('@media screen { .card { color: red; } }');
    const mediaTypeWithFeature = parseCssCst('@media screen and (min-width: 1px) { .card { color: red; } }');
    const modifierList = parseCssCst('@media only screen, print { .card { color: red; } }');
    const negatedTail = parseCssCst('@media screen and not (color) { .card { color: red; } }');
    const invalidModifier = parseCssCst('@media only (hover) { .card { color: red; } }');
    const invalidLayerType = parseCssCst('@media layer { .card { color: red; } }');
    const invalidOnlyLayerType = parseCssCst('@media only layer { .card { color: red; } }');

    expect(mediaType.errors).toHaveLength(0);
    expect(mediaTypeWithFeature.errors).toHaveLength(0);
    expect(modifierList.errors).toHaveLength(0);
    expect(negatedTail.errors).toHaveLength(0);
    expect(nodesByGrammarType(mediaType.tree, 'QueryAtRuleBlock')).toHaveLength(1);
    expect(nodesByGrammarType(modifierList.tree, 'QueryAtRuleBlock')).toHaveLength(1);
    expect(invalidModifier.errors.length + (invalidModifier.unconsumedFrom === null ? 0 : 1)).toBeGreaterThan(0);
    expect(invalidLayerType.errors.length + (invalidLayerType.unconsumedFrom === null ? 0 : 1)).toBeGreaterThan(0);
    expect(invalidOnlyLayerType.errors.length + (invalidOnlyLayerType.unconsumedFrom === null ? 0 : 1)).toBeGreaterThan(0);
  });

  it('requires declaration separators before following nested body items', () => {
    const finalDeclaration = parseCssCst('.card { color: red }');
    const beforeNestedAtRule = parseCssCst('.card { color: red @media (width: 1px) { color: blue; } }');
    const beforeNestedRule = parseCssCst('.card { color: red .child { color: blue; } }');

    expect(finalDeclaration.errors).toHaveLength(0);
    expect(finalDeclaration.unconsumedFrom).toBeNull();
    expect(beforeNestedAtRule.errors.length + (beforeNestedAtRule.unconsumedFrom === null ? 0 : 1)).toBeGreaterThan(0);
    expect(beforeNestedRule.errors.length + (beforeNestedRule.unconsumedFrom === null ? 0 : 1)).toBeGreaterThan(0);
  });
});

const CSS_DOC_CORPUS: string[] = [
  'a { color: red; }',
  '.x{a:1}',
  'a { color: red; }\n.b { width: 10px; height: 20px; }',
  '@media (min-width: 600px) { .a { display: block; } }',
  'a,\nb ,\nc { margin: 0 }',
  '.grid { grid-template: "a b" 1fr / auto; padding: calc(1px + 2px); }',
  ':root { --x: 10px; } a { width: var(--x); }',
  '/* leading */\na { /* inner */ color: red; } /* trailing */',
  'a/**/{ color: red; }',
  '@import "x.css";\n@font-face { font-family: F; src: url(f.woff2); }'
];

describe('@jesscss/css-parser/cst — parseCssDoc structural parity', () => {
  it('parseCssDoc().tree (absolutized) equals parseCssCst().tree across a corpus', () => {
    for (const input of CSS_DOC_CORPUS) {
      const oneShot = parseCssCst(input);
      const doc = parseCssDoc(input);
      const tree = doc.tree;
      expect(tree, `doc parsed: ${JSON.stringify(input)}`).not.toBeNull();
      if (!tree) {
        continue;
      }
      const abs = absolutizeCST(tree);
      expect(cstStructKey(abs), `mismatch for: ${JSON.stringify(input)}`).toEqual(cstStructKey(oneShot.tree));
    }
  });
});
