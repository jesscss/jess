import { RulePreludeRest, rule, sourceStartOf, unreadableRulePrelude, withBlockBody } from '@jesscss/core/ast';
import type { Declaration, ExtendInstruction, Ruleset, Statement } from '@jesscss/core/ast';
import { readBody, requireDeclaration } from './grammar-helpers.js';
import { reportRecovered } from './parse-state.js';

/** The block after the declaration: the prelude's rest, the body and its extends. */
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

/** `DeclarationPreludeBlock`'s reduction; with no rest, the prelude ends at the `{`. */
export function declarationPreludeBlockFrom(children: readonly unknown[], rawChildren: readonly unknown[], start: number, state: unknown): DeclarationPreludeBlock {
  const rest = children[0];
  const rules: Statement[] = [];
  const extensions = readBody(children, 0, rules);
  return new DeclarationPreludeBlock(new RulePreludeRest(start, rest instanceof RulePreludeRest ? rest.end : start, state), rules, extensions, rawChildren);
}

/** The declaration, or the rule the block after it makes. */
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
