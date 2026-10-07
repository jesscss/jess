import { describe, expect, it } from 'vitest';
import { Context } from '../context.js';
import { decl, dimension, operation, rule, stylesheet, type Stylesheet } from '../ast/nodes.js';
import { serialize } from '../ast/serialize.js';
import { buildEvaluator } from '../ast/evaluator.js';
import { createFnRegistry } from '../ast/value-dispatch.js';
import type { PluginInterface, SafeParseOptions } from '../plugin.js';

describe('Context canonical document provenance', () => {
  it('restores document ownership across a deferred body, async suspension, and error', async () => {
    const parser: PluginInterface = {
      name: 'test',
      supportedExtensions: ['.test'],
      safeParse: () => ({ document: stylesheet([]), errors: [], warnings: [] })
    };
    const context = new Context({}, [parser]);
    context.registerValueEvaluator(buildEvaluator(createFnRegistry()));
    expect('setOption' in context).toBe(false);
    expect(Reflect.set(context.options, 'mathMode', 'always')).toBe(false);
    expect(context.options.mathMode).toBe('parens-division');
    const root = (await context.parseString('', { filePath: '/project/root.test' })).node;
    const imported = (await context.parseString('', { filePath: '/project/imported.test' })).node;
    const body: object = [];
    const transitions: string[] = [];
    const rootOwner = await context.withDocument(root, async () => {
      const owner = context.currentSourceOwner();
      expect(owner).not.toBeNull();
      expect(context.documentContext).toBe(owner);
      expect(context.sourceContext).toBe(owner);
      expect(context.treeContext).toBeUndefined();
      context.rememberDocumentBody(imported, body);
      return owner;
    });
    const importedOwner = await context.withDocument(imported, async () => context.currentSourceOwner());

    expect(rootOwner).not.toBe(importedOwner);
    expect(context.currentSourceOwner()).toBeNull();
    expect(context.sourceOwnerForBody(body)).toBe(importedOwner);

    await context.withDocument(root, async () => {
      transitions.push(context.currentSourceOwner() === rootOwner ? 'root-enter' : 'wrong-root-enter');
      expect(context.sourceOwnerForBody({})).toBe(rootOwner);
      await context.withDocumentBody(body, async () => {
        transitions.push(context.currentSourceOwner() === importedOwner ? 'body-enter' : 'wrong-body-enter');
        await Promise.resolve();
        transitions.push(context.currentSourceOwner() === importedOwner ? 'body-resume' : 'wrong-body-resume');
      });
      transitions.push(context.currentSourceOwner() === rootOwner ? 'root-restored' : 'wrong-root-restored');

      await expect(context.withSourceOwner(importedOwner, async () => {
        expect(context.currentSourceOwner()).toBe(importedOwner);
        throw new Error('expected provenance failure');
      })).rejects.toThrow('expected provenance failure');
      transitions.push(context.currentSourceOwner() === rootOwner ? 'error-restored' : 'wrong-error-restored');
    });

    expect(transitions).toEqual([
      'root-enter',
      'body-enter',
      'body-resume',
      'root-restored',
      'error-restored'
    ]);
    expect(transitions).toHaveLength(5);
    expect(context.currentSourceOwner()).toBeNull();
  });

  it('resolves each document\'s policy from its own dialect defaults, under the Context\'s explicit options', async () => {
    const received: Array<SafeParseOptions['sourceOptions']> = [];
    const parser: PluginInterface = {
      name: 'test',
      supportedExtensions: ['.test'],
      safeParse: (filePath, _source, options) => {
        received.push(options?.sourceOptions);
        const imported = filePath.endsWith('/imported.test');
        return {
          document: stylesheet([
            rule(imported ? '.imported' : '.root', [
              decl('value', operation(
                '+',
                dimension(1, 'px'),
                dimension(2, 'em'),
                false,
                true
              ))
            ])
          ]),
          dialectDefaults: {
            mathMode: imported ? 'parens' : 'always',
            unitMode: imported ? 'strict' : 'loose'
          },
          errors: [],
          warnings: []
        };
      }
    };
    const parse = async (context: Context, name: string) =>
      (await context.parseString('', { filePath: `/project/${name}.test` })).node;
    const optionsIn = (context: Context, document: Stylesheet) =>
      context.withDocument(document, () => context.options);

    const context = new Context({}, [parser]);
    context.registerValueEvaluator(buildEvaluator(createFnRegistry()));
    const root = await parse(context, 'root');
    const imported = await parse(context, 'imported');
    const sibling = await parse(context, 'sibling');

    expect(optionsIn(context, root)).toMatchObject({ mathMode: 'always', unitMode: 'loose' });
    expect(optionsIn(context, imported)).toMatchObject({ mathMode: 'parens', unitMode: 'strict' });
    expect(Object.isFrozen(optionsIn(context, imported))).toBe(true);

    /* Documents that resolve to the same policy share one object. */
    expect(optionsIn(context, sibling)).toBe(optionsIn(context, root));

    const importedOwner = await context.withDocument(imported, async () => context.currentSourceOwner());
    await context.withDocument(root, async () => {
      await context.withSourceOwner(importedOwner, async () => {
        expect(context.options.unitMode).toBe('strict');
      });
      expect(context.options.unitMode).toBe('loose');
    });
    expect(context.options.mathMode).toBe('parens-division');

    await expect(Promise.resolve(context.withDocument(root, () => serialize(root, { context })))).resolves.toEqual({
      css: '.root {\n  value: 3px;\n}\n'
    });
    expect(() => context.withDocument(imported, () => serialize(imported, { context })))
      .toThrow(expect.objectContaining({ code: 'eval/invalid-unit-arithmetic' }));

    /* An explicit Context option wins over every document's own defaults. */
    const explicit = new Context({ mathMode: 'parens', unitMode: 'preserve' }, [parser]);
    for (const name of ['root', 'imported']) {
      expect(optionsIn(explicit, await parse(explicit, name))).toMatchObject({ mathMode: 'parens', unitMode: 'preserve' });
    }

    /* Settings the host scopes to one source sit between the two. */
    received.length = 0;
    const scoped = new Context({
      sourceOptions: filePath => (filePath.endsWith('/root.test') ? { unitMode: 'preserve' } : undefined)
    }, [parser]);
    expect(optionsIn(scoped, await parse(scoped, 'root'))).toMatchObject({ mathMode: 'always', unitMode: 'preserve' });
    expect(optionsIn(scoped, await parse(scoped, 'imported'))).toMatchObject({ mathMode: 'parens', unitMode: 'strict' });
    expect(received).toEqual([{ unitMode: 'preserve' }, undefined]);
  });
});
