import { setSourceSpan, sourceSpanOf } from '../util/provenance.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, comment, decl, el, rules, ruleset, sel, vardecl } from '../index.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';
import { createTriviaMap, makeTrivia } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';

// A trivia run is now a source range; build one whose text is exactly `text`.
const run = (text: string) => makeTrivia(text, 0, text.length);

class CountingWriter extends OutputWriter {
  marks = 0;
  reads = 0;

  override mark(): number {
    this.marks++;
    return super.mark();
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

describe('Comment', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders block comment syntax through toTrimmedString()', () => {
    expect(comment('/* keep me */').toTrimmedString()).toBe('/* keep me */');
  });

  it('returns block comment syntax without writer readback', () => {
    const writer = new CountingWriter();

    expect(comment('/* keep me */').toTrimmedString({ writer })).toBe('/* keep me */');
    expect(writer.toString()).toBe('/* keep me */');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('renders visible block comments through render(context)', () => {
    const node = comment('/* keep me */');

    expect(node.render(context)).toBe('/* keep me */');
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders visible block comments without writer readback', () => {
    const writer = new CountingWriter();

    expect(comment('/* keep me */').render(context, { writer })).toBe('/* keep me */');
    expect(writer.toString()).toBe('/* keep me */');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('writes visible comment render output into flat buffers', async () => {
    const buffer = createRenderBuffer('flat');
    const node = comment('/* keep me */');
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node;
    };

    expect(await node.render(context, buffer)).toBe('/* keep me */');
    expect(buffer.parts).toEqual(['/* keep me */']);
    expect(resolveCalls).toBe(0);
  });

  it('keeps source-only line comments out of render buffers unless full render is enabled', () => {
    const hiddenBuffer = createRenderBuffer('flat');
    const fullBuffer = createRenderBuffer('flat');
    const hidden = comment('// source-only', { lineComment: true });
    const full = comment('// source-only', { lineComment: true });
    full.fullRender = true;

    expect(hidden.render(context, hiddenBuffer)).toBe('');
    expect(hiddenBuffer.parts).toEqual([]);
    expect(full.render(context, fullBuffer)).toBe('// source-only');
    expect(fullBuffer.parts).toEqual(['// source-only']);
  });

  it('preserves printable block trivia before invisible nodes', () => {
    const hidden = vardecl({ name: 'tone', value: any('red') });
    setSourceSpan(hidden, { start: 100, end: 110 });
    const visible = ruleset({
      selector: sel([el('.a')]),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });
    setSourceSpan(visible, { start: 120, end: 136 });
    const trivia = createTriviaMap({
      before: new Map([
        [sourceSpanOf(hidden)?.start, run('// source-only\n/*\n\n    Comment\n\n*/\n\n/*\n * Keep indent\n */\n')]
      ]),
      after: new Map()
    });

    expect(rules([hidden, visible]).toString({ context, trivia })).toBe(`/*

    Comment

*/
/*
 * Keep indent
 */
.a {
  color: red;
}
`);
  });

  it('preserves printable block trivia before visible rulesets', () => {
    const visible = ruleset({
      selector: sel([el('.a')]),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });
    setSourceSpan(visible, { start: 100, end: 116 });
    setSourceSpan(visible.selector, sourceSpanOf(visible));
    const trivia = createTriviaMap({
      before: new Map([
        [sourceSpanOf(visible)?.start, run('/* Colors\n * ------\n */\n')]
      ]),
      after: new Map()
    });

    expect(rules([visible]).toString({ context, trivia })).toBe(`/* Colors
 * ------
 */
.a {
  color: red;
}
`);
  });

  it('keeps block trivia from hidden nodes on its own line', () => {
    const hidden = vardecl({ name: 'void-result', value: any('') });
    setSourceSpan(hidden, { start: 100, end: 110 });
    const visible = decl({ name: 'color', value: any('green') });
    setSourceSpan(visible, { start: 140, end: 152 });
    const container = ruleset({
      selector: sel([el('.a')]),
      rules: [hidden, visible]
    });
    setSourceSpan(container, { start: 90, end: 160 });
    const hiddenPost = run(' /* results in void */\n\n  ');
    const trivia = createTriviaMap({
      before: new Map([
        [sourceSpanOf(visible)?.start, hiddenPost]
      ]),
      after: new Map([
        [sourceSpanOf(hidden)?.end, hiddenPost]
      ])
    });

    expect(rules([container]).toString({ context, trivia })).toBe(`.a {
  /* results in void */
  color: green;
}
`);
  });

  it('uses context-owned trivia for cloned nodes with source offsets', async () => {
    const empty = rules([]);
    setSourceSpan(empty, { start: 100, end: 100 });
    const visible = decl({ name: 'color', value: any('red') });
    setSourceSpan(visible, { start: 120, end: 130 });
    const container = ruleset({
      selector: sel([el('.a')]),
      rules: [empty, visible]
    });
    const trivia = createTriviaMap({
      before: new Map([
        [sourceSpanOf(empty)?.start, run('/**/')]
      ]),
      after: new Map()
    });
    context.opts.trivia = trivia;

    expect(await renderNodeToString(rules([container]), context, { context })).toBe(`.a {
  /**/
  color: red;
}
`);
  });

  it('preserves printable block trivia after visible rulesets', () => {
    const visible = ruleset({
      selector: sel([el('.a')]),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });
    setSourceSpan(visible, { start: 100, end: 116 });
    const tokens = run('\n/*comment on last line*/\n');
    const trivia = createTriviaMap({
      before: new Map([[Infinity, tokens]]),
      after: new Map([
        [sourceSpanOf(visible)?.end, tokens]
      ])
    });

    expect(rules([visible]).toString({ context, trivia })).toBe(`.a {
  color: red;
}
/*comment on last line*/
`);
  });

  it('resolves comments without touching render state', async () => {
    const node = comment('/* keep me */');

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('/* keep me */');
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
