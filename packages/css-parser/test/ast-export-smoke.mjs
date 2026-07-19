import { parse } from '@jesscss/css-parser/ast';

const result = parse('.a { color: red }');
const declaration = result.document?.children[0]?.type === 'Rule'
  ? result.document.children[0].body[0]
  : undefined;
if (
  result.document?.type !== 'Root'
  || result.errors.length !== 0
  || declaration?.type !== 'Declaration'
  || declaration.value.type !== 'Keyword'
  || declaration.value.src !== 'red'
) {
  throw new Error('The public @jesscss/css-parser/ast export did not return the direct declaration AST contract.');
}
