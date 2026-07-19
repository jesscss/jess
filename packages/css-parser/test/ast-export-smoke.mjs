import { parse } from '@jesscss/css-parser/ast';

const result = parse('@charset "UTF-8"; @media screen { .a { color: red; width: 12px } }');
const charset = result.document?.children[0];
const media = result.document?.children[1];
const declaration = media?.type === 'AtRuleBlock' && media.body[0]?.type === 'Rule'
  ? media.body[0].body[0]
  : undefined;
const dimension = media?.type === 'AtRuleBlock' && media.body[0]?.type === 'Rule'
  ? media.body[0].body[1]
  : undefined;
if (
  result.document?.type !== 'Root'
  || result.errors.length !== 0
  || charset?.type !== 'AtRuleStatement'
  || charset.name !== '@charset'
  || charset.prelude?.type !== 'Quoted'
  || charset.prelude.value !== 'UTF-8'
  || media?.type !== 'AtRuleBlock'
  || media.name !== '@media'
  || media.prelude?.type !== 'Keyword'
  || media.prelude.src !== 'screen'
  || declaration?.type !== 'Declaration'
  || declaration.value.type !== 'Keyword'
  || declaration.value.src !== 'red'
  || dimension?.type !== 'Declaration'
  || dimension.value.type !== 'Dimension'
  || dimension.value.number !== 12
  || dimension.value.unit !== 'px'
  || dimension.value.src !== '12px'
) {
  throw new Error('The public @jesscss/css-parser/ast export did not return the direct declaration, dimension, @charset, and @media AST contract.');
}
