import { describe, expect, it } from 'vitest';
import { Context } from '../context.js';
import { stylesheet } from '../ast/nodes.js';
import type { PluginInterface } from '../plugin.js';

describe('Context canonical document provenance', () => {
  it('restores document ownership across a deferred body, async suspension, and error', async () => {
    const parser: PluginInterface = {
      name: 'test',
      supportedExtensions: ['.test'],
      safeParse: () => ({ document: stylesheet([]), errors: [], warnings: [] }),
    };
    const context = new Context({}, [parser]);
    const root = (await context.parseString('', { filePath: '/project/root.test' })).node;
    const imported = (await context.parseString('', { filePath: '/project/imported.test' })).node;
    const body: object = [];
    const transitions: string[] = [];
    const rootOwner = await context.withDocument(root, async () => {
      const owner = context.currentSourceOwner();
      expect(owner).not.toBeNull();
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
      'error-restored',
    ]);
    expect(transitions).toHaveLength(5);
    expect(context.currentSourceOwner()).toBeNull();
  });
});
