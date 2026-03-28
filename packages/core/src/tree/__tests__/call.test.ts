import { vi } from 'vitest';
import { any, call, coll, decl, expr, fn, interpolated, jsfunc, list, num, ref, rules, seq, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { getParent, setField } from '../util/field-helpers.js';

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

  it('uses state-patched args when materializing a fallback call without mutating the patched source args', async () => {
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

    setField(node, 'args', list([patchedArg]), context);

    const evald = await root.eval(context);

    expect(evald.toTrimmedString({ context })).toContain('fn(3 4)');
    expect(originalSecond.pre).toBe(0);
    expect(patchedSecond.pre).toBe(0);
    expect(originalArg.toTrimmedString()).toBe('12');
    expect(patchedArg.toTrimmedString()).toBe('34');
  });

  it('preserves a state-patched content node across fallback-call materialization without mutating the canonical call', async () => {
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

    setField(node, 'contentNode', any('patched'), context);

    const evald = await root.eval(context);

    expect(evald.toTrimmedString({ context })).toContain('fn(1): patched');
    expect(node.contentNode).toBeUndefined();
    expect(node.toTrimmedString()).toBe('$fn??(1)');
  });

  it('passes state-patched nested args into JS function calls without mutating the canonical arg nodes', async () => {
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

    setField(arg, 'value', [num(3), num(4)], context);

    const evald = await root.eval(context);

    expect(evald.toTrimmedString({ context })).toContain('3 4');
    expect(arg.toTrimmedString({ context })).toBe('3 4');
    expect(arg.toTrimmedString()).toBe('12');
    expect(second.pre).toBe(0);
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

  it('reads a state-patched silentFail option during serialization without mutating canonical output', () => {
    const node = call({
      name: 'rgb',
      args: list([num(1)])
    });

    setField(node, 'options', { silentFail: true }, context);

    expect(node.toTrimmedString({ context })).toBe('rgb?(1)');
    expect(node.toTrimmedString()).toBe('rgb(1)');
    expect(node.options.silentFail).toBeUndefined();
  });

  it('reads a state-patched silentFail option during non-function eval without mutating canonical options', async () => {
    const node = call({
      name: 'rgb',
      args: list([num(1)])
    });

    setField(node, 'options', { silentFail: true }, context);

    const evald = await node.eval(context);

    expect(evald.toTrimmedString({ context })).toBe('rgb(1)');
    expect(node.toTrimmedString({ context })).toBe('rgb?(1)');
    expect(node.toTrimmedString()).toBe('rgb(1)');
    expect(node.options.silentFail).toBeUndefined();
  });

  it('keeps canonical child parents intact on shallow clones while exposing the wrapper through the state parent chain', () => {
    const name = ref('rgb', { type: 'function' });
    const args = list([num(1)]);
    const node = call({ name, args });

    const clone = node.clone(false, undefined, context);

    expect(name.parent).toBe(node);
    expect(args.parent).toBe(node);
    expect(getParent(name, context)).toBe(clone);
    expect(getParent(args, context)).toBe(clone);
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

  it('materializes stylesheet-function return nodes before applying call result provenance', async () => {
    const returnValue = any('ok');
    returnValue.pre = 0;
    const functionNode = fn({
      name: any('make'),
      body: rules([
        decl({ name: 'return', value: returnValue })
      ])
    });
    const node = call({
      name: functionNode,
      args: list([])
    });
    node.pre = 2;
    node.post = 1;

    const result = await node.eval(context);

    expect(result.toTrimmedString({ context })).toBe('ok');
    expect(result).not.toBe(returnValue);
    expect(result.pre).toBe(2);
    expect(result.post).toBe(1);
    expect(result.sourceParent).toBe(node);
    expect(returnValue.pre).toBe(0);
    expect(returnValue.post).toBeUndefined();
    expect(returnValue.sourceParent).toBeUndefined();
  });

  it('materializes stylesheet-function rules results without reusing canonical child identity', async () => {
    const childDecl = decl({ name: 'color', value: any('red') });
    const returnValue = rules([childDecl]);
    const functionNode = fn({
      name: any('make'),
      body: rules([
        decl({ name: 'return', value: returnValue })
      ])
    });
    const node = call({
      name: functionNode,
      args: list([])
    });
    node.pre = 2;
    node.post = 1;

    const result = await node.eval(context);

    expect(result.toTrimmedString({ context })).toContain('color: red;');
    expect(result).not.toBe(returnValue);
    expect(result.value[0]).not.toBe(childDecl);
    expect(childDecl.parent).toBe(returnValue);
    expect(result.pre).toBe(2);
    expect(result.post).toBe(1);
    expect(result.sourceParent).toBe(node);
  });

  it('materializes nested-call results before applying outer call provenance', async () => {
    const returnValue = any('ok');
    returnValue.pre = 0;
    const functionNode = fn({
      name: any('make'),
      body: rules([
        decl({ name: 'return', value: returnValue })
      ])
    });
    const aliasCall = call({
      name: functionNode,
      args: list([])
    });
    const aliasRef = ref('alias', { type: 'variable' });
    vi.spyOn(aliasRef, 'eval').mockResolvedValue(aliasCall);
    const node = call({
      name: aliasRef,
      args: list([])
    });
    node.pre = 2;
    node.post = 1;
    const result = await node.eval(context);

    expect(result.toTrimmedString({ context })).toBe('ok');
    expect(result).not.toBe(returnValue);
    expect(result.pre).toBe(2);
    expect(result.post).toBe(1);
    expect(result.sourceParent).toBe(node);
    expect(returnValue.pre).toBe(0);
    expect(returnValue.post).toBeUndefined();
    expect(returnValue.sourceParent).toBeUndefined();
  });

  it('keeps nested-call composite Rules results out of the remaining same-source owner branch', async () => {
    const childDecl = decl({ name: 'color', value: any('red') });
    const returnValue = rules([childDecl]);
    const functionNode = fn({
      name: any('make'),
      body: rules([
        decl({ name: 'return', value: returnValue })
      ])
    });
    const aliasCall = call({
      name: functionNode,
      args: list([])
    });
    const aliasRef = ref('alias', { type: 'variable' });
    vi.spyOn(aliasRef, 'eval').mockResolvedValue(aliasCall);
    const node = call({
      name: aliasRef,
      args: list([])
    });
    node.pre = 2;
    node.post = 1;

    const result = await node.eval(context);

    expect(result.toTrimmedString({ context })).toContain('color: red;');
    expect(result).not.toBe(returnValue);
    expect(result.value[0]).not.toBe(childDecl);
    expect(result.pre).toBe(2);
    expect(result.post).toBe(1);
    expect(result.sourceParent).toBe(node);
    expect(childDecl.parent).toBe(returnValue);
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

    const shallow = returnValue.clone(false, undefined, context);

    expect(shallow.value[0]).toBe(childDecl);
    expect(childDecl.parent).toBe(shallow);
    expect(returnValue.value[0]).toBe(childDecl);

    node.makeImportant(shallow);

    expect(childDecl.important?.toTrimmedString()).toBe('!important');
  });

  it('characterizes composite same-source Rules results as still needing a child-identity-breaking returned-tree boundary, not a lookup-safe wrapper', () => {
    const childDecl = decl({ name: 'color', value: any('red') });
    const returnValue = rules([childDecl]);
    const node = call({
      name: returnValue,
      args: list([])
    }, { markImportant: true });

    const wrapper = returnValue.cloneLookupSafeShallowWrapper(context);

    expect(wrapper.value[0]).toBe(childDecl);
    expect(childDecl.parent).toBe(returnValue);
    expect(getParent(childDecl, context)).toBe(wrapper);

    node.makeImportant(wrapper);

    expect(childDecl.important?.toTrimmedString()).toBe('!important');
  });

  it('characterizes the exact lower helper contract for stylesheet-function same-source Rules results', () => {
    const childDecl = decl({ name: 'color', value: any('red') });
    const returnValue = rules([childDecl]);
    const node = call({
      name: returnValue,
      args: list([])
    }, { markImportant: true });
    node.pre = 2;
    node.post = 1;

    const returned = returnValue.cloneDetachedMaterializedWrapper(context);
    node.makeImportant(returned);
    returned.pre = node.pre;
    returned.post = node.post;
    returned.sourceParent = node;

    expect(returned).not.toBe(returnValue);
    expect(returned.value[0]).not.toBe(childDecl);
    expect(childDecl.parent).toBe(returnValue);
    expect(returned.value[0].toTrimmedString({ context })).toBe('color: red !important');
    expect(returned.pre).toBe(2);
    expect(returned.post).toBe(1);
    expect(returned.sourceParent).toBe(node);
    expect(childDecl.important).toBeUndefined();
  });

  it('reads a state-patched markImportant option for collection results without mutating canonical options', async () => {
    const childDecl = decl({ name: 'color', value: any('red') });
    const collectionNode = coll([childDecl]);
    const node = call({
      name: collectionNode,
      args: list([])
    });

    setField(node, 'options', { markImportant: true }, context);

    const result = await node.eval(context);

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
