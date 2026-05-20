import { any, keyword } from '../index.js';
import { Context } from '../../context.js';
import { createRenderBuffer } from '../util/render-buffer.js';

describe('Any and Keyword', () => {
  it('renders Any syntax through toTrimmedString()', () => {
    expect(any('foo').toTrimmedString()).toBe('foo');
  });

  it('renders Any values through render(context) and resolves without touching render state', async () => {
    const renderContext = new Context();
    const resolveContext = new Context();
    const node = any('foo');

    expect(node.render(renderContext)).toBe('foo');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);

    const resolved = await node.resolve(resolveContext);
    expect(resolved.toTrimmedString()).toBe('foo');
    expect(node.evaluated).toBe(false);
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

  it('renders Keyword syntax through toTrimmedString()', () => {
    expect(keyword('inherit').toTrimmedString()).toBe('inherit');
  });

  it('renders Keyword values through render(context) and resolves without touching render state', async () => {
    const renderContext = new Context();
    const resolveContext = new Context();
    const node = keyword('inherit');

    expect(node.render(renderContext)).toBe('inherit');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);

    const resolved = await node.resolve(resolveContext);
    expect(resolved.toTrimmedString()).toBe('inherit');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(resolveContext.printState.writer).toBeUndefined();
  });
});
