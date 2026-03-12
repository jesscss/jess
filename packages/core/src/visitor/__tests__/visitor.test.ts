import { describe, it, expect } from 'vitest';
import { Visitor, TreeVisitor, ABORT } from '../index.js';
import { ruleset, rules, decl, any } from '../../tree/index.js';

describe('Visitor Pattern', () => {
  describe('accept() method', () => {
    it('should visit node itself first, then children', () => {
      const visited: string[] = [];

      const visitor = {
        enter: (node: any) => {
          visited.push(`enter:${node?.type}`);
        },
        ruleset: (node: any) => {
          visited.push(`ruleset`);
          return node;
        },
        declaration: (node: any) => {
          visited.push(`declaration`);
          return node;
        }
      } as Visitor;

      const declaration = decl({ name: 'color', value: any('red') });
      const rs = ruleset({ selector: null as any, rules: rules([declaration]) });

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
      const visitor = {
        declaration: (node: any) => {
          return decl({ name: 'background', value: any('blue') });
        }
      } as unknown as Visitor;

      const declaration = decl({ name: 'color', value: any('red') });
      const result = declaration.accept(visitor);

      expect(result.type).toBe('Declaration');
      expect((result as any).data.name.valueOf()).toBe('background');
    });

    it('should recursively visit children', () => {
      const visited: string[] = [];

      const visitor = {
        ruleset: (node: any) => {
          visited.push('ruleset');
          return node;
        },
        declaration: (node: any) => {
          visited.push('declaration');
          return node;
        }
      } as Visitor;

      const decl1 = decl({ name: 'color', value: any('red') });
      const decl2 = decl({ name: 'background', value: any('blue') });
      const rs = ruleset({ selector: null as any, rules: rules([decl1, decl2]) });

      rs.accept(visitor);

      expect(visited.filter(v => v === 'ruleset')).toHaveLength(1);
      expect(visited.filter(v => v === 'declaration')).toHaveLength(2);
    });
  });

  describe('TreeVisitor with accept()', () => {
    it('should use accept() if node has it, avoiding double-visiting', () => {
      const visited: string[] = [];

      class TestVisitor extends TreeVisitor {
        override ruleset(node: any) {
          visited.push('ruleset');
          return node;
        }

        override declaration(node: any) {
          visited.push('declaration');
          return node;
        }
      }

      const visitor = new TestVisitor();
      const declaration = decl({ name: 'color', value: any('red') });
      const rs = ruleset({ selector: null as any, rules: rules([declaration]) });

      visitor.visit(rs);

      // Should visit each node exactly once (no double-visiting)
      expect(visited.filter(v => v === 'ruleset')).toHaveLength(1);
      expect(visited.filter(v => v === 'declaration')).toHaveLength(1);
    });
  });

  describe('Visitor return values', () => {
    it('should handle ABORT symbol', () => {
      const visited: string[] = [];

      const visitor = {
        enter: () => {
          visited.push('enter');
          return ABORT;
        },
        ruleset: () => {
          visited.push('ruleset');
        }
      } as unknown as Visitor;

      const rs = ruleset({ selector: null as any, rules: rules([]) });
      const visitorInstance = new (class extends Visitor {
        override visit(n: any) {
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
