import {
  Ampersand,
  ComplexSelector,
  isNode,
  N,
  Nil,
  Ruleset,
  SelectorList,
  sourceSpanOf,
  type LocationInfo,
  type Node,
  type Rules,
  type Selector,
  type TreeContext
} from '@jesscss/core';

export function createNullParentAmpersand(context?: TreeContext, selector?: Selector): Ampersand {
  const location = selector ? sourceSpanOf(selector) : undefined;
  const nil = new Nil(undefined, undefined, location, context);
  const amp = new Ampersand(
    { selectorContainer: { selector: nil } },
    undefined,
    location,
    context
  );
  amp.adopt(nil);
  return amp;
}

function getNodeLocation(node: Node): LocationInfo | undefined {
  return sourceSpanOf(node);
}

export function prefixAtRootSelector(selector: Selector, context?: TreeContext): Selector {
  if (isNode(selector, N.SelectorList)) {
    const list = selector;
    return new SelectorList(
      list.value.map(item => prefixAtRootSelector(item, context)),
      undefined,
      getNodeLocation(selector),
      context
    );
  }

  const amp = createNullParentAmpersand(context, selector);
  if (isNode(selector, N.ComplexSelector)) {
    const complex = selector;
    return new ComplexSelector(
      [amp, ...complex.value],
      undefined,
      getNodeLocation(selector),
      context
    );
  }

  return new ComplexSelector([amp, selector], undefined, getNodeLocation(selector), context);
}

export function lowerPlainAtRootRules(rules: Rules, context?: TreeContext): void {
  const transformRule = (node: Node): Node => {
    if (isNode(node, N.Ruleset)) {
      const rs = node;
      if (!isNode(rs.selector, N.Nil)) {
        return new Ruleset({
          selector: prefixAtRootSelector(rs.selector, context),
          rules: rs.rules,
          ...(rs.guard !== undefined && { guard: rs.guard }),
          ...(rs.selectorBeforeExtend !== undefined && {
            selectorBeforeExtend: rs.selectorBeforeExtend
          })
        }, rs.options, sourceSpanOf(rs), context);
      }
      return node;
    }

    if (isNode(node, N.AtRule) && node.rules) {
      lowerPlainAtRootRules(node.rules, context);
      return node;
    }

    if (isNode(node, N.If)) {
      lowerPlainAtRootRules(node, context);
      if (node.else) {
        lowerPlainAtRootRules(node.else, context);
      }
      return node;
    }

    if (isNode(node, N.For)) {
      lowerPlainAtRootRules(node, context);
      return node;
    }

    if (isNode(node, N.While)) {
      lowerPlainAtRootRules(node, context);
      return node;
    }

    return node;
  };

  for (let i = 0; i < rules.rules.length; i++) {
    rules.rules[i] = transformRule(rules.rules[i]!);
  }
}
