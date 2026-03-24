/**
 * Sass list.separator() function
 *
 * Returns the separator of a list as a string: "comma", "space", or "slash".
 *
 * @example
 * separator(1, 2, 3) // "comma"
 * separator(1 2 3) // "space"
 * separator(1 / 2 / 3) // "slash"
 */
import { defineFunction, Node, Quoted } from '@jesscss/core';
import { getListSeparator } from '@jesscss/core/tree/util/list-like';

const separator = defineFunction(
  'separator',
  function(list: Node): Quoted {
    const sep = getListSeparator(list);
    // Map Jess separator to Sass separator string
    let separatorStr: string;
    if (sep === ',') {
      separatorStr = 'comma';
    } else if (sep === '/') {
      separatorStr = 'slash';
    } else {
      // Default to space (or undefined/; means space in Sass)
      separatorStr = 'space';
    }
    return new Quoted(separatorStr, { quote: undefined }); // Unquoted string
  },
  {
    params: [
      {
        name: 'list',
        type: Node
      }
    ]
  }
);

export default separator;
