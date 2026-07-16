/**
 * [tree2-native] Ruleset family: the document root + a nested/selected rule.
 *
 * `Stylesheet` → tree2 `Root`; `Ruleset` → tree2 `Rule`. The selector head is
 * consumed as a built tree2 `Complex`/`SelectorList`/`Compound` child when the
 * selector family is registered, else re-derived from the raw source bytes (so
 * this family stands alone in the F0 seed). Body statements are the real tree2
 * child nodes (placeholders / leaf tokens filtered out).
 */
import * as t2 from '../../tree2/index.js';
import {
  type BuildAction,
  type BuildArgs,
  isStatement,
  selectorText,
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

const ruleset: BuildAction = {
  type: 'Ruleset',
  build: (args) => t2.rule(ruleSelector(args), args.children.filter(isStatement) as t2.Statement[]),
};

export const RULESET_ACTIONS: readonly BuildAction[] = [stylesheet, ruleset];
