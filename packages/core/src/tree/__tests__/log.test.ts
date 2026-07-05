import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Log, Any, Quoted, Nil } from '../index.js';
import { Context } from '../../context.js';
import { logger } from '../../logger.js';
import { createRenderBuffer, renderNodeToBuffer } from '../util/render-buffer.js';

describe('Log node', () => {
  let context: Context;
  let originalLog: typeof logger.log;
  let originalWarn: typeof logger.warn;
  let originalError: typeof logger.error;

  beforeEach(() => {
    context = new Context();
    // Save original logger methods
    originalLog = logger.log;
    originalWarn = logger.warn;
    originalError = logger.error;
  });

  afterEach(() => {
    // Restore original logger methods
    logger.log = originalLog;
    logger.warn = originalWarn;
    logger.error = originalError;
  });

  it('should call logger.log for @debug and return Nil', async () => {
    const logSpy = vi.fn();
    logger.log = logSpy;

    const message = new Quoted('Debug message');
    const logNode = new Log({ level: 'debug', message });

    const result = await logNode.evalNode(context);

    // Quoted nodes include quotes in their string representation
    expect(logSpy).toHaveBeenCalledWith('"Debug message"');
    expect(result).toBeInstanceOf(Nil);
  });

  it('should call logger.warn for @warn and return Nil', async () => {
    const warnSpy = vi.fn();
    logger.warn = warnSpy;

    const message = new Quoted('Warning message');
    const logNode = new Log({ level: 'warn', message });

    const result = await logNode.evalNode(context);

    // Quoted nodes include quotes in their string representation
    expect(warnSpy).toHaveBeenCalledWith('"Warning message"');
    expect(result).toBeInstanceOf(Nil);
  });

  it('should call logger.error for @error and return Nil', async () => {
    const errorSpy = vi.fn();
    logger.error = errorSpy;

    const message = new Quoted('Error message');
    const logNode = new Log({ level: 'error', message });

    const result = await logNode.evalNode(context);

    // Quoted nodes include quotes in their string representation
    expect(errorSpy).toHaveBeenCalledWith('"Error message"');
    expect(result).toBeInstanceOf(Nil);
  });

  it('should evaluate message expression before logging', async () => {
    const logSpy = vi.fn();
    logger.log = logSpy;

    // Use a simple Any node as message
    const message = new Any('test message');
    const logNode = new Log({ level: 'debug', message });

    const result = await logNode.evalNode(context);

    // The logger should receive the evaluated value
    expect(logSpy).toHaveBeenCalledWith('test message');
    expect(result).toBeInstanceOf(Nil);
  });

  it('keeps source serializers empty for invisible log nodes', () => {
    const logNode = new Log({
      level: 'debug',
      message: new Quoted('Debug message')
    });

    expect(logNode.toTrimmedString()).toBe('');
    expect(logNode.toString()).toBe('');
  });

  it('resolves log nodes without touching render state', async () => {
    const logSpy = vi.fn();
    logger.log = logSpy;
    const logNode = new Log({
      level: 'debug',
      message: new Any('test message')
    });

    const resolved = await logNode.resolve(context);

    expect(logSpy).toHaveBeenCalledWith('test message');
    expect(resolved).toBeInstanceOf(Nil);
    expect(logNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('writes no CSS for log buffers while evaluating without public resolve', async () => {
    const logSpy = vi.fn();
    logger.log = logSpy;
    const buffer = createRenderBuffer('flat');
    const logNode = new Log({
      level: 'debug',
      message: new Any('buffer message')
    });
    logNode.resolve = () => {
      throw new Error('Log buffer render should use evalNode');
    };

    await expect(Promise.resolve(renderNodeToBuffer(logNode, context, buffer))).resolves.toBe('');

    expect(logSpy).toHaveBeenCalledWith('buffer message');
    expect(buffer.parts).toEqual([]);
  });

  it('renders log side effects without calling public evalNode()', async () => {
    const logSpy = vi.fn();
    logger.log = logSpy;
    const logNode = new Log({
      level: 'debug',
      message: new Any('direct message')
    });
    logNode.evalNode = () => {
      throw new Error('Log.render should run the invisible effect directly');
    };

    await expect(Promise.resolve(logNode.render(context))).resolves.toBe('');

    expect(logSpy).toHaveBeenCalledWith('direct message');
    expect(logNode.registrationPrepared).toBe(false);
  });

  it('writes async log side effects into buffers without calling public evalNode()', async () => {
    const warnSpy = vi.fn();
    logger.warn = warnSpy;
    const buffer = createRenderBuffer('flat');
    const message = new Any('async direct message');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    message.eval = (() => Promise.resolve(new Any('async direct message'))) as unknown as typeof message.eval;
    const logNode = new Log({
      level: 'warn',
      message
    });
    logNode.evalNode = () => {
      throw new Error('Log buffer render should run the invisible effect directly');
    };

    await expect(Promise.resolve(logNode.render(context, buffer))).resolves.toBe('');

    expect(warnSpy).toHaveBeenCalledWith('async direct message');
    expect(buffer.parts).toEqual([]);
    expect(logNode.registrationPrepared).toBe(false);
  });
});
