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
import { defineFunction, List, Quoted } from '@jesscss/core';

const separator = defineFunction(
  'separator',
  function(list: List): Quoted {
    const sep = list.options?.sep;
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
        type: List
      }
    ]
  }
);

export default separator;
