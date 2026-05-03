import { any, keyword } from '../index.js';
import { Context } from '../../context.js';

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
    expect(node.preEvaluated).toBe(false);

    const resolved = await any('foo').resolve(resolveContext);
    expect(resolved.toTrimmedString()).toBe('foo');
    expect(resolveContext.printState.writer).toBeUndefined();
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
    expect(node.preEvaluated).toBe(false);

    const resolved = await keyword('inherit').resolve(resolveContext);
    expect(resolved.toTrimmedString()).toBe('inherit');
    expect(resolveContext.printState.writer).toBeUndefined();
  });
});
