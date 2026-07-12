import { describe, expect, it } from 'vitest';
import { ExtendFlag, el, extend } from '../index.js';
import { OutputWriter } from '../util/print.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

describe('Extend', () => {
  it('streams source and target selectors without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = extend({
      selector: el('.source'),
      target: el('.target'),
      flag: ExtendFlag.Exact
    });

    expect(node.toTrimmedString({ writer })).toBe('$extend .source -> .target !exact;');
    expect(writer.captures).toBe(0);
  });
});
