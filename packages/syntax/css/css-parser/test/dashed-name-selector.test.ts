import { fileURLToPath } from 'node:url';
import { parseWith, type CssAstGrammar } from '../src/parse-with.js';
import { commentTriviaLabels } from '../src/trivia-labels.js';
import { describeDashedNames } from './dashed-name-selector.js';

describeDashedNames(
  'CSS',
  fileURLToPath(new URL('../lib', import.meta.url)),
  (grammar, source) => parseWith(grammar as CssAstGrammar, source),
  commentTriviaLabels
);
