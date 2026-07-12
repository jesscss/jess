import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  rules,
  decl,
  vardecl,
  any,
  ref,
  Rules,
  Node
} from '../index.js';
import { Context } from '../../context.js';
import type { DeclarationFindOptions } from '../util/lookup-utils.js';
import { findVariableDeclarationOccurrence } from '../util/direct-rules-lookup.js';

function getVar(context: Context, n: Rules, key: string, opts: DeclarationFindOptions = {}) {
  context.rulesContext = n;
  opts.searchParents = true;
  return findVariableDeclarationOccurrence(n, key, opts)?.node;
}

describe('Detached Rulesets - Variable Lookups', () => {
  let context: Context;

  beforeAll(() => {
    Node.prototype.fullRender = true;
  });
  afterAll(() => {
    Node.prototype.fullRender = false;
  });

  beforeEach(() => {
    context = new Context();
    context.id = 'testing';
  });

  describe('Basic parent lookup (sanity check)', () => {
    it('should find variable in parent scope', async () => {
      const inherited = rules([]);
      const node = rules([
        vardecl({ name: 'foo', value: any('bar') }),
        inherited
      ]);

      await node.eval(context);

      const found = getVar(context, inherited, 'foo');

      expect(found).toBeDefined();
      expect(found?.toTrimmedString()).toBe('$foo: bar');
    });
  });

  describe('Private variables', () => {
    it('should NOT find private variables when searching from within the Rules', async () => {
      // Create nested Rules structure:
      // rootRules {
      //   @private-var: public-value;
      //   privateRules {
      //     @private-var: private-value;  // private visibility
      //   }
      // }
      const privateRules = rules([
        vardecl({ name: 'private-var', value: any('private-value') })
      ], {
        rulesVisibility: {
          VarDeclaration: 'private'
        }
      });

      const node = rules([
        vardecl({ name: 'private-var', value: any('public-value') }),
        privateRules
      ]);

      await node.eval(context);

      // When searching from within the private Rules (same scope), private does NOT block.
      // Private only blocks external access (outside looking in via child searches).
      const found = getVar(context, privateRules, 'private-var');

      // Should find the private one — same-scope lookups are not blocked by private visibility
      expect(found).toBeDefined();
      expect(found?.toTrimmedString()).toBe('$private-var: private-value');
    });

    it('should NOT find private variables when searching from outside the Rules', async () => {
      // Create nested Rules structure:
      // rootRules {
      //   privateRules {
      //     @private-var: private-value;  // private visibility
      //   }
      // }
      const privateRules = rules([
        vardecl({ name: 'private-var', value: any('private-value') })
      ], {
        rulesVisibility: {
          VarDeclaration: 'private'
        }
      });

      const node = rules([
        privateRules
      ]);

      await node.eval(context);

      // When searching from outside (parent), should NOT find the private variable
      const found = getVar(context, node, 'private-var');

      // Should NOT find the private variable from child
      expect(found).toBeUndefined();
    });
  });

  describe('Optional vs Private visibility', () => {
    it('should treat optional variables as optional (continue searching)', async () => {
      const optionalRules = rules([
        vardecl({ name: 'var', value: any('optional-value') })
      ], {
        rulesVisibility: {
          VarDeclaration: 'optional'
        }
      });

      const node = rules([
        vardecl({ name: 'var', value: any('public-value') }),
        optionalRules
      ]);

      await node.eval(context);

      const found = getVar(context, optionalRules, 'var');

      // Should find the public one (optional ones are only returned if no public ones exist)
      expect(found).toBeDefined();
      expect(found?.toTrimmedString()).toBe('$var: public-value');
    });

    it('should find private variables from same scope (private only blocks outside-in)', async () => {
      const privateRules = rules([
        vardecl({ name: 'var', value: any('private-value') })
      ], {
        rulesVisibility: {
          VarDeclaration: 'private'
        }
      });

      const node = rules([
        vardecl({ name: 'var', value: any('public-value') }),
        privateRules
      ]);

      await node.eval(context);

      const found = getVar(context, privateRules, 'var');

      // Same-scope lookup: private does NOT block. Should find the private one.
      expect(found).toBeDefined();
      expect(found?.toTrimmedString()).toBe('$var: private-value');
    });

    it('should return optional variable when no public variable exists', async () => {
      const optionalRules = rules([
        vardecl({ name: 'var', value: any('optional-value') })
      ], {
        rulesVisibility: {
          VarDeclaration: 'optional'
        }
      });

      const node = rules([
        optionalRules
      ]);

      await node.eval(context);

      const found = getVar(context, optionalRules, 'var');

      // Should return the optional one since no public one exists
      expect(found).toBeDefined();
      expect(found?.toTrimmedString()).toBe('$var: optional-value');
    });
  });

  describe('Variable lookup parent chain traversal', () => {
    it('should traverse parent chain correctly', async () => {
      // Root: @a: root-value;
      // Middle: @a: middle-value;
      // Inner: (lookup @a)
      const innerRules = rules([
        // Just a reference to test lookup
        decl({ name: 'test', value: ref('a', { type: 'variable' }) })
      ]);

      const middleRules = rules([
        vardecl({ name: 'a', value: any('middle-value') }),
        innerRules
      ]);

      const node = rules([
        vardecl({ name: 'a', value: any('root-value') }),
        middleRules
      ]);

      await node.eval(context);

      const found = getVar(context, innerRules, 'a');

      // Should find the middle one (closest in parent chain)
      expect(found).toBeDefined();
      expect(found?.toTrimmedString()).toBe('$a: middle-value');
    });
  });
});
