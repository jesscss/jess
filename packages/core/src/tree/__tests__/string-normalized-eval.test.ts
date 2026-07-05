import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import {
  Dimension,
  List,
  Negative,
  Operation,
  Paren,
  Url,
  dimension,
  keyword,
  list,
  num
} from '../index.js';

/**
 * String-normalization migration (LESS-INTEGRATION cluster A2): several former
 * Node wrappers now arrive as raw strings or raw space-group arrays. These
 * repros construct trees that hit the eval-side node-method-on-string crashes
 * and assert the string-terminal contract (a string is already-evaluated; a raw
 * array is a space `Sequence`).
 */
describe('string-normalized eval', () => {
  let context: Context;
  beforeEach(() => {
    context = new Context();
  });

  it('Url evaluates and renders a bare string value as a terminal', () => {
    // url.ts: `this.value.eval` crashed when the parser delivered a string path.
    const node = new Url('foo.png');
    const evald = node.eval(context);
    expect(evald).toBe(node);
    expect(node.render(context)).toBe('url(foo.png)');
    expect(node.valueOf()).toBe('foo.png');
  });

  it('List evaluates a raw space-group array item as a Sequence', () => {
    // evaluate-node-array.ts: a List value item that is a raw array (a space
    // group) is coerced to a space Sequence instead of `node.eval`-crashing.
    const node = new List([[dimension({ number: 2, unit: 'px' }), dimension({ number: 3, unit: 'px' })]] as never);
    const evald = node.eval(context) as List;
    expect(evald).toBeInstanceOf(List);
    // Eval materializes the coerced Sequence; render the evaluated node (the
    // real pipeline renders post-eval, not the raw-array source node).
    expect(evald.render(context)).toBe('2px 3px');
  });

  it('List coerces a bare numeric-unit string item to an operable Dimension', () => {
    // coerceStringTerminal: `1px` must become a Dimension (not a Keyword) so
    // math/rendering behave; a keyword operand triggered "Cannot operate on
    // Keyword".
    const node = new List(['1px'] as never);
    const evald = node.eval(context) as List;
    expect(evald.value[0]).toBeInstanceOf(Dimension);
    expect(evald.render(context)).toBe('1px');
  });

  it('Operation keeps string operands verbatim without attempting math', () => {
    // operation.ts: a `U+??????` unicode-range parses to an Operation with string
    // operands; `left.eval` crashed. String operands are final terminals.
    const node = new Operation(['U', '+', '??????']);
    const evald = node.eval(context);
    expect(evald).toBe(node);
    expect(node.render(context)).toBe('U+??????');
  });

  it('Paren normalizes a raw space-group array value', () => {
    // paren.ts: `currentValue.eval` crashed on a raw array value (with an empty
    // string spacing placeholder). It is coerced to a node in the constructor.
    const node = new Paren(['', num(1)] as never);
    expect(node.value).toBeInstanceOf(Dimension);
    const evald = node.eval(context);
    expect(evald).toBeInstanceOf(Dimension);
  });

  it('Negative normalizes a raw array value to a node', () => {
    // negative.ts: a raw-array value crashed at eval (`this.value.hasFlag`).
    const node = new Negative([num(5)] as never);
    expect(node.value).toBeInstanceOf(Dimension);
    expect(node.render(context)).toBe('-5');
  });

  it('Operation recasts a numeric-text Keyword operand so math applies', () => {
    // operation.ts recastNumericOperand: the parser can deliver `1px` as a
    // Keyword; recast to a Dimension so `1px * 5` yields `5px` instead of
    // throwing "Cannot operate on Keyword".
    context.opts.unitMode = 'preserve';
    const node = list([new Operation([keyword('1px'), '*', num(5)])]);
    expect(node.render(context)).toBe('5px');
  });

  it('Operation performs math on coerced numeric-string operands via a List', () => {
    // End-to-end: a List holding a `1px` string and a `* 5` operation renders
    // through math without a "Cannot operate on Keyword" crash.
    const node = list([new Operation([dimension({ number: 1, unit: 'px' }), '*', num(5)])]);
    context.opts.unitMode = 'preserve';
    expect(node.render(context)).toBe('5px');
  });
});
