import { describe, expect, it } from 'vitest';
import {
  addExtendRecord,
  createRenderBuffer,
  finalizeRenderBuffer,
  pushRenderSegment,
  writeRenderText,
  type HoistBlock,
  type MergeSlot,
  type PendingRefSlot,
  type RulesetBlock,
  type SegmentFinalizers,
  type SelectorRef
} from '../render-buffer.js';

const selector = (text: string): SelectorRef => ({
  valueOf: () => text
});

const finalizers: SegmentFinalizers = {
  ruleset: (block, children) => `${block.selector.valueOf()} {${children(block.body)}}`,
  hoist: (block, children) => `${block.atRule} {${children(block.body)}}`,
  merge: (slot, children) => children(slot.segments).split(slot.separator).join(slot.separator),
  pendingRef: (slot, children) => children(slot.segments)
};

describe('RenderBuffer', () => {
  it('keeps flat mode as plain string parts', () => {
    const buffer = createRenderBuffer('flat');

    writeRenderText(buffer, '.a');
    writeRenderText(buffer, ' { color: red; }');

    expect(buffer.parts).toEqual(['.a', ' { color: red; }']);
    expect(finalizeRenderBuffer(buffer, finalizers)).toBe('.a { color: red; }');
  });

  it('stores strings directly inside segmented children', () => {
    const buffer = createRenderBuffer('segmented');
    const block: RulesetBlock = {
      kind: 'ruleset',
      selector: selector('.a'),
      body: ['color: red;', '\nbackground: blue;'],
      isReference: false
    };

    pushRenderSegment(buffer, block);

    expect(block.body.every(item => typeof item === 'string')).toBe(true);
    expect(finalizeRenderBuffer(buffer, finalizers)).toBe('.a {color: red;\nbackground: blue;}');
  });

  it('recurses through only the delayed wrapper state', () => {
    const buffer = createRenderBuffer('segmented');
    const hoist: HoistBlock = {
      kind: 'hoist',
      atRule: '@media screen',
      body: [
        {
          kind: 'ruleset',
          selector: selector('.a'),
          body: ['color: red;'],
          isReference: false
        }
      ]
    };
    const merge: MergeSlot = {
      kind: 'merge',
      property: 'box-shadow',
      separator: ',',
      segments: ['0 0 red', ',', '0 0 blue']
    };
    const pending: PendingRefSlot = {
      kind: 'pending-ref',
      key: '@color',
      segments: ['color: red;']
    };

    pushRenderSegment(buffer, hoist);
    writeRenderText(buffer, '\n');
    pushRenderSegment(buffer, merge);
    writeRenderText(buffer, '\n');
    pushRenderSegment(buffer, pending);

    expect(finalizeRenderBuffer(buffer, finalizers)).toBe(
      '@media screen {.a {color: red;}}\n0 0 red,0 0 blue\ncolor: red;'
    );
  });

  it('tracks extend records as a side table', () => {
    const buffer = createRenderBuffer('segmented');
    const sourceBlock: RulesetBlock = {
      kind: 'ruleset',
      selector: selector('.source'),
      body: ['color: red;'],
      isReference: false
    };

    pushRenderSegment(buffer, sourceBlock);
    addExtendRecord(buffer, {
      targetSelector: selector('.target'),
      sourceBlock
    });

    expect(buffer.extendRecords).toHaveLength(1);
    expect(buffer.extendRecords[0]?.sourceBlock).toBe(sourceBlock);
    expect(buffer.extendRecords[0]?.targetSelector.valueOf()).toBe('.target');
  });
});
