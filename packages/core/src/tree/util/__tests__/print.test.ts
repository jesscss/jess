import { describe, it, expect, beforeEach } from 'vitest';
import { OutputWriter, getPrintOptions } from '../print.js';
import { any } from '../../../index.js';

describe('processPrePost with capture', () => {
  let w: OutputWriter;
  let options: ReturnType<typeof getPrintOptions>;

  beforeEach(() => {
    w = new OutputWriter();
    options = getPrintOptions({ writer: w });
  });

  it('processPrePost returns correct value for array with newline string', () => {
    const node = any('test');
    node.pre = ['\n  '];

    const result = node.processPrePost('pre', '', options);
    expect(result).toBe('\n  ');
  });

  it('capture properly captures output from processPrePost with array containing newline string', () => {
    const node = any('test');
    node.pre = ['\n  '];

    const captured = w.capture(() => {
      node.processPrePost('pre', '', options);
    });

    expect(captured).toBe('\n  ');
    expect(w.toString()).toBe('');
  });

  it('capture properly captures output from processPrePost with array containing multiple strings', () => {
    const node = any('test');
    node.pre = ['\n  ', '  more'];

    const captured = w.capture(() => {
      node.processPrePost('pre', '', options);
    });

    expect(captured).toBe('\n    more');
    expect(w.toString()).toBe('');
  });

  it('capture properly captures output from processPrePost with array containing single space string', () => {
    const node = any('test');
    node.pre = [' '];

    const captured = w.capture(() => {
      node.processPrePost('pre', '', options);
    });

    expect(captured).toBe(' ');
    expect(w.toString()).toBe('');
  });

  it('capture properly captures output from processPrePost with array containing empty string', () => {
    const node = any('test');
    node.pre = [''];

    const captured = w.capture(() => {
      node.processPrePost('pre', '', options);
    });

    expect(captured).toBe('');
    expect(w.toString()).toBe('');
  });

  it('capture properly captures output from processPrePost with array containing only newline', () => {
    const node = any('test');
    node.pre = ['\n'];

    const captured = w.capture(() => {
      node.processPrePost('pre', '', options);
    });

    expect(captured).toBe('\n');
    expect(w.toString()).toBe('');
  });

  it('capture properly captures output from processPrePost with array containing tab and spaces', () => {
    const node = any('test');
    node.pre = ['\n\t  '];

    const captured = w.capture(() => {
      node.processPrePost('pre', '', options);
    });

    expect(captured).toBe('\n\t  ');
    expect(w.toString()).toBe('');
  });

  it('capture properly captures output when processPrePost is called multiple times', () => {
    const node = any('test');
    node.pre = ['\n  '];

    const captured1 = w.capture(() => {
      node.processPrePost('pre', '', options);
    });

    const captured2 = w.capture(() => {
      node.processPrePost('pre', '', options);
    });

    expect(captured1).toBe('\n  ');
    expect(captured2).toBe('\n  ');
    expect(w.toString()).toBe('');
  });

  it('capture properly captures output when there is existing content in writer', () => {
    w.add('existing');
    const node = any('test');
    node.pre = ['\n  '];

    const captured = w.capture(() => {
      node.processPrePost('pre', '', options);
    });

    expect(captured).toBe('\n  ');
    expect(w.toString()).toBe('existing');
  });

  it('processPrePost with numeric value 1 returns single space', () => {
    const node = any('test');
    node.pre = 1;

    const result = node.processPrePost('pre', '', options);
    expect(result).toBe(' ');
  });

  it('capture properly captures output from processPrePost with numeric value 1', () => {
    const node = any('test');
    node.pre = 1;

    const captured = w.capture(() => {
      node.processPrePost('pre', '', options);
    });

    expect(captured).toBe(' ');
    expect(w.toString()).toBe('');
  });

  it('processPrePost with numeric value 0 returns empty string', () => {
    const node = any('test');
    node.pre = 0;

    const result = node.processPrePost('pre', '', options);
    expect(result).toBe('');
  });

  it('capture properly captures output from processPrePost with numeric value 0', () => {
    const node = any('test');
    node.pre = 0;

    const captured = w.capture(() => {
      node.processPrePost('pre', '', options);
    });

    expect(captured).toBe('');
    expect(w.toString()).toBe('');
  });

  it('processPrePost with string value returns that string', () => {
    const node = any('test');
    node.pre = '  ';

    const result = node.processPrePost('pre', '', options);
    expect(result).toBe('  ');
  });

  it('capture properly captures output from processPrePost with string value', () => {
    const node = any('test');
    node.pre = '  ';

    const captured = w.capture(() => {
      node.processPrePost('pre', '', options);
    });

    expect(captured).toBe('  ');
    expect(w.toString()).toBe('');
  });
});
