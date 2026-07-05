import { describe, expect, it } from 'vitest';
import { any, vardecl } from '../../index.js';
import type { List } from '../../list.js';
import type { Node } from '../../node.js';
import { getBindingCellValue } from '../../scope-frame.js';
import { F_VISIBLE } from '../../node.js';
import { Sequence } from '../../sequence.js';
import { createCallableLiveSlots } from '../callable-live-slots.js';

describe('callable live slot helper', () => {
  it('marks var declaration bindings as param vars and creates live slots', () => {
    const sourceNode = vardecl({ name: 'value', value: any('red') });
    sourceNode.addFlag(F_VISIBLE);

    const liveSlots = createCallableLiveSlots({
      paramBindings: [{
        name: 'value',
        value: any('blue'),
        sourceNode
      }],
      nodeArgs: []
    });

    expect(sourceNode.options?.paramVar).toBe(true);
    expect(sourceNode.hasFlag(F_VISIBLE)).toBe(false);
    expect(liveSlots.get('value')?.value?.valueOf()).toBe('blue');
  });

  it('prepares @arguments lazily from current live slot values', () => {
    const valueBinding = {
      name: 'value',
      value: any('blue')
    };
    const restBinding = {
      name: 'rest',
      prepareValue: () => new Sequence([any('one'), any('two')])
    };

    const liveSlots = createCallableLiveSlots({
      paramBindings: [valueBinding, restBinding],
      nodeArgs: [any('fallback')],
      defineArguments: true
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const argumentsValue = getBindingCellValue(liveSlots.get('arguments')!) as unknown as List<Node>;

    expect(argumentsValue.value.map((node: any) => node.valueOf())).toEqual(['blue', 'one', 'two']);
  });

  it('falls back to node args when no param bindings exist', () => {
    const liveSlots = createCallableLiveSlots({
      paramBindings: [],
      nodeArgs: [any('left'), new Sequence([any('middle'), any('right')])],
      defineArguments: true
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const argumentsValue = getBindingCellValue(liveSlots.get('arguments')!) as unknown as List<Node>;

    expect(argumentsValue.value.map((node: any) => node.valueOf())).toEqual(['left', 'middle', 'right']);
  });
});
