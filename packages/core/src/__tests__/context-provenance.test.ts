import { describe, expect, it } from 'vitest';
import { Context } from '../context.js';
import { decl, dimension, operation, rule, stylesheet } from '../ast/nodes.js';
import { serialize } from '../ast/serialize.js';
import { buildEvaluator } from '../ast/evaluator.js';
import { createFnRegistry } from '../ast/value-dispatch.js';
import type { PluginInterface } from '../plugin.js';

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

  it('establishes one immutable session policy from the entry dialect defaults', async () => {
    const parser: PluginInterface = {
      name: 'test',
      supportedExtensions: ['.test'],
      safeParse: filePath => ({
        document: stylesheet([
          rule(filePath.endsWith('/imported.test') ? '.imported' : '.root', [
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
          mathMode: filePath.endsWith('/imported.test') ? 'parens' : 'always',
          unitMode: filePath.endsWith('/imported.test') ? 'strict' : 'loose'
        },
        errors: [],
        warnings: []
      })
    };
    const context = new Context({}, [parser]);
    context.registerValueEvaluator(buildEvaluator(createFnRegistry()));
    const root = (await context.parseString('', { filePath: '/project/root.test' })).node;
    const imported = (await context.parseString('', { filePath: '/project/imported.test' })).node;
    const importedOwner = await context.withDocument(
      imported,
      async () => context.currentSourceOwner()
    );

    await context.withDocument(root, async () => {
      expect(context.options.mathMode).toBe('always');
      await context.withSourceOwner(importedOwner, async () => {
        expect(context.options.mathMode).toBe('always');
      });
      expect(context.options.mathMode).toBe('always');
    });

    await expect(Promise.resolve(context.withDocument(root, () => serialize(root, { context })))).resolves.toEqual({
      css: '.root {\n  value: 3px;\n}\n'
    });
    await expect(Promise.resolve(context.withDocument(imported, () => serialize(imported, { context })))).resolves.toEqual({
      css: '.imported {\n  value: 3px;\n}\n'
    });

    expect(context.options.mathMode).toBe('parens-division');
    await context.withDocument(imported, async () => {
      expect(context.options.mathMode).toBe('always');
    });
    await context.withDocument(root, async () => {
      expect(context.options.mathMode).toBe('always');
    });

    const overridden = new Context({ mathMode: 'parens' }, [parser]);
    const overriddenRoot = (await overridden.parseString('', {
      filePath: '/project/root.test'
    })).node;
    await overridden.withDocument(overriddenRoot, async () => {
      expect(overridden.options.mathMode).toBe('parens');
    });
  });
});
