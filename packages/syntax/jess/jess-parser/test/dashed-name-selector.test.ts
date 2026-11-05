import { fileURLToPath } from 'node:url';
import { parseWith, type JessAstGrammar } from '../src/parse-with.js';
import { commentTriviaLabels } from '../src/trivia-labels.js';
import { describeDashedNames } from '../../../css/css-parser/test/dashed-name-selector.js';

describeDashedNames(
  'Jess',
  fileURLToPath(new URL('../lib', import.meta.url)),
  (grammar, source) => parseWith(grammar as JessAstGrammar, source),
  commentTriviaLabels
);
