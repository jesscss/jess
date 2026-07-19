import { parse } from '@jesscss/css-parser/ast';

const result = parse('.a {}');
if (result.document?.type !== 'Root' || result.errors.length !== 0) {
  throw new Error('The public @jesscss/css-parser/ast export did not return a parsed Root.');
}
