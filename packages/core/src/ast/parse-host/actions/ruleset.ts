/**
 * Ruleset family: the document root + a nested/selected rule.
 *
 * `Stylesheet` → tree2 `Root`; `Ruleset` → tree2 `Rule`. The selector head is
 * consumed as a built tree2 `Complex`/`SelectorList`/`Compound` child when the
 * selector family is registered, else re-derived from the raw source bytes (so
 * this family stands alone in the F0 seed). Body statements are the real tree2
 * child nodes (placeholders / leaf tokens filtered out).
 */
import * as t2 from '../../index.js';
import {
  type BuildAction,
  type BuildArgs,
  isExtendMarker,
  isStatement,
  selectorText,
  takeSelectorExtends,
} from '../host-context.js';

/** The selector value a `Rule` accepts: a built selector node, or raw bytes. */
function ruleSelector(args: BuildArgs): string | t2.Complex | t2.SelectorList {
  const first = args.children[0];
  if (first instanceof t2.SelectorList || first instanceof t2.Complex) return first;
  if (first instanceof t2.Compound) return t2.complex([{ compound: first }]);
  return selectorText(args.ctx.src, args.children, args.rawChildren);
}

const stylesheet: BuildAction = {
  type: 'Stylesheet',
  build: (args) => t2.root(args.children.filter(isStatement) as t2.Statement[]),
};

/**
 * [extend F11] The `:extend()` instructions this rule carries: those authored on
 * its selector (`.a:extend(.b)`, hoisted onto the selector node by the selector
 * family) plus any standalone body `&:extend(.b);` statements (`ExtendMarker`
 * children, filtered out of the body since they are not tree2 nodes). Undefined
 * when none, so the serializer's zero-cost no-extend gate holds.
 */
function ruleExtends(
  args: BuildArgs,
  selector: string | t2.Complex | t2.SelectorList,
): t2.ExtendInstruction[] | undefined {
  const instructions: t2.ExtendInstruction[] = [];
  if (typeof selector !== 'string') {
    const fromSelector = takeSelectorExtends(selector);
    if (fromSelector) instructions.push(...fromSelector);
  }
  for (const child of args.children) {
    if (isExtendMarker(child)) instructions.push(...child.__t2extend);
  }
  return instructions.length > 0 ? instructions : undefined;
}

const ruleset: BuildAction = {
  type: 'Ruleset',
  build: (args) => {
    const selector = ruleSelector(args);
    const body = args.children.filter(isStatement) as t2.Statement[];
    return t2.rule(selector, body, ruleExtends(args, selector));
  },
};

export const RULESET_ACTIONS: readonly BuildAction[] = [stylesheet, ruleset];
