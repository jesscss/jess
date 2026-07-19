import { parse } from '@jesscss/less-parser/ast';

const result = parse('@import "theme.less";');
if (result.document?.type !== 'Root' || result.document.children[0]?.type !== 'ImportAtRule' || result.errors.length !== 0) {
  throw new Error('The public @jesscss/less-parser/ast export did not return a parsed ImportAtRule Root.');
}
