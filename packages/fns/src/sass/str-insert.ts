/**
 * Sass str-insert() function (deprecated, use string.insert() instead)
 *
 * Inserts a string into another string at a specific index (1-based).
 *
 * @example
 * str-insert("Hello", "X", 3) // "HeXllo"
 */
import { defineFunction, Quoted, Dimension } from '@jesscss/core';
import { toNumber } from '@jesscss/core';

const strInsert = defineFunction(
  'str-insert',
  function(string: Quoted, insert: Quoted, index: Dimension): Quoted {
    const strValue = String(typeof string.value === 'string' ? string.value : string.valueOf());
    const insertValue = String(typeof insert.value === 'string' ? insert.value : insert.valueOf());
    const indexValue = toNumber()(index) as number;
    const indexInt = Math.floor(indexValue);

    // Sass uses 1-based indexing
    // str-insert guarantees that $insert is at $index in the result
    // For negative: adjust index first, then convert to codepoint index
    let adjustedIndex: number;
    if (indexInt < 0) {
      // +1 because negative indexes start counting from -1 rather than 0
      // +1 more because we want to insert *after* that index
      adjustedIndex = Math.max(strValue.length + indexInt + 2, 0);
    } else {
      adjustedIndex = indexInt;
    }

    // Convert to 0-based codepoint index using _codepointForIndex logic
    let insertPos: number;
    if (adjustedIndex === 0) {
      insertPos = 0;
    } else if (adjustedIndex > 0) {
      insertPos = Math.min(adjustedIndex - 1, strValue.length);
    } else {
      insertPos = 0;
    }

    // Clamp to valid range
    insertPos = Math.max(0, Math.min(insertPos, strValue.length));

    const result = strValue.slice(0, insertPos) + insertValue + strValue.slice(insertPos);
    return new Quoted(result, string.options);
  },
  {
    params: [
      {
        name: 'string',
        type: Quoted
      },
      {
        name: 'insert',
        type: Quoted
      },
      {
        name: 'index',
        type: Dimension,
        convert: [toNumber()]
      }
    ]
  }
);

export default strInsert;
