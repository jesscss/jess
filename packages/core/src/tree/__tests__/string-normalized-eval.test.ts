import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import {
  Dimension,
  List,
  Negative,
  Node,
  Operation,
  Paren,
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

  it('List evaluates a raw space-group array item as a Sequence', async () => {
    /*
     * evaluate-node-array.ts: a List value item that is a raw array (a space
     * group) is coerced to a space Sequence instead of `node.eval`-crashing.
     */
    const node = new List([[dimension({ number: 2, unit: 'px' }), dimension({ number: 3, unit: 'px' })]]);
    const evald = await node.eval(context);
    expect(evald).toBeInstanceOf(List);

    /*
     * Eval materializes the coerced Sequence; render the evaluated node (the
     * real pipeline renders post-eval, not the raw-array source node).
     */
    expect(evald.render(context)).toBe('2px 3px');
  });

  it('List coerces a bare numeric-unit string item to an operable Dimension', async () => {
    /*
     * coerceStringTerminal: `1px` must become a Dimension (not a Keyword) so
     * math/rendering behave; a keyword operand triggered "Cannot operate on
     * Keyword".
     */
    const node = new List(['1px']);
    const evald = await node.eval(context);
    expect(evald.value[0]).toBeInstanceOf(Dimension);
    expect(evald.render(context)).toBe('1px');
  });

  it('Operation keeps string operands verbatim without attempting math', () => {
    /*
     * operation.ts: a `U+??????` unicode-range parses to an Operation with string
     * operands; `left.eval` crashed. String operands are final terminals.
     */
    const node = new Operation(['U', '+', '??????']);
    const evald = node.eval(context);
    expect(evald).toBe(node);
    expect(node.render(context)).toBe('U+??????');
  });

  it('Paren normalizes a raw space-group array value', () => {
    /*
     * paren.ts: `currentValue.eval` crashed on a raw array value (with an empty
     * string spacing placeholder). It is coerced to a node in the constructor.
     */
    const node = new Paren(['', num(1)]);
    expect(node.value).toBeInstanceOf(Dimension);
    const evald = node.eval(context);
    expect(evald).toBeInstanceOf(Dimension);
  });

  it('Negative normalizes a raw array value to a node', () => {
    // negative.ts: a raw-array value crashed at eval (`this.value.hasFlag`).
    const node = new Negative([num(5)]);
    expect(node.value).toBeInstanceOf(Dimension);
    expect(node.render(context)).toBe('-5');
  });

  it('Negative normalizes a bare string operand to a node', () => {
    /*
     * negative.ts: the less parser can deliver `-color-accent` (from
     * `var(--color-accent)`) as a bare string operand. A string value crashed
     * eval at `this.value.hasFlag`. Coerce so `-` prepends and renders `--…`.
     */
    const node = new Negative('-color-accent');
    expect(node.value).toBeInstanceOf(Node);
    expect(node.render(context)).toBe('--color-accent');
  });

  it('List serializes a raw space-group array item via writeSyntax (no eval)', () => {
    /*
     * list.ts: the static-serialize path (`Paren` → `List.writeSyntax`) crashed
     * with `item.writeSyntax is not a function` when a value item was a raw
     * space-group array. The List ctor now normalizes items to nodes so the
     * unevaluated serialize path is node-only too.
     */
    const node = new Paren(new List([[dimension({ number: 40, unit: '%' }), keyword('relative')]]));

    // No crash: the array item is normalized to a space Sequence and written.
    expect(node.toString()).toBe('(40% relative)');
  });

  it('Operation recasts a numeric-text Keyword operand so math applies', () => {
    /*
     * operation.ts recastNumericOperand: the parser can deliver `1px` as a
     * Keyword; recast to a Dimension so `1px * 5` yields `5px` instead of
     * throwing "Cannot operate on Keyword".
     */
    context.setOption('unitMode', 'preserve');
    const node = list([new Operation([keyword('1px'), '*', num(5)])]);
    expect(node.render(context)).toBe('5px');
  });

  it('Operation performs math on coerced numeric-string operands via a List', () => {
    /*
     * End-to-end: a List holding a `1px` string and a `* 5` operation renders
     * through math without a "Cannot operate on Keyword" crash.
     */
    const node = list([new Operation([dimension({ number: 1, unit: 'px' }), '*', num(5)])]);
    context.setOption('unitMode', 'preserve');
    expect(node.render(context)).toBe('5px');
  });
});
