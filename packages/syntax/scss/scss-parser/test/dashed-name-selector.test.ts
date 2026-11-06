import { fileURLToPath } from 'node:url';
import { parseWith, type ScssAstGrammar } from '../src/parse-with.js';
import { commentTriviaLabels } from '../src/trivia-labels.js';
import { describeDashedNames } from '../../../css/css-parser/test/dashed-name-selector.js';

describeDashedNames(
  'Scss',
  fileURLToPath(new URL('../lib', import.meta.url)),
  (grammar, source) => parseWith(grammar as ScssAstGrammar, source),
  commentTriviaLabels,
  [
    '.c { &--b { color: red; } }',
    '.c { &--b.d { color: red; } }',
    '.c { &--b &--d { color: red; } }',
    '.c { &:hover &--b { color: red; } }',
    '.c { @extend .--b; }'
  ]
);
