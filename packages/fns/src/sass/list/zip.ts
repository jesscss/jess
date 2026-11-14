import { groupItems, makeList, define, checkAny, type ValueGroup } from '@jesscss/core/value';

const zip = define('zip', {
  params: [{ name: 'lists', type: 'any', check: checkAny, rest: true }] as const,
  variadic: true,
  body: (args) => {
    const itemLists = args.map(groupItems);
    if (itemLists.length === 0) {
      return makeList([], ',');
    }
    const length = Math.min(...itemLists.map(items => items.length));
    const rows: ValueGroup[] = [];
    for (let index = 0; index < length; index += 1) {
      rows.push(itemLists.map(items => items[index]!));
    }
    return makeList(rows, ',');
  }
});

export default zip;
