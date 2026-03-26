/**
 * Session Instance Architecture — Proof Tests
 *
 * These tests prove that the session-instance model can represent:
 * - many live instances of one canonical subtree in one eval session
 * - sparse local state only where behavior diverges
 * - dependency-guided reach keeping shadow entries narrow
 *
 * SI-5: Repeated import proof
 * SI-6: Repeated mixin/function proof
 */
import { describe, it, expect } from 'vitest';
import {
  EvalSession,
  SessionInstanceRoot,
  type DependencyReach
} from '../eval-session.js';
import {
  Keyword,
  Context,
  vardecl,
  any,
  nil,
  decl,
  list,
  rules,
  ruleset,
  rest,
  sellist,
  sel,
  el,
  ref,
  condition,
  mixin,
  call,
  expr,
  type Rules
} from '../index.js';
import {
  getField,
  setField,
  setParent,
  getParent,
  getSourceParent,
  setEvaluated,
  isEvaluated,
  getChildren,
  appendChildren
} from '../tree/util/session-helpers.js';
import {
  attachMixinBodyToParamScope,
  assembleMixinInvocationOutput,
  bindMixinParamValue,
  classifyMixinDefaultGroup,
  createMixinCandidateInstanceRoot,
  createMixinParamScope,
  defineMixinArgumentsInScope,
  evaluateMixinGuardCandidate,
  evaluateRulesetMixinCandidateOutput,
  finalizeMixinInvocationOutput,
  finalizeMixinInvocationReturn,
  getRootSourceRules,
  normalizeMixinInvocationParams,
  MixinDefaultGroup,
  processPreparedMixinCandidate,
  populateMixinParamScope,
  prepareMixinCandidateInvocation,
  prepareMixinInvocationScope,
  projectMixinParamScopeIntoOutput,
  replayWinningMixinDefaultCandidates,
  resolveWinningMixinDefaultGroups,
  seedMixinGuardScope,
  unlockDetachedRulesetMixinCandidateOutput,
  withMixinLookupScope
} from '../tree/util/mixin-instance-primitives.js';
import { DefaultGuard } from '../tree/default-guard.js';
import { Nil } from '../tree/nil.js';

/**
 * Helper: build a canonical "tokens" tree simulating a parsed file.
 *
 * ```jess
 * @color: red;
 * .button { color: @color; }
 * ```
 */
function buildCanonicalTokensTree() {
  const colorVar = vardecl({ name: any('@color'), value: new Keyword('red') });
  const colorRef = ref('@color', { type: 'variable' });
  const buttonDecl = decl({ name: any('color'), value: colorRef });
  const buttonRules = rules([buttonDecl]);
  const buttonRuleset = ruleset({
    selector: sellist([sel([el('.button')])]),
    rules: buttonRules
  });
  const tree = rules([colorVar, buttonRuleset]);
  return { tree, colorVar, colorRef, buttonDecl, buttonRules, buttonRuleset };
}

/**
 * Helper: build a canonical mixin tree simulating a parsed mixin definition.
 *
 * ```jess
 * .theme(@fg, @bg) {
 *   color: @fg;
 *   border: 1px solid black;
 *   background: @bg;
 * }
 * ```
 */
function buildCanonicalMixinTree() {
  const fgRef = ref('@fg', { type: 'variable' });
  const bgRef = ref('@bg', { type: 'variable' });
  const colorDecl = decl({ name: any('color'), value: fgRef });
  const borderDecl = decl({ name: any('border'), value: any('1px solid black') });
  const bgDecl = decl({ name: any('background'), value: bgRef });
  const body = rules([colorDecl, borderDecl, bgDecl]);
  return { body, colorDecl, borderDecl, bgDecl, fgRef, bgRef };
}

describe('SI-5: Repeated import proof', () => {
  it('3 instance roots over one canonical source tree', () => {
    const session = new EvalSession();
    const { tree } = buildCanonicalTokensTree();

    const import1 = session.createInstanceRoot(tree);
    const import2 = session.createInstanceRoot(tree);
    const import3 = session.createInstanceRoot(tree);

    // All three roots share the same canonical source
    expect(import1.sourceRoot).toBe(tree);
    expect(import2.sourceRoot).toBe(tree);
    expect(import3.sourceRoot).toBe(tree);

    // All are distinct placements
    expect(import1.id).not.toBe(import2.id);
    expect(import2.id).not.toBe(import3.id);

    // Session tracks all three
    expect(session.getInstanceRootsFor(tree)).toHaveLength(3);
  });

  it('imports 2 and 3 create only thin local state for changed values', () => {
    const session = new EvalSession();
    const { tree, colorVar, buttonDecl } = buildCanonicalTokensTree();

    const import1 = session.createInstanceRoot(tree);
    const import2 = session.createInstanceRoot(tree);
    const import3 = session.createInstanceRoot(tree);

    // Import 1: no overrides — pure source-backed
    expect(import1.shadowCount).toBe(0);

    // Import 2: override @color to blue
    import2.bindings = new Map([['@color', new Keyword('blue')]]);
    import2.setField(colorVar, 'value', new Keyword('blue'));
    // Only the var declaration needs a shadow entry
    expect(import2.shadowCount).toBe(1);
    expect(import2.hasShadow(colorVar)).toBe(true);

    // Import 3: override @color to green
    import3.bindings = new Map([['@color', new Keyword('green')]]);
    import3.setField(colorVar, 'value', new Keyword('green'));
    expect(import3.shadowCount).toBe(1);
    expect(import3.hasShadow(colorVar)).toBe(true);

    // buttonDecl stays source-backed in all three
    expect(import1.hasShadow(buttonDecl)).toBe(false);
    expect(import2.hasShadow(buttonDecl)).toBe(false);
    expect(import3.hasShadow(buttonDecl)).toBe(false);
  });

  it('untouched paths stay source-backed', () => {
    const session = new EvalSession();
    const { tree, colorVar, buttonDecl, buttonRules, buttonRuleset } = buildCanonicalTokensTree();

    const root = session.createInstanceRoot(tree);

    // Only override the variable
    root.setField(colorVar, 'value', new Keyword('blue'));

    // Everything else has zero shadow state
    expect(root.hasShadow(buttonDecl)).toBe(false);
    expect(root.hasShadow(buttonRules)).toBe(false);
    expect(root.hasShadow(buttonRuleset)).toBe(false);
    expect(root.hasShadow(tree)).toBe(false);

    // Total shadow: only the one changed node
    expect(root.shadowCount).toBe(1);
  });

  it('session helpers route reads/writes through the active instance root', () => {
    const session = new EvalSession();
    const { tree, colorVar } = buildCanonicalTokensTree();

    const import1 = session.createInstanceRoot(tree);
    const import2 = session.createInstanceRoot(tree);

    const ctx = new Context();
    ctx.session = session;

    // Write to import2's instance
    ctx.instanceRoot = import2;
    setField(colorVar, 'value', new Keyword('blue'), ctx);

    // Read from import1 — source-backed
    ctx.instanceRoot = import1;
    expect(getField(colorVar, 'value', ctx)).toBeInstanceOf(Keyword);
    expect((getField(colorVar, 'value', ctx) as Keyword).value).toBe('red');

    // Read from import2 — sees the blue override
    ctx.instanceRoot = import2;
    expect((getField(colorVar, 'value', ctx) as Keyword).value).toBe('blue');
  });

  it('dependency reach identifies only @color-dependent nodes', () => {
    const session = new EvalSession();
    const { tree, colorVar, buttonDecl, buttonRuleset } = buildCanonicalTokensTree();

    const root = session.createInstanceRoot(tree);
    root.bindings = new Map([['@color', new Keyword('blue')]]);

    // Simulate dependency annotations
    // buttonDecl depends on @color (through the color: @color reference)
    session.setDependency(buttonDecl, { dependsOn: new Set([colorVar]) });
    // buttonRuleset has no dependency on @color (selector is static)
    session.setDependency(buttonRuleset, { dependsOn: null });

    // Shadow both for testing
    root.setField(buttonDecl, 'value', new Keyword('blue'));
    root.setField(buttonRuleset, 'value', new Keyword('unused'));

    const reach = root.computeDependencyReach(new Set([colorVar]));

    // Only buttonDecl is affected (depends on @color)
    expect(reach.affectedNodes.has(buttonDecl)).toBe(true);
    expect(reach.affectedNodes.has(buttonRuleset)).toBe(false);
    expect(reach.affectedNodes.size).toBe(1);
  });

  it('each instance root has independent parent chains', () => {
    const session = new EvalSession();
    const { tree, colorVar } = buildCanonicalTokensTree();

    const import1 = session.createInstanceRoot(tree);
    const import2 = session.createInstanceRoot(tree);

    const parent1 = rules([]);
    const parent2 = rules([]);

    const ctx = new Context();
    ctx.session = session;

    // Import 1 placed under parent1
    ctx.instanceRoot = import1;
    setParent(tree, parent1, ctx);

    // Import 2 placed under parent2
    ctx.instanceRoot = import2;
    setParent(tree, parent2, ctx);

    // Read back — independent
    ctx.instanceRoot = import1;
    expect(getParent(tree, ctx)).toBe(parent1);

    ctx.instanceRoot = import2;
    expect(getParent(tree, ctx)).toBe(parent2);
  });
});

describe('SI-6: Repeated mixin/function proof', () => {
  it('3 instance roots over one canonical mixin body', () => {
    const session = new EvalSession();
    const { body } = buildCanonicalMixinTree();

    const call1 = session.createInstanceRoot(body);
    const call2 = session.createInstanceRoot(body);
    const call3 = session.createInstanceRoot(body);

    expect(call1.sourceRoot).toBe(body);
    expect(call2.sourceRoot).toBe(body);
    expect(call3.sourceRoot).toBe(body);

    expect(session.getInstanceRootsFor(body)).toHaveLength(3);
  });

  it('one changed input affects only one downstream path', () => {
    const session = new EvalSession();
    const { body, colorDecl, borderDecl, bgDecl, fgRef, bgRef } = buildCanonicalMixinTree();

    // call#a and call#b: same args (red, white)
    const callA = session.createInstanceRoot(body);
    const callB = session.createInstanceRoot(body);
    // call#c: different bg (red, blue)
    const callC = session.createInstanceRoot(body);

    // callA: no overrides needed (default args match canonical)
    expect(callA.shadowCount).toBe(0);

    // callB: same args as callA — no overrides needed
    expect(callB.shadowCount).toBe(0);

    // callC: only bg changes — only bgDecl needs shadow state
    callC.setField(bgDecl, 'value', new Keyword('blue'));
    expect(callC.shadowCount).toBe(1);
    expect(callC.hasShadow(bgDecl)).toBe(true);

    // color and border stay source-backed in all three
    expect(callC.hasShadow(colorDecl)).toBe(false);
    expect(callC.hasShadow(borderDecl)).toBe(false);
  });

  it('only the affected path gets thin local state via dependency reach', () => {
    const session = new EvalSession();
    const { body, colorDecl, borderDecl, bgDecl } = buildCanonicalMixinTree();

    // Create VarDeclarations for the mixin params
    const fgParam = vardecl({ name: any('@fg'), value: new Keyword('red') });
    const bgParam = vardecl({ name: any('@bg'), value: new Keyword('white') });

    const callC = session.createInstanceRoot(body);
    callC.bindings = new Map([['@bg', new Keyword('blue')]]);

    // Annotate dependencies
    session.setDependency(colorDecl, { dependsOn: new Set([fgParam]) });
    session.setDependency(borderDecl, { dependsOn: null }); // static
    session.setDependency(bgDecl, { dependsOn: new Set([bgParam]) });

    // Shadow the bg declaration
    callC.setField(bgDecl, 'value', new Keyword('blue'));

    // Compute reach: only @bg changed
    const reach = callC.computeDependencyReach(new Set([bgParam]));

    // Only bgDecl is affected
    expect(reach.affectedNodes.has(bgDecl)).toBe(true);
    expect(reach.affectedNodes.has(colorDecl)).toBe(false);
    expect(reach.affectedNodes.has(borderDecl)).toBe(false);
    expect(reach.affectedNodes.size).toBe(1);
  });

  it('border stays source-backed across all call instances', () => {
    const session = new EvalSession();
    const { body, borderDecl } = buildCanonicalMixinTree();

    const callA = session.createInstanceRoot(body);
    const callB = session.createInstanceRoot(body);
    const callC = session.createInstanceRoot(body);

    // border: 1px solid black — same in every call, no shadow needed
    expect(callA.hasShadow(borderDecl)).toBe(false);
    expect(callB.hasShadow(borderDecl)).toBe(false);
    expect(callC.hasShadow(borderDecl)).toBe(false);

    // Total shadow for each: 0 (border is always source-backed)
    expect(callA.shadowCount).toBe(0);
    expect(callB.shadowCount).toBe(0);
    expect(callC.shadowCount).toBe(0);
  });

  it('session helpers serve correct values per active instance root', () => {
    const session = new EvalSession();
    const { body, bgDecl } = buildCanonicalMixinTree();

    const callA = session.createInstanceRoot(body);
    const callC = session.createInstanceRoot(body);

    const ctx = new Context();
    ctx.session = session;

    // callC overrides background to blue
    ctx.instanceRoot = callC;
    setField(bgDecl, 'value', new Keyword('blue'), ctx);

    // callA reads source-backed value (a Reference node, not overridden)
    ctx.instanceRoot = callA;
    const aValue = getField(bgDecl, 'value', ctx);
    expect(aValue).not.toBeInstanceOf(Keyword);

    // callC reads its own override
    ctx.instanceRoot = callC;
    const cValue = getField<Keyword>(bgDecl, 'value', ctx);
    expect(cValue).toBeInstanceOf(Keyword);
    expect(cValue.value).toBe('blue');
  });

  it('each call instance has independent eval state', () => {
    const session = new EvalSession({ resetEvalState: true });
    const { body, colorDecl, borderDecl, bgDecl } = buildCanonicalMixinTree();

    const callA = session.createInstanceRoot(body);
    const callB = session.createInstanceRoot(body);

    const ctx = new Context();
    ctx.session = session;

    // Mark callA's declarations as evaluated
    ctx.instanceRoot = callA;
    setEvaluated(colorDecl, true, ctx);
    setEvaluated(borderDecl, true, ctx);
    setEvaluated(bgDecl, true, ctx);

    // callB's declarations are NOT evaluated
    ctx.instanceRoot = callB;
    expect(isEvaluated(colorDecl, ctx)).toBe(false);
    expect(isEvaluated(borderDecl, ctx)).toBe(false);
    expect(isEvaluated(bgDecl, ctx)).toBe(false);

    // callA's are still marked
    ctx.instanceRoot = callA;
    expect(isEvaluated(colorDecl, ctx)).toBe(true);
    expect(isEvaluated(borderDecl, ctx)).toBe(true);
    expect(isEvaluated(bgDecl, ctx)).toBe(true);
  });

  it('children overlays per instance root allow different child visibility', () => {
    const session = new EvalSession();
    const { body, colorDecl, borderDecl, bgDecl } = buildCanonicalMixinTree();

    const callA = session.createInstanceRoot(body);
    const callB = session.createInstanceRoot(body);

    const ctx = new Context();
    ctx.session = session;

    // callA: remove bgDecl (simulate guard condition hiding it)
    ctx.instanceRoot = callA;
    const aChildren = getChildren(body as Rules, ctx).filter(c => c !== bgDecl);
    callA.setChildren(body, aChildren);

    // callB: full body
    ctx.instanceRoot = callB;
    expect(getChildren(body as Rules, ctx)).toHaveLength(3);

    // callA sees only 2
    ctx.instanceRoot = callA;
    expect(getChildren(body as Rules, ctx)).toHaveLength(2);
  });

  it('bindMixinParamValue writes only to instance-root shadow and leaves canonical params untouched', () => {
    const fgParam = vardecl({ name: 'fg', value: nil() });
    const bgParam = vardecl({ name: 'bg', value: nil() });
    const session = new EvalSession();
    const paramScope = rules([fgParam, bgParam]);
    const instanceRoot = session.createInstanceRoot(paramScope);
    const ctx = new Context({ leakyRules: true });
    ctx.session = session;
    ctx.instanceRoot = instanceRoot;

    // Future primitive shape:
    // bindMixinParamsIntoInstanceRoot(instanceRoot, [fgParam, bgParam], [red, blue])
    bindMixinParamValue(fgParam, any('red'), ctx);
    bindMixinParamValue(bgParam, any('blue'), ctx);
    expect(getField(fgParam, 'value', ctx).toTrimmedString()).toBe('red');
    expect(getField(bgParam, 'value', ctx).toTrimmedString()).toBe('blue');

    // Canonical params stay unchanged; only the instance root carries the binding.
    expect(fgParam.value.type).toBe('Nil');
    expect(bgParam.value.type).toBe('Nil');
    expect(instanceRoot.shadowCount).toBe(2);
  });

  it('attachMixinBodyToParamScope writes only to instance-root parent shadow', () => {
    const fgParam = vardecl({ name: 'fg', value: nil() });
    const paramScope = rules([fgParam]);
    const body = rules([
      decl({ name: any('color'), value: ref('fg', { type: 'variable' }) })
    ]);

    const session = new EvalSession();
    const instanceRoot = session.createInstanceRoot(body);
    const ctx = new Context({ leakyRules: true });
    ctx.session = session;
    ctx.instanceRoot = instanceRoot;

    attachMixinBodyToParamScope(body, paramScope, ctx);

    expect(body.parent).toBeUndefined();
    expect(getParent(body, ctx)).toBe(paramScope);
    expect(instanceRoot.shadowCount).toBe(1);
  });

  it('createMixinParamScope keeps parentage in the active instance root', () => {
    const outer = rules([]);
    const session = new EvalSession();
    const instanceRoot = session.createInstanceRoot(outer);
    const ctx = new Context({ leakyRules: true });
    ctx.session = session;
    ctx.instanceRoot = instanceRoot;

    const scope = createMixinParamScope(outer, 7, ctx);

    expect(scope.parent).toBeUndefined();
    expect(getParent(scope, ctx)).toBe(outer);
    expect(scope.index).toBe(7);
  });

  it('populateMixinParamScope registers hidden param vars in the transient scope', () => {
    const fgParam = vardecl({ name: 'fg', value: any('red') });
    const bgParam = vardecl({ name: 'bg', value: any('blue') });
    const session = new EvalSession();
    const outer = rules([]);
    const instanceRoot = session.createInstanceRoot(outer);
    const ctx = new Context({ leakyRules: true });
    ctx.session = session;
    ctx.instanceRoot = instanceRoot;

    const scope = createMixinParamScope(outer, 1, ctx);
    const params = list([fgParam, bgParam]);
    populateMixinParamScope(scope, params, ctx);

    const children = getChildren(scope, ctx);
    expect(children).toHaveLength(2);
    expect(children[0]).toBe(fgParam);
    expect(children[1]).toBe(bgParam);
    expect(fgParam.options?.paramVar).toBe(true);
    expect(bgParam.options?.paramVar).toBe(true);
    expect(getParent(fgParam, ctx)).toBe(scope);
    expect(getParent(bgParam, ctx)).toBe(scope);
  });

  it('defineMixinArgumentsInScope creates readonly @arguments from bound params', () => {
    const session = new EvalSession();
    const outer = rules([]);
    const instanceRoot = session.createInstanceRoot(outer);
    const ctx = new Context({ leakyRules: true });
    ctx.session = session;
    ctx.instanceRoot = instanceRoot;
    ctx.treeContext = { file: '/tmp/example.jess' } as any;

    const scope = createMixinParamScope(outer, 1, ctx);
    const fgParam = vardecl({ name: 'fg', value: any('red') });
    const restParam = vardecl({
      name: 'rest',
      value: any('1px solid')
    });
    const params = list([fgParam, restParam]);

    populateMixinParamScope(scope, params, ctx);
    defineMixinArgumentsInScope(scope, params, [any('unused')], ctx);

    const children = getChildren(scope, ctx);
    const argumentsDecl = children.at(-1);
    expect(argumentsDecl?.type).toBe('VarDeclaration');
    expect((argumentsDecl as any).name.valueOf()).toBe('arguments');
    expect((argumentsDecl as any).options.readonly).toBe(true);
    expect((argumentsDecl as any).value.toTrimmedString()).toBe('red 1px solid');
  });

  it('seedMixinGuardScope restores active scope children and attaches guard only in shadow state', () => {
    const fgParam = vardecl({ name: 'fg', value: any('red') });
    const outer = rules([]);
    const guard = condition([ref('fg', { type: 'variable' }), '=', any('red')]);
    const session = new EvalSession({ resetEvalState: true });
    const instanceRoot = session.createInstanceRoot(outer);
    const ctx = new Context({ leakyRules: true });
    ctx.session = session;
    ctx.instanceRoot = instanceRoot;

    let scope = createMixinParamScope(outer, 1, ctx);
    populateMixinParamScope(scope, list([fgParam]), ctx);
    const scopeChildren = [...getChildren(scope, ctx)];

    scope = seedMixinGuardScope(scope, outer, guard, ctx, scopeChildren);

    expect(guard.parent).toBeUndefined();
    expect(getParent(guard, ctx)).toBe(scope);
    expect(getChildren(scope, ctx)).toEqual(scopeChildren);
  });

  it('withMixinLookupScope lets canonical body eval write resolved values through the session layer without cloning', async () => {
    const fgParam = vardecl({ name: 'fg', value: nil() });
    const bgParam = vardecl({ name: 'bg', value: nil() });
    const bodyRoot = rules([]);
    const colorDecl = decl({ name: any('color'), value: ref('fg', { type: 'variable' }) });
    const bgDecl = decl({ name: any('background'), value: ref('bg', { type: 'variable' }) });
    const body = rules([colorDecl, bgDecl]);

    const session = new EvalSession();
    const instanceRoot = session.createInstanceRoot(body);
    const ctx = new Context({ leakyRules: true });
    ctx.session = session;
    ctx.instanceRoot = instanceRoot;
    ctx.rulesContext = body;
    ctx.root = bodyRoot;

    bindMixinParamValue(fgParam, any('red'), ctx);
    bindMixinParamValue(bgParam, any('blue'), ctx);
    const paramScope = prepareMixinInvocationScope(
      body,
      bodyRoot,
      0,
      list([fgParam, bgParam]),
      [],
      ctx
    );

    await withMixinLookupScope(paramScope, ctx, () => body.eval(ctx));

    expect(paramScope).toBeDefined();
    expect(getField<Node>(colorDecl, 'value', ctx).toTrimmedString()).toBe('red');
    expect(getField<Node>(bgDecl, 'value', ctx).toTrimmedString()).toBe('blue');
    expect(body.parent).toBeUndefined();
    expect(getParent(body, ctx)).toBe(paramScope);
    expect(ctx.lookupScope).toBeUndefined();
  });

  it('finalizeMixinInvocationOutput turns a session-evaluated body into a portable returned result', async () => {
    const fgParam = vardecl({ name: 'fg', value: nil() });
    const sourceDecl = decl({ name: any('color'), value: ref('fg', { type: 'variable' }) });
    const bodyRoot = rules([]);
    const body = rules([sourceDecl]);

    const session = new EvalSession();
    const instanceRoot = session.createInstanceRoot(body);
    const ctx = new Context({ leakyRules: true });
    ctx.session = session;
    ctx.instanceRoot = instanceRoot;
    ctx.rulesContext = body;
    ctx.root = bodyRoot;

    bindMixinParamValue(fgParam, any('red'), ctx);
    const paramScope = prepareMixinInvocationScope(
      body,
      bodyRoot,
      0,
      list([fgParam]),
      [],
      ctx
    )!;

    const evaldBody = await withMixinLookupScope(paramScope, ctx, () => body.eval(ctx)) as Rules;
    const finalized = finalizeMixinInvocationOutput(evaldBody, ctx);
    const finalizedDecl = finalized.at(0) as Node;

    expect(finalized).not.toBe(body);
    expect(finalizedDecl).not.toBe(sourceDecl);
    expect(finalizedDecl.parent).toBe(finalized);
    expect(sourceDecl.parent).toBe(body);
    expect(getField<Node>(sourceDecl, 'value', ctx).toTrimmedString()).toBe('red');
    expect(String(finalized)).toBeString(`
      color: red;
    `);
  });

  it('projectMixinParamScopeIntoOutput prepends visible bound params without re-cloning the canonical body', async () => {
    const fgParam = vardecl({ name: 'fg', value: nil() });
    const sourceDecl = decl({ name: any('color'), value: ref('fg', { type: 'variable' }) });
    const bodyRoot = rules([]);
    const body = rules([sourceDecl]);

    const session = new EvalSession();
    const instanceRoot = session.createInstanceRoot(body);
    const ctx = new Context({ leakyRules: true });
    ctx.session = session;
    ctx.instanceRoot = instanceRoot;
    ctx.rulesContext = body;
    ctx.root = bodyRoot;

    bindMixinParamValue(fgParam, any('red'), ctx);
    const paramScope = prepareMixinInvocationScope(
      body,
      bodyRoot,
      0,
      list([fgParam]),
      [],
      ctx
    )!;

    const evaldBody = await withMixinLookupScope(paramScope, ctx, () => body.eval(ctx)) as Rules;
    const finalized = finalizeMixinInvocationOutput(evaldBody, ctx);
    const projected = projectMixinParamScopeIntoOutput(finalized, paramScope, ctx);

    expect(projected.at(0)?.type).toBe('VarDeclaration');
    expect(projected.at(1)?.type).toBe('Declaration');
    expect(String(projected)).toBeString(`
      $fg: red;
      color: red;
    `);
    expect(sourceDecl.parent).toBe(body);
  });

  it('normalizeMixinInvocationParams converts named rest params into param vars', () => {
    const ctx = new Context({ leakyRules: true });
    const params = list([
      any('a', { role: 'property' }),
      rest('tail')
    ]);

    const normalized = normalizeMixinInvocationParams(params, ctx)!;
    const tail = normalized.value[1] as VarDeclaration;

    expect(tail.type).toBe('VarDeclaration');
    expect(tail.getPropertyName(ctx)).toBe('tail');
    expect(tail.options?.paramVar).toBe(true);
  });

  it('normalizeMixinInvocationParams auto-generates unnamed rest param names', () => {
    const ctx = new Context({ leakyRules: true });
    const params = list([
      rest(undefined),
      rest(undefined)
    ]);

    const normalized = normalizeMixinInvocationParams(params, ctx)!;
    const first = normalized.value[0] as VarDeclaration;
    const second = normalized.value[1] as VarDeclaration;

    expect(first.getPropertyName(ctx)).toBe('rest');
    expect(second.getPropertyName(ctx)).toBe('rest2');
  });

  it('prepareMixinCandidateInvocation wires normal candidate scope without cloning the body', () => {
    const outer = rules([]);
    const body = rules([
      decl({ name: any('margin'), value: ref('tail', { type: 'variable' }) })
    ]);
    const session = new EvalSession();
    const instanceRoot = session.createInstanceRoot(body);
    const ctx = new Context({ leakyRules: true });
    ctx.session = session;
    ctx.instanceRoot = instanceRoot;
    ctx.rulesContext = outer;

    const prepared = prepareMixinCandidateInvocation(
      body,
      list([any('a', { role: 'property' }), rest(undefined)]),
      outer,
      outer,
      3,
      [any('10px'), any('20px')],
      ctx,
      instanceRoot
    );

    expect(prepared.rules).toBe(body);
    expect(prepared.outerRules).toBeDefined();
    expect(prepared.lookupScope).toBe(prepared.outerRules);
    expect(prepared.guardScopeChildren).toEqual(getChildren(prepared.outerRules!, ctx));
    expect(getParent(body, ctx)).toBe(prepared.outerRules);
    expect(prepared.params?.value[1]?.type).toBe('VarDeclaration');
    expect((prepared.params?.value[1] as VarDeclaration).getPropertyName(ctx)).toBe('rest');
    expect(getField<any>(body, 'options', ctx).rulesVisibility.VarDeclaration).toBe('public');
  });

  it('evaluateMixinGuardCandidate runs reset-session probes and returns a default group', async () => {
    const body = rules([]);
    const outer = rules([]);
    const session = new EvalSession({ resetEvalState: true });
    const instanceRoot = session.createInstanceRoot(body);
    const ctx = new Context({ leakyRules: true });
    ctx.session = session;
    ctx.instanceRoot = instanceRoot;
    ctx.rulesContext = outer;

    const prepared = prepareMixinCandidateInvocation(
      body,
      list([vardecl({ name: 'fg', value: any('red') })]),
      outer,
      outer,
      2,
      [],
      ctx,
      instanceRoot
    );
    const guard = new DefaultGuard('default()');

    const evaluated = await evaluateMixinGuardCandidate(
      guard,
      prepared.outerRules,
      outer,
      prepared.lookupScope,
      ctx,
      prepared.guardScopeChildren,
      true
    );

    expect(evaluated.passes).toBe(true);
    expect(evaluated.defaultGroup).toBe(MixinDefaultGroup.True);
    expect(evaluated.outerRules).toBeDefined();
    expect(guard.parent).toBeUndefined();
    expect(getParent(guard, ctx)).toBe(evaluated.outerRules);
  });

  it('classifyMixinDefaultGroup maps default() probe pairs into stable groups', () => {
    expect(classifyMixinDefaultGroup(false, false)).toBeUndefined();
    expect(classifyMixinDefaultGroup(true, true)).toBe(MixinDefaultGroup.None);
    expect(classifyMixinDefaultGroup(false, true)).toBe(MixinDefaultGroup.True);
    expect(classifyMixinDefaultGroup(true, false)).toBe(MixinDefaultGroup.False);
  });

  it('resolveWinningMixinDefaultGroups applies Less default() ambiguity rules', () => {
    expect(
      resolveWinningMixinDefaultGroups([MixinDefaultGroup.None, MixinDefaultGroup.True])
    ).toEqual(new Set([MixinDefaultGroup.None, MixinDefaultGroup.False]));
    expect(
      resolveWinningMixinDefaultGroups([MixinDefaultGroup.True])
    ).toEqual(new Set([MixinDefaultGroup.True]));
    expect(() =>
      resolveWinningMixinDefaultGroups([MixinDefaultGroup.True, MixinDefaultGroup.False])
    ).toThrow(/Ambiguous use of default/);
  });

  it('replayWinningMixinDefaultCandidates only replays winning groups with the right lookup scope', async () => {
    const ctx = new Context({ leakyRules: true });
    const sharedRules = rules([]);
    const noneScope = rules([]);
    const falseScope = rules([]);
    const trueScope = rules([]);
    const replayed: string[] = [];

    await replayWinningMixinDefaultCandidates(
      [
        { candidate: 'none', rules: sharedRules, outerRules: noneScope, group: MixinDefaultGroup.None },
        { candidate: 'false', rules: sharedRules, outerRules: falseScope, group: MixinDefaultGroup.False },
        { candidate: 'true', rules: sharedRules, outerRules: trueScope, group: MixinDefaultGroup.True }
      ],
      ctx,
      async (pending) => {
        replayed.push(`${pending.candidate}:${ctx.rulesContext === pending.outerRules}`);
        expect(ctx.lookupScope).toBe(pending.outerRules);
      }
    );

    expect(replayed).toEqual(['none:true', 'false:true']);
    expect(ctx.rulesContext).toBeUndefined();
    expect(ctx.lookupScope).toBeUndefined();
  });

  it('assembleMixinInvocationOutput sorts candidate rules by source order and wraps them lookup-safely', () => {
    const root = rules([]);
    const firstBody = rules([decl({ name: any('color'), value: any('red') })]);
    const secondBody = rules([decl({ name: any('background'), value: any('blue') })]);
    const first = ruleset({ selector: sellist([sel([el('.a')])]), rules: firstBody });
    const second = ruleset({ selector: sellist([sel([el('.b')])]), rules: secondBody });
    root.push(first);
    root.push(second);
    first.index = 0;
    second.index = 1;

    const ctx = new Context({ leakyRules: true });
    ctx.session = new EvalSession();

    const output = assembleMixinInvocationOutput([secondBody, firstBody], true, ctx);
    const children = getChildren(output, ctx);

    expect(children[0]).toBe(firstBody);
    expect(children[1]).toBe(secondBody);
    expect(getParent(firstBody, ctx)).toBe(output);
    expect(getParent(secondBody, ctx)).toBe(output);
    expect(firstBody.parent).toBe(first);
    expect(secondBody.parent).toBe(second);
    expect(firstBody.index).toBe(0);
    expect(secondBody.index).toBe(1);
    expect(firstBody.frozen).toBe(true);
    expect(secondBody.frozen).toBe(true);
    expect(output.options.isMixinOutput).toBe(true);
  });

  it('assembleMixinInvocationOutput preserves single-rule passthrough semantics', () => {
    const output = rules([]);
    const ctx = new Context({ leakyRules: true });

    const assembled = assembleMixinInvocationOutput([output], false, ctx);

    expect(assembled).toBe(output);
    expect(assembled.options.isMixinOutput).toBe(false);
  });

  it('evaluateRulesetMixinCandidateOutput keeps ruleset-candidate shaping out of the candidate loop', async () => {
    const outer = rules([]);
    const body = rules([decl({ name: any('color'), value: any('red') })]);
    const candidate = ruleset({
      selector: sellist([sel([el('.card')])]),
      rules: body
    });
    candidate.index = 4;
    outer.push(candidate);

    const ctx = new Context({ leakyRules: true });
    ctx.session = new EvalSession({ resetEvalState: true });
    const instanceRoot = ctx.session.createInstanceRoot(body);

    const evaluated = await evaluateRulesetMixinCandidateOutput(
      body,
      outer,
      outer,
      candidate.index!,
      true,
      ctx,
      instanceRoot
    );

    expect(evaluated.index).toBe(4);
    expect(evaluated.options.isMixinOutput).toBe(true);
    expect(getParent(evaluated, ctx)).toBe(outer);
    expect(getSourceParent(evaluated, ctx)).toBe(outer);
    expect(evaluated._instanceRoot).toBe(instanceRoot);
  });

  it('unlockDetachedRulesetMixinCandidateOutput keeps detached unlock shaping explicit', () => {
    const outer = rules([]);
    const body = rules([decl({ name: any('color'), value: any('red') })]);
    const ctx = new Context({ leakyRules: true });
    ctx.session = new EvalSession();
    const instanceRoot = ctx.session.createInstanceRoot(body);

    const unlocked = unlockDetachedRulesetMixinCandidateOutput(
      body,
      outer,
      outer,
      7,
      ctx,
      instanceRoot
    );

    expect(unlocked.options.isMixinOutput).toBe(false);
    expect(unlocked.index).toBe(7);
    expect(getParent(unlocked, ctx)).toBe(outer);
    expect(getSourceParent(unlocked, ctx)).toBe(outer);
    expect(unlocked._instanceRoot).toBe(instanceRoot);
  });

  it('processPreparedMixinCandidate dispatches immediate output through the prepared lookup scope', async () => {
    const ctx = new Context({ leakyRules: true });
    const body = rules([]);
    const outerRules = rules([]);
    const instanceRoot = new EvalSession().createInstanceRoot(body);
    const seen: string[] = [];

    const pending = await processPreparedMixinCandidate({
      candidate: 'now',
      rules: body,
      params: undefined,
      outerRules,
      guard: undefined,
      parent: outerRules,
      lookupScope: outerRules,
      hasDefault: false,
      context: ctx,
      instanceRoot,
      evaluateCandidateOutput: async (candidate, rules, nextOuterRules, _params, nextInstanceRoot) => {
        seen.push(`${candidate}:${ctx.rulesContext === outerRules}:${rules === body}:${nextOuterRules === outerRules}:${nextInstanceRoot === instanceRoot}`);
      }
    });

    expect(pending).toBeUndefined();
    expect(seen).toEqual(['now:true:true:true:true']);
    expect(ctx.rulesContext).toBeUndefined();
    expect(ctx.lookupScope).toBeUndefined();
  });

  it('processPreparedMixinCandidate returns a pending default replay record instead of dispatching immediately', async () => {
    const ctx = new Context({ leakyRules: true });
    ctx.session = new EvalSession({ resetEvalState: true });
    const body = rules([]);
    const outer = rules([]);
    const instanceRoot = ctx.session.createInstanceRoot(body);
    const guard = new DefaultGuard('default()');
    const seen: string[] = [];

    const pending = await processPreparedMixinCandidate({
      candidate: 'later',
      rules: body,
      params: undefined,
      outerRules: outer,
      guard,
      parent: outer,
      lookupScope: outer,
      guardScopeChildren: getChildren(outer, ctx),
      hasDefault: true,
      context: ctx,
      instanceRoot,
      evaluateCandidateOutput: async () => {
        seen.push('dispatched');
      }
    });

    expect(seen).toEqual([]);
    expect(pending?.candidate).toBe('later');
    expect(pending?.rules).toBe(body);
    expect(pending?.outerRules).toBeDefined();
    expect(pending?.group).toBe(MixinDefaultGroup.True);
    expect(pending?.instanceRoot).toBe(instanceRoot);
  });

  it('getRootSourceRules resolves the canonical backing rules through source chains', () => {
    const source = rules([]);
    const derived = rules([]);
    const nested = rules([]);
    derived.sourceNode = source;
    nested.sourceNode = derived;

    expect(getRootSourceRules(nested)).toBe(source);
    expect(getRootSourceRules(derived)).toBe(source);
    expect(getRootSourceRules(source)).toBe(source);
  });

  it('createMixinCandidateInstanceRoot uses the canonical source rules body for ruleset candidates', () => {
    const sourceBody = rules([]);
    const derivedBody = rules([]);
    derivedBody.sourceNode = sourceBody;
    const candidate = ruleset({
      selector: sellist([sel([el('.card')])]),
      rules: derivedBody
    });
    const ctx = new Context({ leakyRules: true });
    ctx.session = new EvalSession();

    const instanceRoot = createMixinCandidateInstanceRoot(candidate, ctx);

    expect(instanceRoot).toBeDefined();
    expect(instanceRoot?.sourceRoot).toBe(sourceBody);
  });

  it('createMixinCandidateInstanceRoot returns undefined without an active session', () => {
    const candidate = mixin({
      name: any('.x'),
      rules: rules([])
    });
    const ctx = new Context({ leakyRules: true });

    expect(createMixinCandidateInstanceRoot(candidate, ctx)).toBeUndefined();
  });

  it('finalizeMixinInvocationReturn returns live Rules for Context receivers and assigns ruleCounter once', () => {
    const output = rules([decl({ name: any('color'), value: any('red') })]);
    const ctx = new Context({ leakyRules: true });
    ctx.ruleCounter = 11;

    const returned = finalizeMixinInvocationReturn(output, ctx);

    expect(returned).toBe(output);
    expect(output.index).toBe(11);
    expect(ctx.ruleCounter).toBe(12);
  });

  it('finalizeMixinInvocationReturn returns Nil for empty Context output', () => {
    const output = rules([]);
    const ctx = new Context({ leakyRules: true });

    const returned = finalizeMixinInvocationReturn(output, ctx);

    expect(returned).toBeInstanceOf(Nil);
  });

  it('finalizeMixinInvocationReturn preserves legacy object conversion for non-Context receivers', () => {
    const receiver = rules([]);
    const output = rules([decl({ name: any('color'), value: any('red') })]);

    const returned = finalizeMixinInvocationReturn(output, receiver);

    expect(returned).toEqual({ color: 'red' });
  });

  it('withMixinLookupScope resolves direct param references through the prepared invocation scope', async () => {
    const fgParam = vardecl({ name: 'fg', value: nil() });
    const bgParam = vardecl({ name: 'bg', value: nil() });
    const bodyRoot = rules([]);
    const session = new EvalSession();
    const instanceRoot = session.createInstanceRoot(bodyRoot);
    const ctx = new Context({ leakyRules: true });
    ctx.session = session;
    ctx.instanceRoot = instanceRoot;
    ctx.root = bodyRoot;

    bindMixinParamValue(fgParam, any('red'), ctx);
    bindMixinParamValue(bgParam, any('blue'), ctx);
    const paramScope = prepareMixinInvocationScope(
      rules([]),
      bodyRoot,
      0,
      list([fgParam, bgParam]),
      [],
      ctx
    )!;

    const fgRef = ref('fg', { type: 'variable' });
    const bgRef = ref('bg', { type: 'variable' });
    setParent(fgRef, paramScope, ctx);
    setParent(bgRef, paramScope, ctx);

    const fgValue = await withMixinLookupScope(paramScope, ctx, () => fgRef.eval(ctx));
    const bgValue = await withMixinLookupScope(paramScope, ctx, () => bgRef.eval(ctx));

    expect(fgValue.toTrimmedString()).toBe('red');
    expect(bgValue.toTrimmedString()).toBe('blue');
    expect(ctx.rulesContext).toBeUndefined();
  });

  it('withMixinLookupScope resolves guard evaluation through the prepared invocation scope', async () => {
    const fgParam = vardecl({ name: 'fg', value: nil() });
    const body = rules([]);
    const guard = condition([
      ref('fg', { type: 'variable' }),
      '=',
      any('red')
    ]);

    const session = new EvalSession();
    const instanceRoot = session.createInstanceRoot(body);
    const ctx = new Context({ leakyRules: true });
    ctx.session = session;
    ctx.instanceRoot = instanceRoot;
    ctx.root = body;
    ctx.rulesContext = body;

    bindMixinParamValue(fgParam, any('red'), ctx);
    const paramScope = prepareMixinInvocationScope(
      body,
      body,
      0,
      list([fgParam]),
      [],
      ctx
    )!;
    ctx.rulesContext = paramScope;

    const previousSession = ctx.session;
    ctx.session = new EvalSession({ resetEvalState: true });
    let guardScope: Rules | undefined;
    try {
      guardScope = seedMixinGuardScope(paramScope, body, guard, ctx, [...getChildren(paramScope, ctx)]);
      const result = await withMixinLookupScope(guardScope, ctx, () => guard.eval(ctx));
      expect(result.toTrimmedString()).toBe('true');
    } finally {
      ctx.session = previousSession;
    }

    expect(fgParam.value.type).toBe('Nil');
    expect(guard.parent).toBeUndefined();
    expect(getParent(guard, ctx)).toBe(guardScope);
  });
});

describe('node._instanceRoot association', () => {
  it('node remembers its instance root after ctx.instanceRoot is cleared', () => {
    const session = new EvalSession();
    const node = new Keyword('red');
    const container = rules([]);
    const root = session.createInstanceRoot(container);

    const ctx = new Context();
    ctx.session = session;

    // Write while instance root is active on context
    ctx.instanceRoot = root;
    setField(node, 'value', 'blue', ctx);

    // Clear context instance root
    ctx.instanceRoot = undefined;

    // Without node._instanceRoot, read falls through to session then canonical
    expect(getField(node, 'value', ctx)).toBe('red');

    // Set node._instanceRoot — now reads resolve through it
    node._instanceRoot = root;
    expect(getField(node, 'value', ctx)).toBe('blue');
  });

  it('ctx.instanceRoot takes priority over node._instanceRoot', () => {
    const session = new EvalSession();
    const node = new Keyword('red');
    const container = rules([]);

    const rootA = session.createInstanceRoot(container);
    const rootB = session.createInstanceRoot(container);

    // Patch different values in each root
    rootA.setField(node, 'value', 'blue');
    rootB.setField(node, 'value', 'green');

    // Node carries rootA
    node._instanceRoot = rootA;

    const ctx = new Context();
    ctx.session = session;

    // No ctx.instanceRoot — reads from node._instanceRoot (rootA)
    expect(getField(node, 'value', ctx)).toBe('blue');

    // Set ctx.instanceRoot to rootB — overrides node._instanceRoot
    ctx.instanceRoot = rootB;
    expect(getField(node, 'value', ctx)).toBe('green');
  });

  it('writes go to node._instanceRoot when no ctx.instanceRoot', () => {
    const session = new EvalSession();
    const node = new Keyword('red');
    const container = rules([]);
    const root = session.createInstanceRoot(container);

    node._instanceRoot = root;

    const ctx = new Context();
    ctx.session = session;

    // Write with no ctx.instanceRoot — goes to node._instanceRoot
    setField(node, 'value', 'green', ctx);

    // Verify it's in the instance root
    expect(root.getField(node, 'value')).toBe('green');

    // Verify session was NOT written to
    expect(session.hasField(node, 'value')).toBe(false);

    // Read back through helper
    expect(getField(node, 'value', ctx)).toBe('green');
  });

  it('parent chains resolve through node._instanceRoot', () => {
    const session = new EvalSession();
    const parent1 = rules([]);
    const parent2 = rules([]);
    const child = new Keyword('test');
    const root = session.createInstanceRoot(parent1);

    const ctx = new Context();
    ctx.session = session;

    // Set parent via instance root
    ctx.instanceRoot = root;
    setParent(child, parent1, ctx);
    ctx.instanceRoot = undefined;

    // Without association, parent falls through to canonical
    expect(getParent(child, ctx)).toBeUndefined();

    // With association, parent resolves through instance root
    child._instanceRoot = root;
    expect(getParent(child, ctx)).toBe(parent1);
  });
});
