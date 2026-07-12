import { any, keyword, seq } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { OutputWriter, getPrintOptions } from '../util/print.js';

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

describe('Any and Keyword', () => {
  it('preserves parser tree context on Any and Keyword construction', () => {
    const treeContext = new TreeContext();
    const anyNode = any('foo', { role: 'ident' }, undefined, treeContext);
    const keywordNode = keyword('inherit', undefined, undefined, treeContext);

    expect(anyNode._treeContext).toBe(treeContext);
    expect(keywordNode._treeContext).toBe(treeContext);
  });

  it('renders Any syntax through toTrimmedString()', () => {
    expect(any('foo').toTrimmedString()).toBe('foo');
  });

  it('writes Any syntax directly without public string transport', () => {
    const node = any('foo');
    const writer = new CountingWriter();
    let trimmedCalls = 0;
    node.toTrimmedString = () => {
      trimmedCalls++;
      return 'not-foo';
    };

    node.writeSyntax(getPrintOptions({ writer }));

    expect(writer.toString()).toBe('foo');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(trimmedCalls).toBe(0);
  });

  it('renders Any values through render(context) and resolves without touching render state', async () => {
    const renderContext = new Context();
    const resolveContext = new Context();
    const node = any('foo');

    expect(node.render(renderContext)).toBe('foo');
    expect(node.registrationPrepared).toBe(false);

    const resolved = await node.resolve(resolveContext);
    expect(resolved.toTrimmedString()).toBe('foo');
    expect(node.registrationPrepared).toBe(false);
    expect(resolveContext.printState.writer).toBeUndefined();
  });

  it('writes Any render output into flat buffers', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = any('foo');
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node;
    };

    expect(await node.render(context, buffer)).toBe('foo');
    expect(buffer.parts).toEqual(['foo']);
    expect(resolveCalls).toBe(0);
  });

  it('renders Any and Keyword values without writer mark/readback', () => {
    const context = new Context();
    const writer = new CountingWriter();
    const buffer = createRenderBuffer('flat');

    expect(any('foo').render(context, { writer })).toBe('foo');
    expect(writer.toString()).toBe('foo');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(keyword('inherit').render(context, buffer, { writer })).toBe('inherit');
    expect(buffer.parts).toEqual(['inherit']);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('renders custom-property Any values from source without result inheritance', async () => {
    const context = new Context();
    const node = any('var(--tone)', { role: 'customprop' });
    const originalLocation = [4, 1, 5, 15, 1, 16] as const;
    node._location = [...originalLocation];
    node.resolve = () => {
      throw new Error('Any.render should not resolve static custom property fragments');
    };

    expect(node.render(context)).toBe('var(--tone)');
    expect(node.location).toEqual([...originalLocation]);
    expect(node.sourceNode ?? node).toBe(node);
  });

  it('renders Keyword syntax through toTrimmedString()', () => {
    expect(keyword('inherit').toTrimmedString()).toBe('inherit');
  });

  it('renders Keyword values through render(context) and resolves without touching render state', async () => {
    const renderContext = new Context();
    const resolveContext = new Context();
    const node = keyword('inherit');

    expect(node.render(renderContext)).toBe('inherit');
    expect(node.registrationPrepared).toBe(false);

    const resolved = await node.resolve(resolveContext);
    expect(resolved.toTrimmedString()).toBe('inherit');
    expect(node.registrationPrepared).toBe(false);
    expect(resolveContext.printState.writer).toBeUndefined();
  });

  it('compares fallback text without public string transport for the left Any node', () => {
    const node = any('foo');
    let stringCalls = 0;
    node.toString = () => {
      stringCalls++;
      return 'not-foo';
    };

    expect(node.compare(seq([any('foo')]))).toBe(0);
    expect(stringCalls).toBe(0);
  });
});
