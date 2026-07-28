/**
 * Sass map.keys() function
 *
 * Returns a list of all keys in a map.
 *
 * @example
 * map.keys((a: 1, b: 2)) // a, b
 */
import { defineFunction, Collection, List, Node, Quoted, type Context } from '@jesscss/core';
import type { FunctionThis } from '@jesscss/core';
import { isNode, N } from '@jesscss/core';

const keys = defineFunction(
  'keys',
  function(this: FunctionThis | Context | undefined, map: Collection): List {
    /*
     * A Collection entry's name is either a plain string or an already-built
     * name node (`Any<'property'>` / `Interpolated<'property'>`). A node is the
     * key itself; a string becomes an unquoted `Quoted`.
     */
    const keyNodes: Node[] = [];
    for (const node of map.rules) {
      if (isNode(node, N.Declaration)) {
        const name = node.name;
        keyNodes.push(typeof name === 'string' ? new Quoted(name, { quote: undefined }) : name);
      }
    }
    return new List(keyNodes, { sep: ',' });
  },
  {
    params: [
      {
        name: 'map',
        type: Collection
      }
    ]
  }
);

export default keys;
