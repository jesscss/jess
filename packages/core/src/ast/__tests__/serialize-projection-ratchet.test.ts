import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SERIALIZE_PATH = fileURLToPath(new URL('../serialize.ts', import.meta.url));
const SOURCE = readFileSync(SERIALIZE_PATH, 'utf8');

function occurrences(pattern: RegExp): number {
  return [...SOURCE.matchAll(pattern)].length;
}

describe('V19 one-evaluator projection ratchet', () => {
  it('names every statement evaluator that still dispatches a body', () => {
    /*
     * V19 slice 5: the second body dispatcher (`emitNestedBody`) is deleted; the
     * one evaluator `walkBody` drives both write projections. The removed pattern
     * stays listed so a re-introduced nested dispatcher fails this gate.
     */
    const dispatchers = ([
      ['walkBody', /function walkBody\(/u],
      ['emitNestedBody', /function emitNestedBody\(/u]
    ] as const).filter(([, pattern]) => pattern.test(SOURCE)).map(([name]) => name);

    expect(dispatchers).toEqual(['walkBody']);
  });

  it('routes the nested write projection through the one evaluator via a pure adapter', () => {
    /*
     * `nestedBody` is a calling-convention adapter with NO statement dispatch of
     * its own: it forwards straight to `walkBody`. This proves the nested entry
     * point is not a second dispatcher in disguise.
     */
    expect(SOURCE).toContain('function nestedBody(');
    expect(SOURCE).toMatch(/function nestedBody\([\s\S]*?\n\): MaybePromise<void> \{\n  return walkBody\(/u);
    const nestedBodySource = SOURCE.slice(
      SOURCE.indexOf('function nestedBody('),
      SOURCE.indexOf('function nestedBody(') + 800
    );
    expect(nestedBodySource).not.toContain('switch (node.type)');
  });

  it('names every output-setting read that can select evaluation behavior', () => {
    expect(occurrences(/\be\.collapse\b/gu)).toBe(1);
    expect(SOURCE).toContain(
      'if (!e.collapse && e.referenceImportDepth === 0 && !hasDynamicImportTarget)'
    );
    expect(SOURCE).not.toContain('function emitNestedRuleGuarded(');
  });

  it('keeps one leaf shape and no pending-comment side table', () => {
    expect(occurrences(/new WeakMap<Leaf\[\], string\[\]>\(\)/gu)).toBe(0);
    expect(occurrences(/pendingLeafBlockComments\.(?:get|set|delete)\(/gu)).toBe(0);
    expect(occurrences(/\.\.\.\(imp \? \{ important: true \} : \{\}\)/gu)).toBe(0);
    expect(occurrences(/\.\.\.\(applyExpansion \? \{ fromApply: true \} : \{\}\)/gu)).toBe(0);
    expect(occurrences(/return \{ node, frame, important, leadingBlockComments, fromApply \};/gu)).toBe(1);
    expect(occurrences(/place\(\{ node, frame, important, leadingBlockComments: null, fromApply \}\);/gu)).toBe(2);
    expect(occurrences(/place\(\{ node: part, frame, important, leadingBlockComments: null, fromApply \}\);/gu)).toBe(1);
    expect(SOURCE).toContain('pendingLeafBlockComments: string[] | null;');
    expect(SOURCE).toContain('pendingLeafBlockCommentOwner: Leaf[] | null;');
  });

  it('does not grow the serializer helper or collection-construction surface', () => {
    // +1 function (`memoPureDeclMap`) and +1 `new Map` (the lazy per-frame lookup memo,
    // MIXIN-SCOPING-AND-LOOKUP-MEMO §4); `new WeakMap` stays 4 — the memo is a plain
    // frame-owned Map, not a WeakMap, by design.
    // +1 function (`reachedViaMixinSplice`): a chain walk keeping a ruleset's static
    // extend plan off its mixin-call splice placement (extend/splice fix).
    // +1 function (`srcFile`): the active source file at a position-push site,
    // read only when `trackPositions` is on (source-map generation).
    // +10 functions ([compress] `output.compress`): the layout helpers
    // `blockIndent`/`bodyIndent`/`nl`/`blockOpen`/`declEnd`/`emitBlockClose`/
    // `composeSelectorHeader`, the comment gate `keepComment`/`putBlockComment`,
    // and the compress-aware value emit `emitValueC`. Each returns the exact
    // pretty bytes when compress is off, so compress:off output is byte-identical.
    // Collection overlays reuse existing BindingCell/DeclEntry records for typed
    // values, so no serializer-side Map or helper-count increase is permitted.
    // +5 functions and +5 `new Map` (module configuration, spec R6 Part E):
    // `validateModuleConfig` (routes `@compose … with/set { … }` names to the
    // providing plugin), `configuredModuleFrame` (the module's isolated overlay
    // frame + apply), `moduleConfigRejected` (the shared reject diagnostic), and
    // `structurallyEqualIgnoringSpans`/`sameModuleConfig` (idempotent-vs-conflicting
    // `set` comparison). The Maps: the overlay's `reassign` (scoped `@name`/
    // `!default`), seed `cells` (live `$name` `?:`), `bindingValueFrames` (config
    // evaluates in importer scope), the equality helper's key map, and the
    // per-module-identity `set` registry (`e.moduleConfigs`).
    // +3 functions (@compose module isolation, spec R6 Part E): `unconfiguredModuleFrame`
    // (the isolated overlay frame for a plain `@compose`, so it is non-transitive like the
    // configured case), `deriveModuleNamespace` (Sass default-namespace inference from the
    // specifier string), and `publishComposedModule` (binds the module's members under
    // `@<ns>` — or merges them unqualified for `as *` — instead of flat-splicing them, which
    // is what `@import` still does). No new Map/Set: the namespace binding reuses the
    // existing declIndex/detached-binding records.
    // +13 functions (`ModuleImport` load/bind/eval, #182): module export
    // conversion, namespace/selected binding, and the two existing Reference
    // shapes that dispatch namespaced module functions directly, without a
    // temporary Reference node. +3 `new Set`: render-local imported-function
    // and namespace-value identity plus one lazy JSON cycle guard. +2 `new Map`:
    // document-scoped module facts in the compile plan and direct-serialize
    // fallback; strong ownership avoids per-node ephemeron tables.
    // +9 functions and +2 `new Map` (`@import` is a SOURCE FOLD, jess#229): an
    // imported fact used to be APPENDED to whichever index it landed in, so it
    // outranked every local fact however early its `@import` was written. A
    // published fact is now given a `SourceRank` AT PUBLICATION TIME — the
    // `@import`'s own statement index (`importSiteRank`, `importedFactRank`,
    // `factSite`) extended by the fact's index in the imported document — and
    // `publishRankedMixinEvent` / `insertRankedFact` / `factsInSourceOrder` /
    // `publishImportedRuleMixins` file each fact at it. `compareSourceRankToIndex`
    // compares a rank against an authored statement's position WITHOUT
    // materializing `[index]`, which is why no authored statement gets a tuple.
    // The two Maps are `factRanks` (published declarations only — the ordered
    // declaration stack is the one consumer that compares two published facts) and
    // `frameStatementIndex`'s positions, both written and read at publication.
    // Ordered LOOKUP paths carry a parallel int site array instead, so namespace
    // descent merges integers with no array, no sort, no cache and no Map.
    // -9 functions and -3 `new Set` (ledger P34): the eval-time bare-slash
    // promotion (with its three operator Sets) and the calc() slash-group
    // reinterpretation are gone. The Less grammar now builds the division, or
    // the slash-separated list, itself.
    // +1 function: `isAuthoredGroupExpression`, so an `Expression` the author
    // spelled as a Less paren group keeps its parens when it is not evaluated.
    // +2 functions and +2 `new Set` (`arithmeticTier`, `preservedOperand` and
    // the two operator tiers): an operation kept as written inside a math
    // function re-spells an authored group whose parens carry precedence —
    // `calc(100% - (a + b))` is not `calc(100% - a + b)`.
    // +1 function (`unloweredCall`, ledger P36): the one reader of a lowered
    // node's retained call, so a Less modern-mode `if()`/`boolean()`/`each()`
    // is evaluated through `evalCall` like any unimported call; no Map/Set.
    // +2 functions (`evalStatementCall`, `statementCallBytes`, ledger P37): a
    // call standing alone in statement position is evaluated once, and one that
    // came back as itself (a plain CSS call) raises instead of being written out.
    // +2 functions (`writtenRulesetArgument`, `dispatchCall`, ledger P37): a ruleset
    // argument of a call written out as-is is written from its evaluated body, and a
    // legacy plugin that declines a call leaves it on the unknown-call path.
    // -1 function (`canEmitRootCallValue`): the statement table replaces it.
    // +2 functions (`writtenBlockBody`, `rejectRulesetArgument`, ledger P37): a
    // ruleset argument's nested rules, at-rules and mixin calls are evaluated and
    // written inside its braces, one body at a time.
    expect(occurrences(/^function |^async function /gmu)).toBe(471);
    expect(occurrences(/new Map/gu)).toBe(68);
    expect(occurrences(/new Set/gu)).toBe(41);
    expect(occurrences(/new WeakMap/gu)).toBe(4);
    expect(occurrences(/new WeakSet/gu)).toBe(0);
    expect(occurrences(/const group: Leaf\[\] = \[\]/gu)).toBe(9);

    /*
     * The single nested leaf buffer, now owned by the one evaluator and mode-gated
     * so the collapsed projection allocates none.
     */
    expect(occurrences(/const buf: Leaf\[\] = nested \? \(sharedLeaves\?\.leaves \?\? \[\]\) : MOOT_LEAVES/gu)).toBe(1);
    expect(occurrences(/evaluateLeafStatement\(/gu)).toBe(3);
    expect(occurrences(/evaluateSilentStatement\(/gu)).toBe(5);
  });

  it('keeps one evaluator for callable expansion', () => {
    expect(occurrences(/function expandCall\(/gu)).toBe(1);
    expect(occurrences(/function expandApply\(/gu)).toBe(1);
    expect(occurrences(/function expandReferenceCall\(/gu)).toBe(1);
    expect(occurrences(/expandNestedCall\(/gu)).toBe(0);
    expect(occurrences(/expandNestedApply\(/gu)).toBe(0);
    expect(occurrences(/expandNestedReferenceCall\(/gu)).toBe(0);
    expect(occurrences(/CallableBodyWriter/gu)).toBe(0);
    expect(occurrences(/writeCollapsedCallableBody/gu)).toBe(0);
    expect(occurrences(/writeNestedCallableBody/gu)).toBe(0);
    expect(occurrences(/mixinCallHomes/gu)).toBe(0);
    expect(SOURCE).toContain('const aliasWasExcluded = e.excluded.has(alias);');
    expect(SOURCE).toContain('if (!aliasWasExcluded) {\n            e.excluded.delete(alias);\n          }');
  });

  it('keeps one evaluator for control-flow selection and iteration', () => {
    expect(occurrences(/function expandFor\(/gu)).toBe(1);
    expect(occurrences(/function expandNestedFor\(/gu)).toBe(0);
    expect(occurrences(/expandFor\(/gu)).toBe(6);
    expect(occurrences(/expandNestedFor\(/gu)).toBe(0);
    expect(occurrences(/selectIfBodyForRender\(/gu)).toBe(0);
    expect(occurrences(/selectIfBody\(/gu)).toBe(6);
    expect(occurrences(/runWhile\(/gu)).toBe(6);
  });

  it('keeps one evaluator for containers, at-rules, imports, and hoist placement', () => {
    expect(occurrences(/function expandRule\(/gu)).toBe(1);
    expect(occurrences(/function flatten\(/gu)).toBe(0);
    expect(occurrences(/function emitNestedRule\(/gu)).toBe(0);
    expect(occurrences(/function activateRuleFrame\(/gu)).toBe(1);
    expect(occurrences(/function expandAtRuleBlock\(/gu)).toBe(1);
    expect(occurrences(/function emitAtRuleBlock\(/gu)).toBe(0);
    expect(occurrences(/function emitNestedAtRuleBlock\(/gu)).toBe(0);
    expect(occurrences(/function expandStyleImport\(/gu)).toBe(1);
    expect(occurrences(/function emitStyleImport\(/gu)).toBe(0);
    expect(occurrences(/astExtend\.emit\.nestedHoistPlacements/gu)).toBe(1);
  });
});
