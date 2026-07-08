/**
 * emit-differential.test.ts — the ORACLE for the EMIT phase (compose / hoist / collapse).
 * =======================================================================================
 *
 * EMIT (`emit.ts`) is the layer ABOVE SOLVE's local-apply: it projects each subject's Or-branch set
 * to its FINAL selector output — composing a nested extender relative to its target, hoisting an
 * `&`-crossing branch to root, and grouping under `:is(...)` per the collapse policy.
 *
 * ORACLE. The ratified v5 alpha `.css` (via `@less/test-data` → `~/git/oss/less.js` **alpha**), for
 * `extend-nest` (collapseNesting:true) and `extend-selector` (collapseNesting:false). Those files are
 * the ground truth for the COMPOSED/HOISTED/COLLAPSED shape — NOT current Jess output (buggy here:
 * it emits the extender's bare own fragment, e.g. `.sidebar3` instead of `.type1 .sidebar3`), NOT the
 * `less-4x` tree. The expected values below are hardcode-pinned from those `.css` files, normalized
 * to the internal `valueOf` form (comma-joined with NO post-comma space — the CSS writer's `, `
 * formatting is a serialization concern above the selector-shape layer this component owns; every
 * existing extend differential test uses this same `valueOf` convention).
 *
 * The alpha `.css` snippets each expectation ratifies:
 *   extend-nest.css:1-4  → `.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4`
 *   extend-nest.css:8    → `:is(.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4) .box`
 *   extend-selector.css:45-46 → `.header .header-nav, .footer .footer-nav`
 *   extend-selector.css:52-53 → `.issue-2586-bordered, .issue-2586-somepage .content`
 */
import { describe, it, expect } from 'vitest';
import { el, sel, co, compound } from '../../index.js';
import {
  composeContribution,
  projectSubject,
  emitSubjectHeader,
  emitNestedChildHeader,
  type EmitSubject
} from '../emit.js';

/** extend-nest: `.sidebar` (root-level target) gains three extenders, one per authored order. */
const sidebarSubject: EmitSubject = {
  path: [el('.sidebar')],
  order: 0,
  contributions: [
    { path: [el('.sidebar2')], order: 1 }, // `.sidebar2 { &:extend(.sidebar all) }`
    { path: [el('.type1'), el('.sidebar3')], order: 2 }, // `.type1 { .sidebar3 { &:extend(.sidebar all) } }`
    { path: [compound([el('.type2'), el('.sidebar4')])], order: 3 } // `.type2 { &.sidebar4 { &:extend(.sidebar all) } }`
  ]
};

describe('EMIT compose-relative-to-target — the nested-extender bug the current engine gets wrong', () => {
  it('a root-level sibling extender contributes its bare own form (.sidebar2)', () => {
    const { selector } = composeContribution({ path: [el('.sidebar2')], order: 1 }, [el('.sidebar')]);
    expect(String(selector.valueOf())).toBe('.sidebar2');
  });

  it('a NESTED extender contributes its COMPOSED form (.type1 .sidebar3), NOT .sidebar3', () => {
    // This is the extend-nest / extend-selector bug: the current engine emits the bare own fragment
    // `.sidebar3`; the ratified alpha `.css` requires the composed `.type1 .sidebar3`.
    const { selector } = composeContribution(
      { path: [el('.type1'), el('.sidebar3')], order: 2 },
      [el('.sidebar')]
    );
    expect(String(selector.valueOf())).toBe('.type1 .sidebar3');
  });

  it('a compound-nested extender composes to its compound own form (.type2.sidebar4)', () => {
    const { selector } = composeContribution(
      { path: [compound([el('.type2'), el('.sidebar4')])], order: 3 },
      [el('.sidebar')]
    );
    expect(String(selector.valueOf())).toBe('.type2.sidebar4');
  });

  it('a same-parent extender elides the shared parent (.parent .a target, .parent .child extender → .child)', () => {
    const { selector, crossesParentBoundary } = composeContribution(
      { path: [el('.parent'), el('.child')], order: 1 },
      [el('.parent'), el('.a')]
    );
    expect(String(selector.valueOf())).toBe('.child');
    expect(crossesParentBoundary).toBe(false);
  });
});

describe('EMIT projection — the full Or-branch set (extend-nest.css:1-4)', () => {
  it('projects .sidebar to the ratified 4-branch set in document order', () => {
    const proj = projectSubject(sidebarSubject);
    // Ratified alpha: `.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4` (valueOf form).
    expect(emitSubjectHeader(proj)).toBe('.sidebar,.sidebar2,.type1 .sidebar3,.type2.sidebar4');
    expect(proj.hoistToRoot).toBe(false);
  });

  it('orders branches by document order, not insertion order', () => {
    const proj = projectSubject({
      path: [el('.sidebar')],
      order: 5,
      contributions: [
        { path: [el('.late')], order: 9 },
        { path: [el('.early')], order: 1 }
      ]
    });
    // subject.order=5 sits between .early(1) and .late(9).
    expect(emitSubjectHeader(proj)).toBe('.early,.sidebar,.late');
  });
});

describe('EMIT collapse policy — :is() grouping (extend-nest.css:8) vs expanded', () => {
  it('collapseNesting:true folds the parent Or-set into the child and groups it under :is()', () => {
    const proj = projectSubject(sidebarSubject);
    // Ratified alpha: `:is(.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4) .box`.
    expect(emitNestedChildHeader(proj, el('.box'), true)).toBe(
      ':is(.sidebar,.sidebar2,.type1 .sidebar3,.type2.sidebar4) .box'
    );
  });

  it('collapseNesting:false keeps the child nested (header is the child local only)', () => {
    const proj = projectSubject(sidebarSubject);
    // Under expanded mode the parent header carries the Or-set; the child block stays nested and its
    // own header is just `.box`. (extend-selector.css uses this mode: nested blocks preserved.)
    expect(emitNestedChildHeader(proj, el('.box'), false)).toBe('.box');
  });

  it('a single-branch parent does NOT wrap in :is() when collapsing', () => {
    const proj = projectSubject({ path: [el('.only')], order: 0, contributions: [] });
    expect(emitNestedChildHeader(proj, el('.box'), true)).toBe('.only .box');
  });
});

describe('EMIT &-crossing hoist-to-root (extend-selector.css:45-46 header/footer)', () => {
  it('a crossing nested extender contributes its FULL composed form and flags hoist', () => {
    // `.header { .header-nav { ... } }` extended by `.footer { .footer-nav { &:extend(.header .header-nav all) } }`.
    // The extender crosses the target's `.header` parent boundary → contributes `.footer .footer-nav`, hoisted.
    const targetPath = [el('.header'), el('.header-nav')];
    const { selector, crossesParentBoundary } = composeContribution(
      { path: [el('.footer'), el('.footer-nav')], order: 1 },
      targetPath
    );
    expect(String(selector.valueOf())).toBe('.footer .footer-nav');
    expect(crossesParentBoundary).toBe(true);
  });

  it('projects the header/footer subject to the ratified hoisted 2-branch set', () => {
    const proj = projectSubject({
      path: [el('.header'), el('.header-nav')],
      order: 0,
      contributions: [{ path: [el('.footer'), el('.footer-nav')], order: 1 }]
    });
    // Ratified alpha: `.header .header-nav, .footer .footer-nav` (hoisted to root).
    expect(emitSubjectHeader(proj)).toBe('.header .header-nav,.footer .footer-nav');
    expect(proj.hoistToRoot).toBe(true);
  });
});

describe('EMIT compose — issue-2586 (extend-selector.css:52-53)', () => {
  it('a nested extender of a root-level target composes to its full path (.issue-2586-somepage .content)', () => {
    // `.issue-2586-bordered { ... }` extended by `.issue-2586-somepage { .content:extend(...) { } }`.
    const proj = projectSubject({
      path: [el('.issue-2586-bordered')],
      order: 0,
      contributions: [{ path: [el('.issue-2586-somepage'), el('.content')], order: 1 }]
    });
    // Ratified alpha: `.issue-2586-bordered, .issue-2586-somepage .content`.
    expect(emitSubjectHeader(proj)).toBe('.issue-2586-bordered,.issue-2586-somepage .content');
    // This is NOT a `&`-crossing (target is root-level, no parent boundary to cross) — it emits at
    // the target's own placement, not hoisted.
    expect(proj.hoistToRoot).toBe(false);
  });
});

describe('EMIT compose — extend-selector.css:1-2 partial-extend :is() grouping into a nested target', () => {
  it('groups a partial-extended compound under :is() folded into its nested child (.bar)', () => {
    // `.foo .bar` / `.foo .baz` with partial extenders `.ext1 .ext2`, `.ext3`, `.ext4` on `.foo`.
    // The `.foo` compound becomes `:is(.foo, .ext1 .ext2, .ext3, .ext4)` and folds into `.bar`.
    const proj = projectSubject({
      path: [el('.foo')],
      order: 0,
      contributions: [
        { path: [el('.ext1'), el('.ext2')], order: 1 },
        { path: [el('.ext3')], order: 2 },
        { path: [el('.ext4')], order: 3 }
      ]
    });
    // Ratified alpha: `:is(.foo, .ext1 .ext2, .ext3, .ext4) .bar`.
    expect(emitNestedChildHeader(proj, el('.bar'), true)).toBe(':is(.foo,.ext1 .ext2,.ext3,.ext4) .bar');
  });
});
