import { el, compound, sel } from '../index.js';
import { Context } from '../../context.js';

let context: Context;

describe('BasicSelector', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('should identify a class', () => {
    let rule = el('.foo');
    expect(rule.isClass).toBe(true);
  });
  it('should identify an id', () => {
    let rule = el('#id');
    expect(rule.isId).toBe(true);
  });
  it('should identify a tag', () => {
    let rule = el('foo');
    expect(rule.isTag).toBe(true);
  });
  it('should identify a tag with escapes', () => {
    let rule = el('\\.foo');
    expect(rule.isTag).toBe(true);
  });

  it('renders selector syntax through toTrimmedString()', () => {
    expect(el('.foo').toTrimmedString()).toBe('.foo');
    expect(el('#id').toTrimmedString()).toBe('#id');
  });

  it('renders selectors through render(context)', () => {
    expect(el('.foo').render(context)).toBe('.foo');
    expect(el('#id').render(context)).toBe('#id');
  });

  it('resolves selectors without touching render state', async () => {
    const node = el('.foo');

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('.foo');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  test('keys', () => {
    let rule = el('.foo');
    rule.eval(context);
    expect(rule.keySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
    expect(rule.visibleKeySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
  });
  // it('should serialize a module', () => {
  //   let rule = el('foo')
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe('$J.el($J.any("foo"))')

  //   rule = el(js('colorBrand'))
  //   out = new OutputCollector()
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe('$J.el(colorBrand)')
  // })
});
