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
    hidden._location = [100, 1, 1, 110, 1, 11];
    const visible = ruleset({
      selector: sel([el('.a')]),
      rules: [
        decl({ name: any('color'), value: any('red') })
      ]
    });
    visible._location = [120, 8, 1, 136, 10, 1];
    const trivia = createTriviaMap({
      before: new Map([
        [hidden.location[0], run('// source-only\n/*\n\n    Comment\n\n*/\n\n/*\n * Keep indent\n */\n')]
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
        decl({ name: any('color'), value: any('red') })
      ]
    });
    visible._location = [100, 8, 1, 116, 10, 1];
    visible.selector._location = visible.location;
    const trivia = createTriviaMap({
      before: new Map([
        [visible.location[0], run('/* Colors\n * ------\n */\n')]
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
    hidden._location = [100, 1, 1, 110, 1, 11];
    const visible = decl({ name: any('color'), value: any('green') });
    visible._location = [140, 4, 3, 152, 4, 15];
    const container = ruleset({
      selector: sel([el('.a')]),
      rules: [hidden, visible]
    });
    container._location = [90, 1, 1, 160, 5, 1];
    const hiddenPost = run(' /* results in void */\n\n  ');
    const trivia = createTriviaMap({
      before: new Map([
        [visible.location[0], hiddenPost]
      ]),
      after: new Map([
        [hidden.location[3], hiddenPost]
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
    empty._location = [100, 1, 1, 100, 1, 1];
    const visible = decl({ name: any('color'), value: any('red') });
    visible._location = [120, 2, 3, 130, 2, 13];
    const container = ruleset({
      selector: sel([el('.a')]),
      rules: [empty, visible]
    });
    const trivia = createTriviaMap({
      before: new Map([
        [empty.location[0], run('/**/')]
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
        decl({ name: any('color'), value: any('red') })
      ]
    });
    visible._location = [100, 8, 1, 116, 10, 1];
    const tokens = run('\n/*comment on last line*/\n');
    const trivia = createTriviaMap({
      before: new Map([[Infinity, tokens]]),
      after: new Map([
        [visible.location[3], tokens]
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
