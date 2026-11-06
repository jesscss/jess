import { fileURLToPath } from 'node:url';
import { parseWith, type LessAstGrammar } from '../src/parse-with.js';
import { commentTriviaLabels } from '../src/trivia-labels.js';
import { describeDashedNames } from '../../../css/css-parser/test/dashed-name-selector.js';

describeDashedNames(
  'Less',
  fileURLToPath(new URL('../lib', import.meta.url)),
  (grammar, source) => parseWith(grammar as LessAstGrammar, source),
  commentTriviaLabels,
  [
    '.--b() { color: red; }',
    '#--b() { color: red; }',
    '.--b() when (@a) { color: red; }',
    '.c { .--b(); }',
    '.c { .--b; }',
    '.c { #--b(); }',
    '.c { #ns > .--b(); }',
    '.c:extend(.--b) { color: red; }',
    '.c:extend(.--b all) { color: red; }',
    '.c { &:extend(.--b); }'
  ]
);
