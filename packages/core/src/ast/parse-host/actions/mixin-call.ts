/**
 * Mixin-CALL family: `.mixin()` / `#mixin()` statement calls, plus the namespace
 * accessor form `#ns > .mixin()` / `#ns .borders()` — all one grammar rule
 * (`MixinCall`). The DEFINITION form is the mixin-def family's `MixinDef`; this
 * family builds the tree2 `MixinCall` the serializer (`serialize.ts:844`,
 * `expandCall` + `mixin-dispatch.ts`) already dispatches.
 *
 * P0 — the parser hands the call fully STRUCTURED, so this family never
 * re-tokenizes bytes: the leading leaves are the selector-token path
 * (`#theme`, `>`, `.mixin`), the `MixinArgs` node is the shared arg group the
 * mixin-def family builds (an `ArgSlot[]` carrying each slot's BUILT value / named
 * marker), and a trailing `!`/`important` leaf pair marks call-level `!important`.
 * The LAST selector token is the mixin name; every earlier token is a namespace
 * descent segment (G2's namespace-accessor case folds in here — the parser already
 * splits `#ns > .m` into separate leaves, so the path is read structurally rather
 * than re-split from a flattened key the way the bridge had to).
 *
 * The combinator on a `PathSeg` is carried for fidelity but the serializer's
 * `descendNamespacePath` matches each segment by its own-local selector string
 * only, so a descendant (` `) vs child (`>`) descent dispatches identically.
 */
import * as t2 from '../../index.js';
import { type BuildAction, type BuildArgs, placeholder } from '../host-context.js';
import { isLeaf } from './interp.js';
import { type ArgSlot, isArgSlotList, isNamedMarker, isRestMarker } from './mixins-def.js';

/** One namespace-path / name segment: a selector token plus the combinator that
 *  preceded it (` ` descendant default, `>`/`+`/`~` explicit). */
interface Seg {
  readonly comb: t2.Combinator;
  readonly sel: string;
}

function isCombinator(v: string): v is t2.Combinator {
  return v === '>' || v === '+' || v === '~';
}

/** Map one neutral arg slot to a `CallArg`: a named slot (`@a: v`) → named arg,
 *  a spread slot (`@args...`) → a spread arg whose value is the list VarRef, a
 *  built value node → positional value, an unbuilt slot → its verbatim bytes. */
function slotToCallArg(slot: ArgSlot): t2.CallArg {
  const built = slot.built;
  if (isNamedMarker(built)) return { name: built.name, value: built.value };
  // [spread] `@args...` forwards a list variable as positional args at dispatch.
  if (isRestMarker(built) && built.name !== undefined) {
    return { value: t2.varRef(built.name), spread: true };
  }
  if (t2.isNode(built)) return { value: built as t2.ValueNode };
  return { value: t2.any(slot.text.trim()) };
}

/**
 * `MixinCall` grammar rule → tree2 `MixinCall`. Exported so the mixin-def family
 * can reuse it for the STATEMENT (no-brace) form of `MixinOrQualifiedRule`: the
 * top-level ambiguity wrapper carries an identical leaf/`MixinArgs` child shape,
 * so a document-level `.loop(3);` builds the same `MixinCall` a body-level call
 * does (body-level calls parse straight to `MixinCall`; top-level ones do not).
 */
export function buildMixinCall(args: BuildArgs): unknown {
  const segs: Seg[] = [];
  let pendingComb: t2.Combinator = ' ';
  let slots: readonly ArgSlot[] = [];
  let important = false;

  for (const c of args.children) {
    if (isArgSlotList(c)) {
      slots = c;
      continue;
    }
    if (!isLeaf(c)) continue;
    const v = c.value;
    if (v === '' || v === ';' || v === '!') continue;
    if (v === 'important') {
      important = true;
      continue;
    }
    if (isCombinator(v)) {
      pendingComb = v;
      continue;
    }
    segs.push({ comb: pendingComb, sel: v });
    pendingComb = ' ';
  }

  if (segs.length === 0) return placeholder(args.type);
  const name = segs[segs.length - 1]!.sel;
  const path: t2.PathSeg[] = segs.slice(0, -1).map((s) => ({ comb: s.comb, sel: s.sel }));
  const callArgs = slots.map(slotToCallArg);
  return { type: 'MixinCall', name, args: callArgs, path, important } satisfies t2.MixinCall;
}

export const MIXIN_CALL_ACTIONS: readonly BuildAction[] = [{ type: 'MixinCall', build: buildMixinCall }];
