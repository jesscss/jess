import { describe, it, expect } from 'vitest';
import { Visitor, TreeVisitor, ABORT } from '../index.js';
import { ruleset, rules, decl, any, type Declaration, type Ruleset, nil } from '../../tree/index.js';

describe('Visitor Pattern', () => {
  describe('accept() method', () => {
    it('should visit node itself first, then children', () => {
      const visited: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const visitor = {
        enter: (node: { type?: string } | undefined) => {
          visited.push(`enter:${node?.type}`);
        },
        ruleset: (node: unknown) => {
          visited.push(`ruleset`);
          return node;
        },
        declaration: (node: unknown) => {
          visited.push(`declaration`);
          return node;
        }
      } as unknown as Visitor;

      const declaration = decl({ name: 'color', value: any('red') });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const rs = ruleset({ selector: null as unknown as ReturnType<typeof nil>, rules: [declaration] });

      rs.accept(visitor);

      // Should visit ruleset first, then declaration
      expect(visited).toContain('enter:Ruleset');
      expect(visited).toContain('ruleset');
      expect(visited).toContain('enter:Declaration');
      expect(visited).toContain('declaration');

      // Ruleset should be visited before declaration
      const rulesetIndex = visited.findIndex(v => v === 'ruleset');
      const declIndex = visited.findIndex(v => v === 'declaration');
      expect(rulesetIndex).toBeLessThan(declIndex);
    });

    it('should handle node replacement', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const visitor = {
        declaration: (node: unknown) => {
          // Replace with new declaration
          return decl({ name: 'background', value: any('blue') });
        }
      } as unknown as Visitor;

      const declaration = decl({ name: 'color', value: any('red') });
      const result = declaration.accept(visitor);

      expect(result.type).toBe('Declaration');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((result as Declaration).name.valueOf()).toBe('background');
    });

    it('should recursively visit children', () => {
      const visited: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const visitor = {
        ruleset: (node: unknown) => {
          visited.push('ruleset');
          return node;
        },
        declaration: (node: unknown) => {
          visited.push('declaration');
          return node;
        }
      } as unknown as Visitor;

      const decl1 = decl({ name: 'color', value: any('red') });
      const decl2 = decl({ name: 'background', value: any('blue') });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const rs = ruleset({ selector: null as unknown as ReturnType<typeof nil>, rules: [decl1, decl2] });

      rs.accept(visitor);

      expect(visited.filter(v => v === 'ruleset')).toHaveLength(1);
      expect(visited.filter(v => v === 'declaration')).toHaveLength(2);
    });
  });

  describe('TreeVisitor with accept()', () => {
    it('should use accept() if node has it, avoiding double-visiting', () => {
      const visited: string[] = [];

      class TestVisitor extends TreeVisitor {
        override ruleset(node: Ruleset) {
          visited.push('ruleset');
          return node;
        }

        override declaration(node: Declaration) {
          visited.push('declaration');
          return node;
        }
      }

      const visitor = new TestVisitor();
      const declaration = decl({ name: 'color', value: any('red') });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const rs = ruleset({ selector: null as unknown as ReturnType<typeof nil>, rules: [declaration] });

      visitor.visit(rs);

      // Should visit each node exactly once (no double-visiting)
      expect(visited.filter(v => v === 'ruleset')).toHaveLength(1);
      expect(visited.filter(v => v === 'declaration')).toHaveLength(1);
    });
  });

  describe('Visitor return values', () => {
    it('should handle ABORT symbol', () => {
      const visited: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const visitor = {
        enter: () => {
          visited.push('enter');
          return ABORT;
        },
        ruleset: () => {
          visited.push('ruleset');
        }
      } as unknown as Visitor;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const rs = ruleset({ selector: null as unknown as ReturnType<typeof nil>, rules: [] });
      const visitorInstance = new (class extends Visitor {
        override visit(n: Parameters<Visitor['visit']>[0]) {
          return super.visit(n);
        }
      })();
      Object.assign(visitorInstance, visitor);
      rs.accept(visitorInstance);

      // Should stop after enter returns ABORT
      expect(visited).toContain('enter');
      expect(visited).not.toContain('ruleset');
    });
  });
});
