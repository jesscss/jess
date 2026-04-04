import {
  any,
  atrule,
  call,
  decl,
  el,
  mixin,
  Node,
  ref,
  rules,
  ruleset,
  sel,
  vardecl
} from '../index.js';
import { Context } from '../../context.js';
import { CALLER, CANONICAL, EVAL } from '../node.js';
import {
  getChildren,
  getDependency,
  getIndex,
  getParent,
  getSourceParent,
  isEvaluated,
  isPreEvaluated,
  isTopLevelVarDeclaration,
  mergeDependencies,
  setChildren,
  setChildAt,
  setDependency,
  setEvaluated,
  setIndex,
  setParent,
  setPreEvaluated,
  setSourceParent
} from '../util/field-helpers.js';
import {
  addEdge,
  addEdgeAt,
  addParentEdge,
  getEdge,
  getEdgeAt,
  getParentEdge,
  lookupEdge,
  removeParentEdge
} from '../util/cursor.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';

function collectFrameChain(start: Node, context: Context): Node[] {
  const frames: Node[] = [];
  let cursor: Node | undefined = start;
  while (cursor) {
    if (isNode(cursor, N.Ruleset | N.AtRule)) {
      frames.push(cursor);
    }
    cursor = getParent(cursor, context);
  }
  return frames;
}

function collectParentThenCallerChain(start: Node, context: Context): Node[] {
  const visited = new Set<Node>();
  const out: Node[] = [];
  let cursor: Node | undefined = start;
  let pendingCaller: Node | undefined;

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    out.push(cursor);
    pendingCaller ??= cursor.parentEdges?.get(CALLER);
    const nextParent = getParent(cursor, context);
    if (nextParent) {
      cursor = nextParent;
      continue;
    }
    cursor = pendingCaller;
    pendingCaller = undefined;
  }

  return out;
}

function findFirstNode(node: Node, predicate: (current: Node) => boolean): Node | undefined {
  if (predicate(node)) {
    return node;
  }

  if (isNode(node, N.Rules)) {
    for (const child of node.get('value') as readonly Node[]) {
      const found = findFirstNode(child, predicate);
      if (found) {
        return found;
      }
    }
  }

  if (isNode(node, N.Ruleset)) {
    return findFirstNode((node as any).get('rules'), predicate);
  }

  if (isNode(node, N.AtRule)) {
    const childRules = (node as any).enterRules?.();
    if (childRules) {
      return findFirstNode(childRules, predicate);
    }
  }

  return undefined;
}

describe('Node graph', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('canonical parent walks record ruleset and at-rule frames in structural order', () => {
    const leafDecl = decl({ name: 'color', value: any('red') });
    const innerRuleset = ruleset({
      selector: sel([el('.item')]),
      rules: rules([leafDecl])
    });
    const media = atrule({
      name: any('@media'),
      prelude: any('(min-width: 1px)'),
      rules: rules([innerRuleset])
    });
    const outerRuleset = ruleset({
      selector: sel([el('.host')]),
      rules: rules([media])
    });

    expect(collectFrameChain(leafDecl, context)).toEqual([innerRuleset, media, outerRuleset]);
  });

  it('render-key wrappers preserve effective frame chains for shared canonical children', () => {
    const leafDecl = decl({ name: 'color', value: any('red') });
    const innerRuleset = ruleset({
      selector: sel([el('.item')]),
      rules: rules([leafDecl])
    });
    const media = atrule({
      name: any('@media'),
      prelude: any('(min-width: 1px)'),
      rules: rules([innerRuleset])
    });
    const outerRuleset = ruleset({
      selector: sel([el('.host')]),
      rules: rules([media])
    });
    const root = rules([outerRuleset]);
    const wrapper = root.createShallowBodyWrapper(context);
    const activeContext = new Context();
    activeContext.renderKey = wrapper.renderKey;

    expect(getParentEdge({ node: outerRuleset, renderKey: wrapper.renderKey })?.node).toBe(wrapper);
    expect(collectFrameChain(leafDecl, context)).toEqual([innerRuleset, media, outerRuleset]);
    expect(collectFrameChain(leafDecl, activeContext)).toEqual([innerRuleset, media, outerRuleset]);
  });

  it('detached unlock wrappers preserve effective frame chains for shared canonical children', () => {
    const leafDecl = decl({ name: 'color', value: any('red') });
    const innerRuleset = ruleset({
      selector: sel([el('.item')]),
      rules: rules([leafDecl])
    });
    const media = atrule({
      name: any('@media'),
      prelude: any('(min-width: 1px)'),
      rules: rules([innerRuleset])
    });
    const outerRuleset = ruleset({
      selector: sel([el('.host')]),
      rules: rules([media])
    });
    const root = rules([outerRuleset]);
    const wrapper = root.cloneDetachedUnlockWrapper(context);
    const activeContext = new Context();
    activeContext.renderKey = wrapper.renderKey;

    expect(getParentEdge({ node: outerRuleset, renderKey: wrapper.renderKey })?.node).toBe(wrapper);
    expect(collectFrameChain(leafDecl, context)).toEqual([innerRuleset, media, outerRuleset]);
    expect(collectFrameChain(leafDecl, activeContext)).toEqual([innerRuleset, media, outerRuleset]);
  });

  it('render-key replacement changes only the active parent chain for replacement nodes', () => {
    const canonicalDecl = decl({ name: 'color', value: any('red') });
    const canonicalRuleset = ruleset({
      selector: sel([el('.item')]),
      rules: rules([canonicalDecl])
    });
    const root = rules([canonicalRuleset]);
    const wrapper = root.createShallowBodyWrapper(context);

    const replacementDecl = decl({ name: 'color', value: any('blue') });
    const replacementRuleset = ruleset({
      selector: sel([el('.other')]),
      rules: rules([replacementDecl])
    });

    const activeContext = new Context();
    activeContext.renderKey = wrapper.renderKey;
    setChildren(wrapper, [replacementRuleset], activeContext, { markDirty: false });

    expect(collectFrameChain(canonicalDecl, context)).toEqual([canonicalRuleset]);
    expect(collectFrameChain(replacementDecl, activeContext)).toEqual([replacementRuleset]);
    expect(getParent(replacementRuleset, activeContext)).toBe(wrapper);
    expect(getParent(canonicalRuleset, activeContext)).toBe(root);
  });

  it('caller-aware traversal can use CALLER as a secondary lane after the primary parent walk ends', () => {
    const caller = ruleset({
      selector: sel([el('.caller')]),
      rules: rules([])
    });
    const definition = ruleset({
      selector: sel([el('.definition')]),
      rules: rules([])
    });
    const detached = rules([]);
    const leafDecl = decl({ name: 'color', value: any('red') });

    detached.adopt(leafDecl);
    setParent(detached, definition, context);
    addParentEdge(detached, CALLER, caller);

    expect(collectFrameChain(leafDecl, context)).toEqual([definition]);
    expect(collectParentThenCallerChain(leafDecl, context)).toEqual([leafDecl, detached, definition, caller]);
  });

  it.fails('simple emitted mixin output keeps emitted nested rulesets on the caller-owned frame chain', async () => {
    const root = rules([
      mixin({
        name: any('.with-param'),
        rules: rules([
          ruleset({
            selector: sel([el('.item')]),
            rules: rules([
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      }),
      ruleset({
        selector: sel([el('.host')]),
        rules: rules([
          call({ name: ref({ key: '.with-param' }, { type: 'mixin' }) })
        ])
      })
    ]);
    context.root = root;

    const evald = await root.eval(context);
    const hostRuleset = findFirstNode(evald, (child) => (
      isNode(child, N.Ruleset)
      && String((child as any).getSelector?.(child.renderKey)?.valueOf?.() ?? '') === '.host'
    ))!;
    const emittedRuleset = findFirstNode(hostRuleset, (child) => (
      isNode(child, N.Ruleset)
      && String((child as any).getSelector?.(child.renderKey)?.valueOf?.() ?? '') === '.item'
    ))!;
    const emittedLeaf = (emittedRuleset as any).get('rules').get('value')[0] as Node;

    expect(collectFrameChain(emittedLeaf, context)).toEqual([emittedRuleset, hostRuleset]);
  });

  it('documents that getParent may consult node.renderKey before falling back to canonical parent', () => {
    const parent = ruleset({
      selector: sel([el('.parent')]),
      rules: rules([])
    });
    const wrapper = rules([]);
    wrapper.renderKey = EVAL;
    const child = decl({ name: 'color', value: any('red') });

    setParent(child, parent, context);
    addParentEdge(child, EVAL, wrapper);

    expect(getParent(child, context)).toBe(wrapper);
    expect(getParent(child, { ...context, renderKey: EVAL } as Context)).toBe(wrapper);
  });

  it('covers singular and indexed child edges with canonical guards and render-key fallback', () => {
    const selector = sel([el('.host')]);
    const alternateSelector = sel([el('.active')]);
    const canonicalChild = decl({ name: 'color', value: any('red') });
    const body = rules([canonicalChild]);
    const alternateChild = decl({ name: 'background', value: any('blue') });
    const node = ruleset({ selector, rules: body });

    expect(getEdge({ node, renderKey: EVAL }, 'selector')?.node).toBe(selector);
    addEdge(node, 'selector', EVAL, alternateSelector);
    expect(getEdge({ node, renderKey: EVAL }, 'selector')?.node).toBe(alternateSelector);
    expect(getEdge({ node, renderKey: CALLER }, 'selector')?.node).toBe(selector);
    expect(lookupEdge((node as any).selectorEdge, EVAL)).toBe(alternateSelector);
    expect(() => addEdge(node, 'selector', CANONICAL, selector)).not.toThrow();
    expect(() => addEdge(node, 'selector', CANONICAL, alternateSelector)).toThrow(
      'Cannot add a second CANONICAL edge for Ruleset.selector'
    );

    expect(getEdgeAt({ node: body, renderKey: EVAL }, 'value', 0)?.node).toBe(canonicalChild);
    addEdgeAt(body, 'value', 0, EVAL, alternateChild);
    expect(getEdgeAt({ node: body, renderKey: EVAL }, 'value', 0)?.node).toBe(alternateChild);
    expect(getEdgeAt({ node: body, renderKey: CALLER }, 'value', 0)?.node).toBe(canonicalChild);
    expect(() => addEdgeAt(body, 'value', 0, CANONICAL, canonicalChild)).not.toThrow();
    expect(() => addEdgeAt(body, 'value', 0, CANONICAL, alternateChild)).toThrow(
      'Cannot add a second CANONICAL edge for Rules.value[0]'
    );
  });

  it('covers canonical edge guards and parent-edge cleanup', () => {
    const parent = rules([]);
    const child = decl({ name: 'color', value: any('red') });
    const sibling = decl({ name: 'background', value: any('blue') });
    const otherParent = rules([]);

    setParent(child, parent, context);
    expect(() => addParentEdge(child, CANONICAL, parent)).not.toThrow();
    expect(() => addParentEdge(child, CANONICAL, otherParent)).toThrow(
      'Cannot add a second CANONICAL parent edge for Declaration'
    );
    addParentEdge(child, EVAL, parent);
    expect(getParentEdge({ node: child, renderKey: EVAL })?.node).toBe(parent);
    removeParentEdge(child, EVAL);
    expect(child.parentEdges).toBeUndefined();
    expect(() => removeParentEdge(sibling, EVAL)).not.toThrow();
  });

  it('covers field metadata helpers and top-level var detection', () => {
    const topVar = vardecl({ name: 'tone', value: any('red') });
    const nestedVar = vardecl({ name: 'accent', value: any('blue') });
    const nestedRules = rules([nestedVar]);
    const root = rules([topVar, ruleset({ selector: sel([el('.host')]), rules: nestedRules })]);
    context.root = root;

    expect(isEvaluated(topVar, context)).toBe(false);
    setEvaluated(topVar, true, context);
    expect(isEvaluated(topVar, context)).toBe(true);

    expect(isPreEvaluated(topVar, context)).toBe(false);
    setPreEvaluated(topVar, true, context);
    expect(isPreEvaluated(topVar, context)).toBe(true);

    setIndex(topVar, 4, context);
    expect(getIndex(topVar, context)).toBe(4);

    setSourceParent(topVar, root, context);
    expect(getSourceParent(topVar, context)).toBe(root);

    expect(isTopLevelVarDeclaration(topVar, context)).toBe(true);
    expect(isTopLevelVarDeclaration(nestedVar, context)).toBe(false);
    expect(isTopLevelVarDeclaration(decl({ name: 'color', value: any('red') }), context)).toBe(false);
  });

  it('covers dependency helpers and merge semantics', () => {
    const first = decl({ name: 'color', value: any('red') });
    const second = decl({ name: 'background', value: any('blue') });
    const tone = vardecl({ name: 'tone', value: any('red') });
    const accent = vardecl({ name: 'accent', value: any('blue') });

    expect(getDependency(first, context)).toBeNull();

    setDependency(first, { dependsOn: new Set([tone]), sourceExpr: first }, context);
    setDependency(second, { dependsOn: new Set([accent]), sourceExpr: second }, context);

    const merged = mergeDependencies([first, second, undefined], context);
    expect(merged?.dependsOn ? [...merged.dependsOn] : []).toEqual([tone, accent]);
    expect(merged?.sourceExpr).toBe(first);
    expect(mergeDependencies([undefined], context)).toBeNull();
  });

  it('covers setChildren, setChildAt, and getChildren across canonical and render-key branches', () => {
    const first = decl({ name: 'color', value: any('red') });
    const second = decl({ name: 'background', value: any('blue') });
    const root = rules([first, second]);

    expect(getChildren(root, context)).toEqual([first, second]);

    const canonicalReplacement = decl({ name: 'border', value: any('1px') });
    setChildAt(root, 1, canonicalReplacement, context, { markDirty: false });
    expect(root.value[1]).toBe(canonicalReplacement);
    expect(getParent(canonicalReplacement, context)).toBe(root);

    const wrapper = root.createShallowBodyWrapper(context);
    const activeContext = { ...context, renderKey: wrapper.renderKey } as Context;
    const renderReplacement = decl({ name: 'outline', value: any('2px') });
    setChildren(wrapper, [first, renderReplacement], activeContext, { markDirty: false });
    expect(getChildren(wrapper, activeContext)).toEqual([first, renderReplacement]);
    expect(getParent(renderReplacement, activeContext)).toBe(wrapper);
    expect(getParent(first, activeContext)).toBe(wrapper);

    const indexedReplacement = decl({ name: 'shadow', value: any('3px') });
    setChildAt(wrapper, 1, indexedReplacement, activeContext, { markDirty: false });
    expect(getChildren(wrapper, activeContext)[1]).toBe(indexedReplacement);
    expect(getParent(indexedReplacement, activeContext)).toBe(wrapper);

    setParent(indexedReplacement, undefined, activeContext);
    expect(getParentEdge({ node: indexedReplacement, renderKey: wrapper.renderKey })).toBeUndefined();
  });

  it('covers render-key overlays on canonical Rules and same-node no-op updates', () => {
    const first = decl({ name: 'color', value: any('red') });
    const second = decl({ name: 'background', value: any('blue') });
    const root = rules([first, second]);
    const activeContext = { ...context, renderKey: EVAL } as Context;

    const overlayReplacement = decl({ name: 'border', value: any('1px') });
    setChildren(root, [first, overlayReplacement], activeContext, { markDirty: true });
    expect(getChildren(root, activeContext)).toEqual([first, overlayReplacement]);
    expect(getParent(overlayReplacement, activeContext)).toBe(root);

    const indexedReplacement = decl({ name: 'outline', value: any('2px') });
    setChildAt(root, 1, indexedReplacement, activeContext, { markDirty: true });
    expect(getChildren(root, activeContext)[1]).toBe(indexedReplacement);
    expect(getParent(indexedReplacement, activeContext)).toBe(root);

    setChildAt(root, 1, indexedReplacement, activeContext, { markDirty: true });
    setChildAt(root, 0, first, context, { markDirty: true });
    expect(getChildren(root, context)[0]).toBe(first);
  });

  it('covers undefined edge fallback and empty-parent branches', () => {
    const parentless = decl({ name: 'color', value: any('red') });
    expect(getParent(parentless, context)).toBeUndefined();
    expect(getParentEdge({ node: parentless, renderKey: EVAL })).toBeUndefined();

    const host = ruleset({
      selector: sel([el('.host')]),
      rules: rules([])
    });
    const selector = host.get('selector');
    (host as any).selectorEdge = new Map([[EVAL, undefined]]);
    expect(getEdge({ node: host, renderKey: EVAL }, 'selector')?.node).toBe(selector);
    expect(getEdge({ node: host, renderKey: CALLER }, 'selector')?.node).toBe(selector);

    const body = host.get('rules');
    (body as any).valueEdges = [new Map([[EVAL, undefined]])];
    expect(getEdgeAt({ node: body, renderKey: EVAL }, 'value', 0)).toBeUndefined();
    expect(getEdgeAt({ node: body, renderKey: CALLER }, 'value', 0)).toBeUndefined();

    const child = decl({ name: 'border', value: any('1px') });
    setParent(child, host, context);
    expect(getParentEdge({ node: child, renderKey: CALLER })?.node).toBe(host);
    expect(getEdge({ node: host, renderKey: EVAL }, 'guard')).toBeUndefined();
    expect(getEdgeAt({ node: body, renderKey: EVAL }, 'value', 3)).toBeUndefined();
  });

  it('covers canonical setChildren and same-node setChildAt fast paths', () => {
    const first = decl({ name: 'color', value: any('red') });
    const second = decl({ name: 'background', value: any('blue') });
    const root = rules([first]);

    setChildren(root, [first, second], context);
    expect(getChildren(root, context)).toEqual([first, second]);
    expect(getParent(second, context)).toBe(root);

    const wrapper = root.createShallowBodyWrapper(context);
    const activeContext = { ...context, renderKey: wrapper.renderKey } as Context;
    const current = getChildren(wrapper, activeContext)[0]!;
    setChildAt(wrapper, 0, current, activeContext);
    expect(getChildren(wrapper, activeContext)[0]).toBe(current);

    const third = decl({ name: 'border', value: any('1px') });
    setChildren(root, [first, third], context, { markDirty: false });
    expect(getChildren(root, context)).toEqual([first, third]);
  });

  it('covers markDirty-default branches for setChildren and setChildAt', () => {
    const first = decl({ name: 'color', value: any('red') });
    const second = decl({ name: 'background', value: any('blue') });
    const root = rules([first]);
    const wrapper = root.createShallowBodyWrapper(context);
    const activeContext = { ...context, renderKey: wrapper.renderKey } as Context;

    setChildren(wrapper, [second], activeContext);
    expect(getChildren(wrapper, activeContext)).toEqual([second]);

    const third = decl({ name: 'border', value: any('1px') });
    setChildAt(wrapper, 0, third, activeContext);
    expect(getChildren(wrapper, activeContext)[0]).toBe(third);

    const canonicalReplacement = decl({ name: 'outline', value: any('2px') });
    setChildAt(root, 0, canonicalReplacement, context);
    expect(getChildren(root, context)[0]).toBe(canonicalReplacement);
  });

  it('documents overlay setChildren on canonical Rules as removing parent edges without truncating stale higher child-edge entries', () => {
    const first = decl({ name: 'color', value: any('red') });
    const second = decl({ name: 'background', value: any('blue') });
    const root = rules([first, second]);
    const overlayContext = { ...context, renderKey: EVAL } as Context;

    const firstOverlay = decl({ name: 'border', value: any('1px') });
    const secondOverlay = decl({ name: 'outline', value: any('2px') });
    setChildren(root, [firstOverlay, secondOverlay], overlayContext);
    expect(getParent(firstOverlay, overlayContext)).toBe(root);
    expect(getParent(secondOverlay, overlayContext)).toBe(root);

    const replacement = decl({ name: 'shadow', value: any('3px') });
    setChildren(root, [replacement], overlayContext);
    expect(getChildren(root, overlayContext)).toEqual([replacement, secondOverlay]);
    expect(getParent(replacement, overlayContext)).toBe(root);
    expect(getParentEdge({ node: firstOverlay, renderKey: EVAL })).toBeUndefined();
    expect(getParentEdge({ node: secondOverlay, renderKey: EVAL })).toBeUndefined();

    const quietReplacement = decl({ name: 'ring', value: any('4px') });
    setChildren(root, [quietReplacement], overlayContext, { markDirty: false });
    expect(getParent(quietReplacement, overlayContext)).toBe(root);
  });

  it('treats explicit blank edge entries as absent at the cursor layer', () => {
    const parent = rules([]);
    const child = decl({ name: 'color', value: any('red') });
    setParent(child, parent, context);
    child.parentEdges = new Map([[EVAL, null as unknown as Node]]);
    expect(getParentEdge({ node: child, renderKey: EVAL })).toBeUndefined();

    const host = ruleset({
      selector: sel([el('.host')]),
      rules: rules([decl({ name: 'background', value: any('blue') })])
    });
    (host as any).selectorEdge = new Map([[EVAL, null]]);
    expect(getEdge({ node: host, renderKey: EVAL }, 'selector')).toBeUndefined();

    const body = host.get('rules');
    (body as any).valueEdges = [new Map([[EVAL, null]])];
    expect(getEdgeAt({ node: body, renderKey: EVAL }, 'value', 0)).toBeUndefined();
  });

  it('removes prior render-key parents when setChildAt replaces a wrapper child', () => {
    const first = decl({ name: 'color', value: any('red') });
    const root = rules([first]);
    const wrapper = root.createShallowBodyWrapper(context);
    const wrapperContext = { ...context, renderKey: wrapper.renderKey } as Context;

    const initial = decl({ name: 'background', value: any('blue') });
    setChildAt(wrapper, 0, initial, wrapperContext);
    expect(getParent(initial, wrapperContext)).toBe(wrapper);

    const replacement = decl({ name: 'border', value: any('1px') });
    setChildAt(wrapper, 0, replacement, wrapperContext);
    expect(getChildren(wrapper, wrapperContext)[0]).toBe(replacement);
    expect(getParent(replacement, wrapperContext)).toBe(wrapper);
    expect(getParentEdge({ node: initial, renderKey: wrapper.renderKey })).toBeUndefined();

    const appended = decl({ name: 'outline', value: any('2px') });
    setChildAt(wrapper, 4, appended, wrapperContext, { markDirty: false });
    expect(getChildren(wrapper, wrapperContext)[4]).toBe(appended);
  });

  it('documents sparse overlay setChildAt on canonical Rules as attaching parent edges without extending visible children length', () => {
    const first = decl({ name: 'color', value: any('red') });
    const root = rules([first]);
    const overlayContext = { ...context, renderKey: EVAL } as Context;

    const initial = decl({ name: 'background', value: any('blue') });
    setChildAt(root, 0, initial, overlayContext);
    expect(getParent(initial, overlayContext)).toBe(root);

    const replacement = decl({ name: 'outline', value: any('2px') });
    setChildAt(root, 0, replacement, overlayContext);
    expect(getChildren(root, overlayContext)[0]).toBe(replacement);
    expect(getParent(replacement, overlayContext)).toBe(root);
    expect(getParentEdge({ node: initial, renderKey: EVAL })).toBeUndefined();

    const appended = decl({ name: 'shadow', value: any('3px') });
    setChildAt(root, 4, appended, overlayContext, { markDirty: false });
    expect(getParent(appended, overlayContext)).toBe(root);
    expect(getChildren(root, overlayContext)[4]).toBeUndefined();
  });

  it('covers replacement branches in both render-key setChildAt paths', () => {
    const first = decl({ name: 'color', value: any('red') });
    const root = rules([first]);
    const wrapper = root.createShallowBodyWrapper(context);
    const wrapperContext = { ...context, renderKey: wrapper.renderKey } as Context;

    const wrapperReplacement = decl({ name: 'background', value: any('blue') });
    setChildAt(wrapper, 0, wrapperReplacement, wrapperContext);
    const wrapperNext = decl({ name: 'border', value: any('1px') });
    setChildAt(wrapper, 0, wrapperNext, wrapperContext);
    expect(getChildren(wrapper, wrapperContext)[0]).toBe(wrapperNext);

    const overlayReplacement = decl({ name: 'outline', value: any('2px') });
    const overlayContext = { ...context, renderKey: EVAL } as Context;
    setChildAt(root, 0, overlayReplacement, overlayContext);
    const overlayNext = decl({ name: 'shadow', value: any('3px') });
    setChildAt(root, 0, overlayNext, overlayContext);
    expect(getChildren(root, overlayContext)[0]).toBe(overlayNext);
  });

  it('covers mergeDependencies with empty dependency sets', () => {
    const emptyDepNode = decl({ name: 'color', value: any('red') });
    setDependency(emptyDepNode, { dependsOn: new Set(), sourceExpr: emptyDepNode }, context);
    expect(mergeDependencies([emptyDepNode], context)).toBeNull();
  });
});
