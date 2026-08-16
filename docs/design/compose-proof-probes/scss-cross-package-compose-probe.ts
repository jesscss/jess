/**
 * COMPOSE PROOF — cross-package inheritance probe (throwaway).
 *
 * The prior proof concluded a real family "cannot even macro-fuse" over a CSS
 * base, because it built a THIN base that left `CompoundSelector` a HOLE. This
 * probe is the counter-demonstration: a dialect delta in ANOTHER package
 * (`scss-parser`) composes onto `cssBaseRules` — CSS's WHOLE hole-free grammar —
 * overrides exactly ONE leaf rule (`BasicSelector`) and INHERITS the entire
 * selector subtree (`CompoundSelector`, `ComplexSelector`, `SelectorList`,
 * `Stylesheet`, `Value`, …) from the base by name. Open-recursive override
 * re-points the base's own `CompoundSelector` at this delta's `BasicSelector`,
 * so the widened leaf takes effect through inherited parents that were never
 * redefined.
 *
 * It exercises all three analyzer lifts across a package boundary: an imported
 * builder (`simpleSelector`, `tokenText`), a block-statement reducer body, and
 * the free-binding provenance rescue the base itself relies on.
 */
import { choice, classifiedTrivia, compose, node, regex, rules } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import { cssBaseRules } from '@jesscss/css-parser/grammar';
import { simpleSelector, tokenText } from '@jesscss/core/ast';
import type { SimpleSelector } from '@jesscss/core/ast';

type ProbeInput = {
  readonly [K in keyof typeof cssBaseRules]: (typeof cssBaseRules)[K];
};

/*
 * The base selector leaf plus a placeholder form (`%name`). The placeholder is
 * a token CSS's `BasicSelector` does not accept — a genuine widening — so a
 * successful parse of `.a%ph > .b` proves the inherited `CompoundSelector` and
 * `ComplexSelector` routed through THIS override.
 */
const placeholderToken = regex(/%-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const basicSelectorToken = regex(/[.#]?-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|\*/);

const whitespaceRun = regex(/[ \t\n\r\f]+/);
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const whitespace = classifiedTrivia({
  whitespace: whitespaceRun,
  blockComment
});

const probeDelta = (_g: ProbeInput): { readonly BasicSelector: Combinator<SimpleSelector> } => {
  const BasicSelector = node<SimpleSelector>(
    'BasicSelector',
    choice(
      placeholderToken,
      basicSelectorToken
    ),
    children => {
      const text = tokenText(children[0]);
      return simpleSelector(text);
    }
  );
  return { BasicSelector };
};

export const probeGrammar = compose(
  [cssBaseRules, rules({ trivia: whitespace }, probeDelta)],
  { hostMode: 'ast' }
);
