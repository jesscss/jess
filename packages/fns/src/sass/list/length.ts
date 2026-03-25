import { defineFunction, Node, Dimension } from '@jesscss/core';
import lessLength from '../../less/length.js';

const length = defineFunction(
  'length',
  function(list: Node): Dimension {
    return lessLength(list);
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

export default length;
