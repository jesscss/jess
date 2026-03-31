import { any, call, coll, decl, expr, fn, interpolated, jsfunc, list, num, ref, rules, seq, vardecl } from '../index.js';
import { Context } from '../../context.js';

let context: Context;
describe('Call', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('should serialize a CSS function', () => {
    let rule = call({
      name: 'rgb',
      args: list([num(100), num(100), num(100)])
    });
    expect(`${rule}`).toBe('rgb(100, 100, 100)');
  });

  it('should serialize an optional function lookup', () => {
    let rule = call({
      name: ref('rgb', { fallbackValue: true }),
      args: list([num(100), num(100), num(100)])
    });
    expect(`${rule}`).toBe('$rgb?(100, 100, 100)');
  });

  /** @todo */
  it('should serialize a mixin call', () => {
    let rule = call({
      name: ref('my-mixin', { type: 'mixin' }),
      args: list([num(100), num(100), num(100)])
    });
    expect(`${rule}`).toBe('|my-mixin(100, 100, 100)');
  });

  it('evaluates an interpolated CSS function name before serialization', async () => {
    const node = call({
      name: interpolated({
        source: '%%',
        replacements: [expr(any('blur'))]
      }, { role: 'ident' }),
      args: list([expr(any('4px'))])
    });

    const evald = await node.eval(context);

    expect(evald.toTrimmedString({ context })).toBe('blur(4px)');
  });

  it('materializes fallback-call args without mutating canonical nested sequence spacing', async () => {
    const second = num(2);
    second.pre = 0;
    const arg = seq([num(1), second]);
    const failingFn = () => {
      throw new Error('boom');
    };
    const node = call({
      name: ref('fn', { type: 'variable', fallbackValue: true }),
      args: list([arg])
    }, { silentFail: true });
    const root = rules([
      vardecl({
        name: any('fn'),
        value: jsfunc({ name: 'fn', fn: failingFn })
      }),
      node
    ]);

    const evald = await root.eval(context);

    expect(evald.toTrimmedString({ context })).toContain('fn(1 2)');
    expect(second.pre).toBe(0);
    expect(arg.toTrimmedString()).toBe('12');
  });

  it('uses cloned args when materializing a fallback call without mutating the canonical source args', async () => {
    const originalSecond = num(2);
    originalSecond.pre = 0;
    const originalArg = seq([num(1), originalSecond]);
    const patchedSecond = num(4);
    patchedSecond.pre = 0;
    const patchedArg = seq([num(3), patchedSecond]);
    const failingFn = () => {
      throw new Error('boom');
    };
    const node = call({
      name: ref('fn', { type: 'variable', fallbackValue: true }),
      args: list([originalArg])
    }, { silentFail: true });
    const root = rules([
      vardecl({
        name: any('fn'),
        value: jsfunc({ name: 'fn', fn: failingFn })
      }),
      node
    ]);
    const clonedRoot = root.clone(true);
    const clonedNode = clonedRoot.at(1, context) as ReturnType<typeof call>;
    const patchedArgs = list([patchedArg]);

    clonedNode.adopt(patchedArgs, context);
    (clonedNode as unknown as { args: ReturnType<typeof list> }).args = patchedArgs;

    const evald = await clonedRoot.eval(context);

    expect(evald.toTrimmedString({ context })).toContain('fn(3 4)');
    expect(originalSecond.pre).toBe(0);
    expect(patchedSecond.pre).toBe(0);
    expect(originalArg.toTrimmedString()).toBe('12');
    expect(patchedArg.toTrimmedString()).toBe('34');
  });

  it('preserves a cloned content node across fallback-call materialization without mutating the canonical call', async () => {
    const failingFn = () => {
      throw new Error('boom');
    };
    const node = call({
      name: ref('fn', { type: 'variable', fallbackValue: true }),
      args: list([num(1)])
    }, { silentFail: true });
    const root = rules([
      vardecl({
        name: any('fn'),
        value: jsfunc({ name: 'fn', fn: failingFn })
      }),
      node
    ]);
    const clonedRoot = root.clone(true);
    const clonedNode = clonedRoot.at(1, context) as ReturnType<typeof call>;
    const patchedContent = any('patched');

    clonedNode.adopt(patchedContent, context);
    (clonedNode as unknown as { contentNode: ReturnType<typeof any> }).contentNode = patchedContent;

    const evald = await clonedRoot.eval(context);

    expect(evald.toTrimmedString({ context })).toContain('fn(1): patched');
    expect(node.get('contentNode')).toBeUndefined();
    expect(node.toTrimmedString()).toBe('$fn??(1)');
  });

  it('passes cloned nested args into JS function calls without mutating the canonical arg nodes', async () => {
    const second = num(2);
    second.pre = 0;
    const arg = seq([num(1), second]);
    const node = call({
      name: ref('fn', { type: 'variable' }),
      args: list([arg])
    });
    const root = rules([
      vardecl({
        name: any('fn'),
        value: jsfunc({ name: 'fn', fn: (value: unknown) => value })
      }),
      node
    ]);
    const clonedRoot = root.clone(true);
    const clonedNode = clonedRoot.at(1, context) as ReturnType<typeof call>;
    const clonedArg = clonedNode.get('args').at(0, context) as ReturnType<typeof seq>;
    const clonedSecond = num(4);
    clonedSecond.pre = 0;

    (clonedArg as unknown as { value: ReturnType<typeof num>[] }).value = [num(3), clonedSecond];

    const evald = await clonedRoot.eval(context);

    expect(evald.toTrimmedString({ context })).toContain('3 4');
    expect(arg.toTrimmedString()).toBe('12');
    expect(second.pre).toBe(0);
    expect(clonedArg.toTrimmedString()).toBe('34');
    expect(clonedSecond.pre).toBe(0);
  });

  it('does not clear canonical silentFail in the non-function branch during patch-only eval', async () => {
    const node = call({
      name: 'rgb',
      args: list([num(1)])
    }, { silentFail: true });

    const evald = await node.eval(context);

    expect(evald.toTrimmedString({ context })).toBe('rgb(1)');
    expect(node.toTrimmedString()).toBe('rgb?(1)');
    expect(node.options.silentFail).toBe(true);
  });

  it('reads a cloned silentFail option during serialization without mutating canonical output', () => {
    const node = call({
      name: 'rgb',
      args: list([num(1)])
    });
    const clonedNode = node.clone();

    clonedNode.options = { silentFail: true };

    expect(clonedNode.toTrimmedString({ context })).toBe('rgb?(1)');
    expect(node.toTrimmedString()).toBe('rgb(1)');
    expect(node.options.silentFail).toBeUndefined();
  });

  it('reads a cloned silentFail option during non-function eval without mutating canonical options', async () => {
    const node = call({
      name: 'rgb',
      args: list([num(1)])
    });
    const clonedNode = node.clone();

    clonedNode.options = { silentFail: true };

    const evald = await clonedNode.eval(context);

    expect(evald.toTrimmedString({ context })).toBe('rgb(1)');
    expect(clonedNode.toTrimmedString({ context })).toBe('rgb?(1)');
    expect(node.toTrimmedString()).toBe('rgb(1)');
    expect(node.options.silentFail).toBeUndefined();
  });

  it('uses the call-local shallow clone in the silent-fail non-function branch without canonically reparenting children', async () => {
    const args = list([num(1)]);
    const node = call({
      name: 'rgb',
      args
    }, { silentFail: true });

    const evald = await node.eval(context);

    expect(evald.toTrimmedString({ context })).toBe('rgb(1)');
    expect(args.parent).toBe(node);
    expect(node.toTrimmedString()).toBe('rgb?(1)');
  });

  it('materializes collection results without mutating canonical collection children', async () => {
    const childDecl = decl({ name: 'color', value: any('red') });
    const collectionNode = coll([childDecl]);
    const node = call({
      name: collectionNode,
      args: list([])
    }, { markImportant: true });

    const result = await node.eval(context);

    expect(result.toTrimmedString({ context })).toContain('color: red !important;');
    expect(result.value[0]).not.toBe(childDecl);
    expect(childDecl.parent).toBe(collectionNode);
    expect(childDecl.toTrimmedString({ context })).toBe('color: red');
  });

  it('characterizes composite same-source Rules results as still needing a returned-tree boundary, not a shallow clone', () => {
    const childDecl = decl({ name: 'color', value: any('red') });
    const returnValue = rules([childDecl]);
    const node = call({
      name: returnValue,
      args: list([])
    }, { markImportant: true });

    const shallow = returnValue.clone();

    expect(shallow.value[0]).toBe(childDecl);
    expect(childDecl.parent).toBe(shallow);
    expect(returnValue.value[0]).toBe(childDecl);

    node.makeImportant(shallow);

    expect(childDecl.get('important')?.toTrimmedString()).toBe('!important');
  });

  it('reads a cloned markImportant option for collection results without mutating canonical options', async () => {
    const childDecl = decl({ name: 'color', value: any('red') });
    const collectionNode = coll([childDecl]);
    const node = call({
      name: collectionNode,
      args: list([])
    });
    const clonedNode = node.clone();

    clonedNode.options = { markImportant: true };

    const result = await clonedNode.eval(context);

    expect(result.toTrimmedString({ context })).toContain('color: red !important;');
    expect(node.options.markImportant).toBeUndefined();
  });

  // it('should serialize to a module', () => {
  //   let rule = call({
  //     name: 'rgb',
  //     value: list([num(100), num(100), num(100)])
  //   })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.call({\n  name: "rgb",\n  value: $J.list([\n    $J.num({\n      value: 100,\n      unit: ""\n    }),\n    $J.num({\n      value: 100,\n      unit: ""\n    }),\n    $J.num({\n      value: 100,\n      unit: ""\n    })\n  ]),\n  ref: () => rgb,\n})'
  //   )
  // })
});
