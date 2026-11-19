/**
 * A Less block statement that reads as a declaration up to a token no
 * declaration ends at, then runs into a block: `a: selector(1px) { … }`. In a
 * block, a statement that is not a declaration and runs into `{…}` is a rule
 * (css-syntax-3 §5.5.5, §5.5.6; css-nesting-1 §3.1), so it parses, its prelude in one
 * simple selector and the error at it (ledger P45).
 */
import { RulePreludeRest, rule, sourceStartOf, unreadableRulePrelude, withBlockBody } from '@jesscss/core/ast';
import type { Declaration, ExtendInstruction, Ruleset, Statement } from '@jesscss/core/ast';
import { readBody, requireDeclaration } from './grammar-helpers.js';
import { reportRecovered } from './parse-state.js';

/** The block after the declaration: where the prelude ends, the state its error reports through, and the body. */
export class DeclarationPreludeBlock {
  readonly prelude: RulePreludeRest;
  readonly rules: Statement[];
  readonly extensions: readonly ExtendInstruction[];
  readonly rawChildren: readonly unknown[];

  constructor(prelude: RulePreludeRest, rules: Statement[], extensions: readonly ExtendInstruction[], rawChildren: readonly unknown[]) {
    this.prelude = prelude;
    this.rules = rules;
    this.extensions = extensions;
    this.rawChildren = rawChildren;
  }
}

/**
 * `DeclarationPreludeBlock`'s reduction: the prelude's rest when there is one,
 * `{`, the body, `}`. With no rest, the prelude ends at the `{`, where the node starts.
 */
export function declarationPreludeBlockFrom(children: readonly unknown[], rawChildren: readonly unknown[], start: number, state: unknown): DeclarationPreludeBlock {
  const rest = children[0];
  const rules: Statement[] = [];
  const extensions = readBody(children, 0, rules);
  return new DeclarationPreludeBlock(new RulePreludeRest(start, rest instanceof RulePreludeRest ? rest.end : start, state), rules, extensions, rawChildren);
}

/** A declaration item: the declaration, or, when a block follows it, the rule the block makes. */
export function declarationOrRuleFrom(children: readonly unknown[]): Declaration | Ruleset {
  const declaration = requireDeclaration(children[0]);
  const block = children[1];
  return block instanceof DeclarationPreludeBlock
    ? withBlockBody(rule(
        unreadableRulePrelude(block.prelude, sourceStartOf(declaration), reportRecovered),
        block.rules,
        block.extensions.length === 0 ? undefined : [...block.extensions]
      ), block.rawChildren)
    : declaration;
}
