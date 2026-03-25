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
  decl,
  rules,
  ruleset,
  sellist,
  sel,
  el,
  ref,
  mixin,
  call,
  expr,
  type Rules
} from '../index.js';
import {
  sessionGetField,
  sessionPatchField,
  sessionSetParent,
  sessionGetParent,
  sessionSetEvaluated,
  sessionIsEvaluated,
  sessionGetChildren,
  sessionAppendChildren
} from '../tree/util/session-helpers.js';

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
    import2.patchField(colorVar, 'value', new Keyword('blue'));
    // Only the var declaration needs a shadow entry
    expect(import2.shadowCount).toBe(1);
    expect(import2.hasShadow(colorVar)).toBe(true);

    // Import 3: override @color to green
    import3.bindings = new Map([['@color', new Keyword('green')]]);
    import3.patchField(colorVar, 'value', new Keyword('green'));
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
    root.patchField(colorVar, 'value', new Keyword('blue'));

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
    sessionPatchField(colorVar, 'value', new Keyword('blue'), ctx);

    // Read from import1 — source-backed
    ctx.instanceRoot = import1;
    expect(sessionGetField(colorVar, 'value', ctx)).toBeInstanceOf(Keyword);
    expect((sessionGetField(colorVar, 'value', ctx) as Keyword).value).toBe('red');

    // Read from import2 — sees the blue override
    ctx.instanceRoot = import2;
    expect((sessionGetField(colorVar, 'value', ctx) as Keyword).value).toBe('blue');
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
    root.patchField(buttonDecl, 'value', new Keyword('blue'));
    root.patchField(buttonRuleset, 'value', new Keyword('unused'));

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
    sessionSetParent(tree, parent1, ctx);

    // Import 2 placed under parent2
    ctx.instanceRoot = import2;
    sessionSetParent(tree, parent2, ctx);

    // Read back — independent
    ctx.instanceRoot = import1;
    expect(sessionGetParent(tree, ctx)).toBe(parent1);

    ctx.instanceRoot = import2;
    expect(sessionGetParent(tree, ctx)).toBe(parent2);
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
    callC.patchField(bgDecl, 'value', new Keyword('blue'));
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
    callC.patchField(bgDecl, 'value', new Keyword('blue'));

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
    sessionPatchField(bgDecl, 'value', new Keyword('blue'), ctx);

    // callA reads source-backed value (a Reference node, not overridden)
    ctx.instanceRoot = callA;
    const aValue = sessionGetField(bgDecl, 'value', ctx);
    expect(aValue).not.toBeInstanceOf(Keyword);

    // callC reads its own override
    ctx.instanceRoot = callC;
    const cValue = sessionGetField<Keyword>(bgDecl, 'value', ctx);
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
    sessionSetEvaluated(colorDecl, true, ctx);
    sessionSetEvaluated(borderDecl, true, ctx);
    sessionSetEvaluated(bgDecl, true, ctx);

    // callB's declarations are NOT evaluated
    ctx.instanceRoot = callB;
    expect(sessionIsEvaluated(colorDecl, ctx)).toBe(false);
    expect(sessionIsEvaluated(borderDecl, ctx)).toBe(false);
    expect(sessionIsEvaluated(bgDecl, ctx)).toBe(false);

    // callA's are still marked
    ctx.instanceRoot = callA;
    expect(sessionIsEvaluated(colorDecl, ctx)).toBe(true);
    expect(sessionIsEvaluated(borderDecl, ctx)).toBe(true);
    expect(sessionIsEvaluated(bgDecl, ctx)).toBe(true);
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
    const aChildren = sessionGetChildren(body as Rules, ctx).filter(c => c !== bgDecl);
    callA.setChildren(body, aChildren);

    // callB: full body
    ctx.instanceRoot = callB;
    expect(sessionGetChildren(body as Rules, ctx)).toHaveLength(3);

    // callA sees only 2
    ctx.instanceRoot = callA;
    expect(sessionGetChildren(body as Rules, ctx)).toHaveLength(2);
  });
});
