import { parse } from '@jesscss/css-parser/ast';

const result = parse('@charset "UTF-8"; .a { color: red }');
const charset = result.document?.children[0];
const declaration = result.document?.children[1]?.type === 'Rule'
  ? result.document.children[1].body[0]
  : undefined;
if (
  result.document?.type !== 'Root'
  || result.errors.length !== 0
  || charset?.type !== 'AtRuleStatement'
  || charset.name !== '@charset'
  || charset.prelude?.type !== 'Quoted'
  || charset.prelude.value !== 'UTF-8'
  || declaration?.type !== 'Declaration'
  || declaration.value.type !== 'Keyword'
  || declaration.value.src !== 'red'
) {
  throw new Error('The public @jesscss/css-parser/ast export did not return the direct declaration and @charset AST contract.');
}
