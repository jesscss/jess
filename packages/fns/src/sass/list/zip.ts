import { defineFunction, makeList, coerceListItems } from '@jesscss/core/value';

const zip = defineFunction('zip', {
  params: [{ name: 'lists', kinds: 'any', rest: true }] as const,
  variadic: true,
  body: (args) => {
    const itemLists = args.value.map(coerceListItems);
    if (itemLists.length === 0) {
      return makeList([], ',');
    }
    const length = Math.min(...itemLists.map(items => items.length));
    const rows = [];
    for (let index = 0; index < length; index += 1) {
      rows.push(makeList(itemLists.map(items => items[index]!), ' '));
    }
    return makeList(rows, ',');
  }
});

export default zip;
