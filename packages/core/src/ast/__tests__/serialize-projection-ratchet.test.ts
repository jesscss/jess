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
    expect(occurrences(/return \{ node, frame, important, leadingBlockComments, fromApply, callBytes \};/gu)).toBe(1);
    expect(occurrences(/place\(\{ node, frame, important, leadingBlockComments: null, fromApply, callBytes: null \}\);/gu)).toBe(2);
    expect(occurrences(/place\(\{ node: part, frame, important, leadingBlockComments: null, fromApply, callBytes: null \}\);/gu)).toBe(1);
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
    // +15 functions (`ModuleImport` load/bind/eval, #182): module export
    // conversion, namespace/selected binding, and the two existing Reference
    // shapes that dispatch namespaced module functions directly, without a
    // temporary Reference node. The two added helpers keep imported callables
    // out of CSS-call lookup and bind explicit `$name(…)` references. +2
    // `new Set`: the SCSS qualified-call raw-ABI guard and one lazy JSON cycle
    // guard. +5 `new Map`: document-scoped module facts in the compile plan and
    // direct-serialize fallback, the per-frame module-function table, and the
    // two lazy allocation sites for one render-local reference-identity map.
    // Strong ownership avoids per-node ephemeron tables.
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
    // +1 function (`evalQueryPreludeParts`): a media/container prelude is built as
    // fragments so a [general-enclosed] group passes the normalizer as written;
    // the supports normalizer became the shared `normalizePreludeParts`.
    // +1 function (`resolvePositionOffsets`): source-map positions record chunk
    // indices during the walk and become character offsets once, after the
    // post-walk chunk rewrites; the walk no longer keeps a running offset.
    // +1 function (`spliceCtx`): an interpolation splice evaluates without
    // compress, so compressed output never rewrites text inside a larger token.
    // +1 function (`bodyHasPlannedImport`) and +1 `new Map` (the import planner's
    // render-scoped at-rule scope ids, `AtRuleScopes`): the planner gate now sees an
    // import nested in an at-rule block, and an imported `@media` gets its own extend
    // scope instead of its parent's (EXTEND-SEMANTICS §8).
    // -1 `new Set` (jess#245): a control-flow body's declarations are spliced
    // into the ordinary source-fold stacks at the `$if`/`$while`, so the set of
    // direct declarations that split those stacks into a prefix is gone.
    // +1 function (`takeBodyTrivia`, jess#301): the one comment cursor of a
    // callable body, shared by a call's replay and a ruleset argument's writer;
    // the two cursor loops it replaced in `queueBodyTriviaBefore`/`Tail` are gone.
    // `new Set` → `new Map` (module identity): the emit-once `loadedImports`
    // registry also records a shared `@compose`d module's one activation frame,
    // so a later compose edge binds its namespace there instead of going unbound.
    // +4 functions (module namespaces, R6 §E.1 / ledger A8): `composedModuleFrame`
    // names the one fact that a namespace block is its module's activation,
    // `activatedMemberLookup` picks the store a member is read through,
    // `rejectComposedMemberCall` turns a call on a @compose member into an error
    // instead of a dropped call, and `unresolvedReference` makes an unbound
    // reference head a miss in both value evaluators.
    // -4 functions and -1 `new Set`: `settledCandidates`, `descendNamespacePath`,
    // `resolveToMixinCall` and `joinPreludeParts` had no callers left.
    // +1 function (`mediaImportStayingCss`, ledger A10): an import the media
    // desugar wrapped that nothing loads is written as one `@import … q;`.
    // +1 function (`moduleLoadFailed`): a `@use` that cannot load is an
    // `import/load-failed` at the `@use`, as `@plugin` already is.
    // +6 functions, -2 `new Set` (walk-recorded extend placement, jess#355/#359/
    // #360/#361, ledger X14): `openDynamicPath`/`dynamicPathAt` give a mixin- or
    // loop-placed rule its ancestors' selector IR (built on first read only),
    // `withDynamicPlacement` restores the recorder's at-rule scope, sheet boundary
    // and open rules after a rule, at-rule or composed module, `placementProjection`
    // keeps a `(reference)` copy's projection apart from a plain copy's,
    // `hiddenRulesToReveal` reserves the hidden rules a walk-recorded extend may
    // reveal, and `collectInstructionAtoms`/`collectBodyExtendAtoms` gather the
    // targets of extends that only the walk reaches; `visibleHeaderFromProjection`,
    // the merged set of hidden reference rules and the set of loop bodies that
    // earned a placement token (every loop iteration and mixin call now does) are gone.
    // +6 functions, +5 `new Map`, +2 `new Set` (extend placement follow-ups, jess#359,
    // ledger X14): `placingBody` names the bodies only the walk places (loops, mixin
    // definitions, `$if`/`$while`, detached rulesets) for every classifier;
    // `composedModuleBoundary` keeps ONE boundary per composed module with every
    // composer as a parent (the module graph is a DAG); `resolveDynamicExtends` skips
    // the deferred re-solve when no recorded rule can meet a target; `recordOpenRule`
    // records a placed rule for both writers; `ownLevelOf` and the target-branch map
    // build selector IR once per canonical node; `settled` restores render state
    // however a run settles. The maps are the planner's module boundaries and import
    // placement tokens; the sets, the fold's target atoms and the hidden rulesets that
    // hold a walk-placed `@import`.
    // +1 function (`putPending`): every slot that settles after the walk reserves
    // its chunk through one helper, so each records its source-map position alike.
    // +4 functions (`eagerSnapshot`, `carryCompressed`,
    // `compressedEagerSource`, `compressedEagerSources`) and +2 `new WeakMap`
    // (the render-scoped `compressedBindings`, created once per render entry): a
    // mixin argument is evaluated once and binds as written; under compress it
    // carries the value a declaration folds (ledger O3).
    // +4 functions (`holdBodyTrivia`, `skipBodyTrivia`, `ownsItsComments`,
    // `replayBodyTriviaBefore`) against -2 (`emitBodyBlockCommentTriviaBefore`,
    // `bodyStartForTriviaReplay`): every body's comments are replayed by its
    // own walk, the one cursor a call's body already used, and a loop body is
    // held for its iterations. +2 functions (`putDeclarationValue`,
    // `insideSpan`): both writers write a custom property's value one way, and
    // the root replay finds a statement span by binary search. +1 function
    // (`placeStatementCall`): a statement call is evaluated where it stands in
    // either writer's walk. +1 function (`holdTriviaBetween`): a loop locates
    // its body span once for all of its iterations.
    // +2 functions (`preselectControlFlow`, `guardReadsInOrder`, ledger N15): a
    // frame's `if()`/`$if` arms whose conditions read only scoped bindings are
    // selected at its first scoped read, so a read before the `if()` sees the
    // selected branch as an inline declaration. The value walk the condition
    // check needs is `callValueHasLookup`, the self-reference walk generalized
    // over a static predicate rather than a second walk.
    // +1 `new Set` (module namespaces, ledger A8): a loop over a composed
    // module's namespace iterates each member name once, through its activation.
    // +2 functions, +4 `new Map`, +1 `new Set` (module activations, ledger A15):
    // `activateComposeEdge` is the one place a compose edge resolves its
    // configuration and shared activation (`moduleActivations`, per identity) and
    // binds its namespace — run by the import planner for a document-root compose
    // (`composeActivations`), so the namespace is published early like an
    // import's facts, else when execution reaches it; `memberLookup` names the
    // store a member is read through, shared by `@ns.name` and `as *`, whose
    // members bind in both of the importer's stores (`bindingValueFrames`,
    // `cells`), once per name.
    // +2 functions, +2 `new Map`, +1 `new Set`, +1 `new WeakMap` (ruling J2):
    // each `if()` is decided once per activation (`preselectedIfs`) and its
    // decision reused when execution reaches it; `selectControlFlow` rebuilds the
    // selected index lazily, once after an import publishes a whole document,
    // instead of once per published fact; the conditions run on a
    // statement-level context (a fresh exclusion set); `ifReadsInOrder` caches
    // a per-`if()` source fact.
    // +4 functions, +1 `new Map`, +1 `new Set` (rulings J6a/c, ledger R5): an
    // `as *` compose writes its live bindings where it executes
    // (`bindComposedLiveMembers`, sharing the member walk
    // `eachComposedVariableMember` with the early scoped publication); a
    // planner-activated module claims the `@import`s whose facts it published
    // early, per activation (`claimModulePrepublishedImport`); a nested plain
    // compose before a document-root `set` is rejected with the one
    // `alreadyLoadedUnconfigured` diagnostic the later-`set` case raises.
    // +1 function, +1 `new WeakMap` (ruling J1): `erroringModes` keeps one
    // error-mode copy of a render's modes for namespaced calls instead of
    // spreading the modes on every call.
    // +2 functions and +1 `new Set` (owner ruling 2026-10-05):
    // `tokenFoldSpecificity`/`branchFoldSpecificity` read a branch's specificity
    // from the selector IR so `'native'` folds only equal-specificity child runs;
    // the Set is the module-level allowlist of standard pseudo-classes.
    // -3 functions and -1 `new Set` (owner ruling 2026-10-05): the specificity,
    // foldability and the pseudo-class allowlist moved to the shared `:is()`
    // grouping module (`is-grouping.ts`) that extend's groups also use;
    // `leadsWithCombinator` became its `nestingGroupKey`.
    // +2 functions: a nested rule hoisted out of an enclosing rule re-opens the
    // at-rules it rose out of (`emitHoistEntry`), through the nested at-rule
    // writer's shell (`nestedAtRuleShell`).
    // +1 function: a structured `:nth-*()` / `:lang()` / `:dir()` pseudo reaches
    // its mixin-match atoms through its argument's parsed leaves
    // (`pushArgumentAtoms`) instead of re-splitting its canonical spelling.
    // -1 `new Set` (ledger F11): the `DEFERRED_CSS_AUTHORED_CALLS` name set is
    // retired; every call with no callable is written out with its arguments as
    // values and its comments kept.
    // +3 functions: module configuration as an activation snapshot
    // (`seedModuleConfig`, `snapshotModuleConfig`) that a `set` nested before a
    // planned document-root compose may configure (`plannedAhead`, ruling J6c).
    // +3 functions, -1 `new Map`: a structural mixin argument is evaluated once,
    // its bound bytes written from that evaluation (`writtenBytes`,
    // `emitAsWritten`) instead of a second evaluation memoized per source; only
    // the layout pretty output replays rides on it (`replayedLayoutOf`).
    // -1 function, -1 `new Set` (ledger F5): the CSS color-call shape test
    // moved to `isCssColorCall` in `nodes.ts`, which the `.jess` converter
    // shares.
    // +2 functions, +1 `new Map`, -1 `new Set` (jess#359, ledger J14): the
    // planner and the render walk share the import-once test for a `(reference)`
    // re-import (`isReferenceReimport`); a planned import placement is keyed by
    // the placement its statement is reached in (`plannedImportPlacement`, one
    // map per placement); the planner's import-once identities became a map that
    // records whether an `@import` loaded the document.
    // +4 functions, +1 `new Set` (ledger X7 as amended 2026-10-05): with extend
    // recording armed the walk resolves an interpolated selector once,
    // structurally (`resolvedSelectorList`/`Branch`/`Term`), a glued name joining
    // the name it continues (`resolvedCompoundTokens`), and an imported
    // interpolated rule adds its extend targets to the walk's target atoms.
    // +2 functions, +1 `new Set` (ledger X16, J15): a called definition's
    // body-form extend is recorded for the rule the call lands in
    // (`recordCalledExtends`, sharing `recordDynamicInstruction` with the walk's
    // other extends); an imported definition carrying one adds its targets to
    // the walk's target atoms.
    // +2 functions, +1 `new Set`: a hidden `(reference)` at-rule around a rule a
    // walk-recorded extend may reveal renders as a reserved container
    // (`referenceAtRuleShown`, `reserveRevealContainer`), collected with the
    // rules to reveal.
    // +2 functions, net: the reserved container opens and closes in two calls
    // (`revealContainerStart`/`endRevealContainer`, no closure per at-rule);
    // the import planner resolves an imported sheet's interpolated rules only
    // when it has one (`bodyHasInterpRule`); a branch whose attribute token
    // holds a `&` takes the token walk (`branchHasAttributeAmp`); the one-line
    // `plannedImportPlacement` wrapper is inlined.
    // +2 functions (owner ruling 2026-10-06, ledger V3): a `$name` property
    // accessor in a typed position reads the declaration's parsed value, as a
    // variable does, instead of re-reading its bytes, so its resolution
    // (`resolvePropAccessor`) is shared by the byte and typed lanes, and a
    // merged property's join (`mergedPropertyBytes`) left the byte lane.
    // +2 functions (ledger V3, C2): a merged property accessor's typed value is
    // its members' parsed values (`mergedPropertyValue`), and a string's content
    // for a path request or a diagnostic message is read from the node
    // (`quotedContentSync`), never by stripping quotes from its bytes.
    // +1 function and +2 `new WeakMap` (ledger V3, C2): every render keeps an
    // eager argument snapshot's typed value beside it (`snapshotValues`, one per
    // render entry, filled by `carrySnapshot`), so an argument is never re-typed
    // from its bytes across a mixin boundary.
    // -2 `new Set`, ±0 functions (owner ruling 2026-10-06): a paren group inside a
    // math function is written back as authored (`unconsumedParens` replaces
    // `arithmeticTier`), so the operator-tier sets that decided which parens
    // carried precedence are gone.
    // +1 function: a paren group around kept math or raw bytes keeps its own
    // parens in both value lanes (`isInertGroup`), so a group that is a whole
    // function argument inside a math function is no longer dropped.
    // ±0 functions: `groupComputes` (a group keeps its parens unless math in it
    // computes, in every position) replaces `preservedOperand`, whose write-back
    // the value lane now does itself.
    // +2 `new Set` (ledger X18): the import planner and the render walk each record
    // every document an `@import` of any kind placed, created on the first import,
    // so a `(reference)` import of a sheet already loaded is dropped after a
    // `(multiple)` or `(reference)` import as J14 drops it after a plain one.
    // +1 function (ledger V29): an authored paren group around an operation kept
    // as written (`(foo + 1)`) keeps its parens in both value lanes
    // (`keepAuthoredGroup`), so precedence survives.
    // +1 function (ledger X19): the body-form extends the walk applies where a body
    // lands — a mixin definition's, an at-rule block's, a detached ruleset's — are
    // read in one place (`walkAppliedExtends`) by the five extend classifiers.
    // +5 functions, +1 `new WeakSet` (ledger F4; orchestrator judgment under owner
    // delegation 2026-10-06): a paren group is consumed only by what computes in
    // it — math, a `$( … )`, a call a callable computes, or a variable or mixin
    // argument bound to one (`groupComputation`, `computationIn`,
    // `isComputationSplice`, and `computedArguments` for the argument a mixin
    // parameter stands for); a group around one value keeps its spelling as an
    // operand of math kept as written and as a mixin argument (`writtenParens`,
    // `spelledOperand`, `argumentSnapshot`); `groupComputes` became a one-line
    // arrow.
    // +1 function, net (ledger V22): an interpolation that unquotes reads the
    // typed string (`unquotedRef`) — in a template, a selector splice and an
    // emergent `@{…}` — and `[@@name]` names a member by `lookupName`, so
    // `stripOuterQuotes` is gone; the synchronous positions share one guard
    // (`syncValue`).
    // +1 function (ledger F12): a custom value's comment replay places a bare
    // variable or an interpolation by its own source span (`customValueHole`),
    // so a value that reads a variable keeps its edge comments.
    // +1 function, +2 `new Set` (ledger X19): every detached ruleset a statement
    // holds — a variable's, a mixin call's argument or content block, a parameter
    // default — is read by the five extend classifiers as a placing body
    // (`heldAnonymousMixin`); the import admission and atom collectors create their
    // target-atom set on the first such ruleset with an extend.
    // +1 function (ledger F12): a custom value's trailing comments are the comment
    // run that starts where the value ends (`customValueTrailingRun`), read from the
    // document's comment table rather than taken into the value node's span.
    // +2 functions (ledger F4; SEMANTIC-INVARIANTS 2): a group around a reference
    // is classified by what the reference names, through the resolvers its
    // evaluation uses — a variable, an `@@name`, a property, a member — so every
    // way of reading a value consumes the group alike (`slotComputation`,
    // `lookupBinding`).
    // +2 functions (owner 2026-10-04 compress near-parity): a list in a query
    // prelude is joined by the walker's own glue, so compress tightens a ratio
    // written directly, through a variable or through a mixin argument
    // (`listBoundaryPart`, `typedPreludeParts`).
    // +1 function (ledger D22: never re-read parser output): a condition call in a
    // query prelude (`style(--x: @{v})`) is walked as its feature, so a value
    // spliced into it is never scanned or re-spaced (`conditionFeature`).
    // +2 functions net and +1 `new WeakSet` (§4.7, no silent rung): the
    // final-unit predicate moved to value-operate (`isUnexpressible`, the one
    // walk the strict throw also reads); a `List`, a `Sequence` and a
    // space-separated slot check their items through one helper
    // (`validateItemUnits`); a call or a guard operand that consumes a kept
    // operation warns (`warnConsumedKept`, `warnConsumedOperand`); and each
    // kept operation warns once (`warnedUnitValues`).
    // +1 function (owner ruling 2026-10-06, unitless ± unit): an operand of an
    // operation kept inside a math function that is itself kept math reached
    // through a variable is grouped by precedence (`keptOperand`); the value
    // lane still writes a group's own parens back.
    expect(occurrences(/^function |^async function /gmu)).toBe(558);
    expect(occurrences(/new Map/gu)).toBe(85);
    expect(occurrences(/new Set/gu)).toBe(43);
    expect(occurrences(/new WeakMap/gu)).toBe(10);
    expect(occurrences(/new WeakSet/gu)).toBe(2);
    expect(occurrences(/const group: Leaf\[\] = \[\]/gu)).toBe(9);

    /*
     * The single nested leaf buffer, now owned by the one evaluator and mode-gated
     * so the collapsed projection allocates none.
     */
    expect(occurrences(/const buf: Leaf\[\] = nested \? \(sharedLeaves\?\.leaves \?\? \[\]\) : MOOT_LEAVES/gu)).toBe(1);
    expect(occurrences(/evaluateLeafStatement\(/gu)).toBe(3);
    expect(occurrences(/evaluateSilentStatement\(/gu)).toBe(2);
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

    /* `preselectControlFlow` decides arms through the one condition evaluator, `selectedIfBody` (ruling J2). */
    expect(occurrences(/selectIfBody\(/gu)).toBe(6);
    expect(occurrences(/selectedIfBody\(/gu)).toBe(3);
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
