import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { OutputWriter, getPrintOptions } from '../print.js';
import {
  addExtendRecord,
  createHoistBlock,
  createMergeSlot,
  createPendingRefSlot,
  createRenderBuffer,
  createRenderBufferForFlags,
  finalizeFlatRenderBuffer,
  createRulesetBlock,
  createSegmentBody,
  finalizeRenderBuffer,
  isRenderBuffer,
  pushRenderSegment,
  renderSourceOutput,
  writeSegmentText,
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

    expect(writeRenderText(buffer, '.a')).toBe('.a');
    expect(writeRenderText(buffer, ' { color: red; }')).toBe(' { color: red; }');

    expect(buffer.parts).toEqual(['.a', ' { color: red; }']);
    expect(finalizeRenderBuffer(buffer, finalizers)).toBe('.a { color: red; }');
    expect(finalizeFlatRenderBuffer(buffer)).toBe('.a { color: red; }');
  });

  it('renders source output through isolated buffer print state', () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const writer = new OutputWriter();
    const source = {
      toTrimmedString(options?: Parameters<typeof getPrintOptions>[0]) {
        getPrintOptions(options).writer.add('source-output');
        return 'source-output';
      }
    };

    expect(renderSourceOutput(context, source, { writer })).toBe('source-output');
    expect(writer.toString()).toBe('source-output');

    const bufferWriter = new OutputWriter();
    expect(renderSourceOutput(context, source, buffer, { writer: bufferWriter })).toBe('source-output');
    expect(buffer.parts).toEqual(['source-output']);
    expect(bufferWriter.toString()).toBe('');
  });

  it('chooses flat mode until delayed finalization is needed', () => {
    expect(createRenderBufferForFlags({}).kind).toBe('flat');
    expect(createRenderBufferForFlags({ hasExtends: false, hasReferenceImports: false }).kind).toBe('flat');
    expect(createRenderBufferForFlags({ hasExtends: true }).kind).toBe('segmented');
    expect(createRenderBufferForFlags({ hasReferenceImports: true }).kind).toBe('segmented');
    expect(createRenderBufferForFlags({ hasHoists: true }).kind).toBe('segmented');
    expect(createRenderBufferForFlags({ hasMerges: true }).kind).toBe('segmented');
    expect(createRenderBufferForFlags({ hasPendingRefs: true }).kind).toBe('segmented');
  });

  it('recognizes render buffer objects', () => {
    expect(isRenderBuffer(createRenderBuffer('flat'))).toBe(true);
    expect(isRenderBuffer(createRenderBuffer('segmented'))).toBe(true);
    expect(isRenderBuffer({ kind: 'other' })).toBe(false);
    expect(isRenderBuffer(null)).toBe(false);
  });

  it('stores strings directly inside segmented children', () => {
    const buffer = createRenderBuffer('segmented');
    const body = createSegmentBody();
    writeSegmentText(body, 'color: red;');
    writeSegmentText(body, '\nbackground: blue;');
    const block: RulesetBlock = createRulesetBlock({
      selector: selector('.a'),
      body,
      isReference: false
    });

    pushRenderSegment(buffer, block);

    expect(block.body.every(item => typeof item === 'string')).toBe(true);
    expect(finalizeRenderBuffer(buffer, finalizers)).toBe('.a {color: red;\nbackground: blue;}');
  });

  it('recurses through only the delayed wrapper state', () => {
    const buffer = createRenderBuffer('segmented');
    const hoist: HoistBlock = createHoistBlock({
      atRule: '@media screen',
      body: [
        createRulesetBlock({
          selector: selector('.a'),
          body: ['color: red;'],
          isReference: false
        })
      ]
    });
    const merge: MergeSlot = createMergeSlot({
      property: 'box-shadow',
      separator: ',',
      segments: ['0 0 red', ',', '0 0 blue']
    });
    const pending: PendingRefSlot = createPendingRefSlot({
      key: '@color',
      segments: ['color: red;']
    });

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
