/**
 * Document extend facts: what a parsed document's statements say about `:extend()`.
 *
 * Whether a document extends on its static spine or in a body the render walk places,
 * which rules form that spine, and which atoms the placing bodies' extends target all
 * follow from the parse alone. They are built once per document, on the first read,
 * into the document's `_extend` field, and every later reader of that document — the
 * import planner's prepare and render passes, `computeExtends`, the walk recorder, a
 * second render of the same parse — reads them there instead of walking the document
 * again (docs/perf/V8-ARCHITECTURE.md, invariants 3 and 10). A parsed document is not
 * edited after it is first rendered, so the facts never go stale.
 */

import { isStaticQuoted } from '../nodes.js';
import type { AnonymousMixin, CallValue, ExtendInstruction, Ruleset, Statement, StyleImport, Stylesheet } from '../nodes.js';
import { collectBranchAtoms, selectorLevel } from './ir.js';
import { recordAstExtendProfile } from './plan.js';

/** The document's extend surface, classified on the first read and then kept. */
export function documentExtendClass(root: Stylesheet): ExtendClass {
  let facts = root._extend;
  if (facts === undefined) {
    recordAstExtendProfile?.('astExtend.document.classifyWalks');
    facts = { static: false, dynamic: false, places: false, placedImports: null, placesUnaddressedImport: false, walk: null };
    classifyExtend(root.rules, false, facts);
    root._extend = facts;
  }
  return facts;
}

/** Whether the document extends on its static spine: the zero-cost gate `computeExtends` reads. */
export function documentHasExtend(root: Stylesheet): boolean {
  recordAstExtendProfile?.('astExtend.documentHasExtend.calls');
  const found = documentExtendClass(root).static;
  recordAstExtendProfile?.(found
    ? 'astExtend.documentHasExtend.featureBearingCalls'
    : 'astExtend.documentHasExtend.noFeatureMisses');
  return found;
}

/** The document's {@link DocumentWalkFacts}, collected the first time the walk recorder is armed for it. */
export function documentWalkFacts(root: Stylesheet): DocumentWalkFacts {
  const facts = documentExtendClass(root);
  if (facts.walk === null) {
    recordAstExtendProfile?.('astExtend.document.walkFactWalks');
    const staticRules = new Set<Ruleset>();
    const targetAtoms = new Set<string>();
    collectDynamicExtendSets(root.rules, false, staticRules, targetAtoms);
    facts.walk = { staticRules, targetAtoms };
  }
  return facts.walk;
}

/**
 * The rules the walk recorder treats as static: the document's spine, plus the rules the
 * import planner planned statically (`extra`), in a copy so the document's set is kept.
 */
export function withRules(spine: ReadonlySet<Ruleset>, extra: ReadonlySet<Ruleset> | null): ReadonlySet<Ruleset> {
  if (extra === null) {
    return spine;
  }
  const rules = new Set(spine);
  for (const rule of extra) {
    rules.add(rule);
  }
  return rules;
}

/**
 * [extend/dynamic] Whether a document carries STATIC and/or DYNAMIC `:extend()`.
 * `static` — an extend on the ordinary Ruleset/AtRuleBlock spine (the pre-walk
 * `computeExtends`/interp-prepass surface). `dynamic` — an extend reached only through
 * a body the walk places (see {@link placingBody}; recorded by the ONE render walk,
 * ledger X12). A document can have both. `places` — such a body places a rule, a mixin
 * call places its callee's rules (a ruleset called as a mixin included), or an
 * `@import` sits inside a ruleset or such a body (the import planner never reaches
 * that sheet): once the graph has any extend, the walk must record what they place.
 */
export interface ExtendClass {
  static: boolean;
  dynamic: boolean;
  places: boolean;

  /**
   * The statically addressed `@import`s the walk places (inside a ruleset or a placing
   * body). The import planner never plans those sheets, so when nothing else in the
   * graph extends it loads them only to learn whether they carry an extend, which the
   * walk recorder must then be armed for.
   */
  placedImports: StyleImport[] | null;

  /**
   * The walk places an `@import` whose path is interpolated. Its sheet is known only
   * where the walk resolves the path, so the walk recorder is armed for it outright.
   */
  placesUnaddressedImport: boolean;

  /** What the armed walk recorder reads ({@link documentWalkFacts}), null until it is first armed. */
  walk: DocumentWalkFacts | null;
}

/**
 * The rules on the document's static spine, which the walk does not record (every
 * rule reachable through ruleset and at-rule nesting, not through a placing body),
 * and the atoms the extends in its placing bodies target.
 */
export interface DocumentWalkFacts {
  readonly staticRules: ReadonlySet<Ruleset>;
  readonly targetAtoms: ReadonlySet<string>;
}

/**
 * The body-form `&:extend()`s a statement carries for the render walk to apply wherever
 * its body lands (see {@link recordBodyExtends}): a mixin definition's (ledger X16), an
 * at-rule block's or an `each()` callback's (X19). A detached ruleset's are its own
 * ({@link heldAnonymousMixin}). Undefined for every other statement.
 */
export function walkAppliedExtends(st: Statement): readonly ExtendInstruction[] | undefined {
  switch (st.type) {
    case 'MixinDefinition':
    case 'AtRuleBlock':
    case 'For':
      return st.extendInstructions;
    default:
      return undefined;
  }
}

/**
 * The `index`-th detached ruleset a statement holds as a value — a variable's
 * (`@r: { … }`), a mixin call's argument or content block, a mixin definition's
 * parameter default. The render walk places its rules, and applies its body-form
 * `&:extend()`s (ledger X19), wherever it is called, so each classifier reads it as a
 * placing body. Null past the last one; indexed, so the classifiers allocate nothing.
 */
export function heldAnonymousMixin(st: Statement, index: number): AnonymousMixin | null {
  let seen = 0;
  switch (st.type) {
    case 'VariableDeclaration':
      return index === 0 ? anonymousMixinOf(st.value) : null;
    case 'MixinCall':
      for (const arg of st.args) {
        const held = anonymousMixinOf(arg.value);
        if (held !== null && seen++ === index) {
          return held;
        }
      }
      return seen === index ? st.content : null;
    case 'MixinDefinition':
      for (const param of st.params) {
        const held = anonymousMixinOf(param.default);
        if (held !== null && seen++ === index) {
          return held;
        }
      }
      return null;
    default:
      return null;
  }
}

/** `value` when it is a detached ruleset. */
function anonymousMixinOf(value: CallValue | undefined): AnonymousMixin | null {
  return value !== undefined && 'type' in value && value.type === 'AnonymousMixin' ? value : null;
}

/**
 * Body `index` of a statement that places rules only when the render walk runs it: a
 * `$for`/`each()` loop, a mixin definition, a `$if`/`$while` control block (one body
 * per `$if` branch). A detached ruleset is {@link heldAnonymousMixin}. Null past the
 * last body, and for every other statement. Their rules are never static extend subjects; the walk
 * records them where they land. Indexed, so the per-render classifiers allocate nothing.
 */
export function placingBody(st: Statement, index: number): readonly Statement[] | null {
  switch (st.type) {
    case 'For':
    case 'MixinDefinition':
    case 'While':
      return index === 0 ? st.rules : null;
    case 'If':
      return st.branches[index]?.rules ?? null;
    default:
      return null;
  }
}

/**
 * [extend/dynamic] The ONE traversal that classifies a document's extend surface,
 * run once per document ({@link documentExtendClass}). It reads each statement's type
 * once: a declaration, the commonest statement, is passed over at that read. Once
 * inside a placing body (`inDynamic`) every extend is dynamic. A `{ static:false, dynamic:false }` result is the no-extend document: the
 * caller then takes exactly the original zero-cost path. Pure shape analysis — no
 * evaluation. Short-circuits once both bits are set (the walk is then armed anyway).
 */
function classifyExtend(statements: readonly Statement[], inDynamic: boolean, out: ExtendClass, placed = inDynamic): void {
  for (const st of statements) {
    if (out.static && out.dynamic) {
      return;
    }
    switch (st.type) {
      case 'Declaration':
        break;
      case 'Ruleset':
        if (inDynamic) {
          out.places = true;
        }
        if (st.extendInstructions?.length) {
          if (inDynamic) {
            out.dynamic = true;
          } else {
            out.static = true;
          }
        }
        classifyExtend(st.rules, inDynamic, out, true);
        break;
      case 'AtRuleBlock':
        if (st.extendInstructions !== undefined) {
          out.dynamic = true;
        }
        classifyExtend(st.rules, inDynamic, out, placed);
        break;
      case 'StyleImport':
        if (placed) {
          out.places = true;
          if (isStaticQuoted(st.target) || (st.target.type === 'Url' && isStaticQuoted(st.target.value))) {
            (out.placedImports ??= []).push(st);
          } else {
            out.placesUnaddressedImport = true;
          }
        }
        break;
      default:
        classifyPlacing(st, out);
    }
  }
}

/**
 * A statement off the static spine: the detached rulesets it holds, the rules a mixin
 * call or `$apply` places, and a definition's or a control block's bodies.
 */
function classifyPlacing(st: Statement, out: ExtendClass): void {
  for (let index = 0, held = heldAnonymousMixin(st, 0); held !== null; held = heldAnonymousMixin(st, ++index)) {
    if (held.extendInstructions !== undefined) {
      out.dynamic = true;
    }
    classifyExtend(held.rules, true, out);
  }
  if (st.type === 'MixinCall' || st.type === 'Apply') {
    out.places = true;
    return;
  }

  /* A definition's own body-form extend applies wherever it is called (ledger X16). */
  if (walkAppliedExtends(st) !== undefined) {
    out.dynamic = true;
  }
  for (let index = 0, body = placingBody(st, 0); body !== null; body = placingBody(st, ++index)) {
    classifyExtend(body, true, out);
  }
}

/**
 * [extend/dynamic] ONE armed-only walk over the document: the static-spine Ruleset
 * nodes (`staticRules` — every rule reachable through ruleset / at-rule nesting, NOT
 * through a placing body; a rule outside it was reached dynamically and records its
 * facts at emit), and the target atoms of the extends in placing bodies.
 * Runs only when dynamic recording is first armed for the document
 * ({@link documentWalkFacts}), so non-extend documents pay nothing.
 *
 * F5 note: the planner's subject-rule set is NOT reused here — the pre-walk
 * `computeExtends` returns null (building no plan) for the common dynamic-only document
 * (extend only inside a loop/mixin, e.g. the bootstrap grid), exactly when `staticRules`
 * is most needed.
 */
function collectDynamicExtendSets(
  statements: readonly Statement[],
  inDynamic: boolean,
  staticRules: Set<Ruleset>,
  targetAtoms: Set<string>
): void {
  for (const st of statements) {
    switch (st.type) {
      case 'Declaration':
        break;
      case 'Ruleset':
        if (!inDynamic) {
          staticRules.add(st);
        } else if (st.extendInstructions?.length) {
          collectInstructionAtoms(st.extendInstructions, targetAtoms);
        }
        collectDynamicExtendSets(st.rules, inDynamic, staticRules, targetAtoms);
        break;
      case 'AtRuleBlock':
        if (st.extendInstructions !== undefined) {
          collectInstructionAtoms(st.extendInstructions, targetAtoms);
        }
        collectDynamicExtendSets(st.rules, inDynamic, staticRules, targetAtoms);
        break;
      default:
        collectPlacingSets(st, staticRules, targetAtoms);
    }
  }
}

/** {@link collectDynamicExtendSets} for a statement off the static spine (see {@link classifyPlacing}). */
function collectPlacingSets(st: Statement, staticRules: Set<Ruleset>, targetAtoms: Set<string>): void {
  for (let index = 0, held = heldAnonymousMixin(st, 0); held !== null; held = heldAnonymousMixin(st, ++index)) {
    if (held.extendInstructions !== undefined) {
      collectInstructionAtoms(held.extendInstructions, targetAtoms);
    }
    collectDynamicExtendSets(held.rules, true, staticRules, targetAtoms);
  }
  const extend = walkAppliedExtends(st);
  if (extend !== undefined) {
    collectInstructionAtoms(extend, targetAtoms);
  }
  for (let index = 0, body = placingBody(st, 0); body !== null; body = placingBody(st, ++index)) {
    collectDynamicExtendSets(body, true, staticRules, targetAtoms);
  }
}

/** Add the selector atoms of every `:extend()` target in `instructions` to `atoms`. */
export function collectInstructionAtoms(instructions: readonly ExtendInstruction[], atoms: Set<string>): void {
  for (const inst of instructions) {
    for (const target of selectorLevel(inst.target)) {
      collectBranchAtoms(target, atoms);
    }
  }
}
