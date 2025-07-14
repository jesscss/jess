import { decl, vardecl, any, AssignmentType, rules, ref, type Node } from '../../tree';
import { Scope } from '../index';
import { logger } from '../../logger';
import { Context } from '../../context';

vi.spyOn(logger, 'warn');

let scope: Scope;
let context: Context;

function push(s: Scope, n: Node, { allowRuleLookups = false, readonly = false }: { allowRuleLookups?: boolean; readonly?: boolean } = {}) {
  s.add(n, allowRuleLookups, readonly);
}

describe('Scope', async () => {
  beforeEach(() => {
    context = new Context();
    scope = new Scope(rules(), context);
    context.scope = scope;
  });

  describe('set / get', () => {
    it('can do a normal get / set of properties', () => {
      push(scope, decl({ name: 'foo', value: any('bar') }));
      expect(`${scope.getProp('foo')}`).toBe('foo: bar');
    });

    it('can do a normal get / set of variables', () => {
      push(scope, vardecl({ name: 'foo', value: any('bar') }));
      expect(`${scope.getVar('foo')}`).toBe('$foo: bar');
    });

    it('replaces variable values', () => {
      push(scope, vardecl({ name: 'foo', value: any('one') }));
      push(scope, vardecl({ name: 'foo', value: any('two') }));
      expect(`${scope.getVar('foo')}`).toBe('$foo: two');
    });

    it('will not set if defined', async () => {
      let decl1 = vardecl({ name: 'first', value: any('one') }, { assign: AssignmentType.CondAssign });
      let decl2 = vardecl({ name: 'first', value: any('two') }, { assign: AssignmentType.CondAssign });
      decl1 = await decl1.preEval(context);
      decl2 = await decl2.preEval(context);
      push(scope, decl1);
      push(scope, decl2);
      expect(`${await scope.getVar('first')!.eval(context)}`).toBe('$first: one');
    });

    // it('will skip normalization', () => {
    //   scope.setVar('one', 'one', { isNormalized: true, protected: true })
    //   expect(scope.getVar('one')).toEqual('one')
    // })

    it('throws if undefined', async () => {
      let decl1 = decl({ name: 'foo', value: ref('first', { type: 'variable' }) });
      push(scope, decl1);
      await expect(
        decl1.eval(context)
      ).rejects.toThrowError();
    });

    it('doesn\'t throw error if there\'s a fallback', async () => {
      let decl1 = decl({ name: 'foo', value: ref('first', { type: 'variable', fallbackValue: true }) });
      push(scope, decl1);
      await expect(decl1.eval(context)).resolves.not.toThrow();
    });
  });

  describe('scope inheritance', () => {
    it('looks up parent scope', () => {
      push(scope, vardecl({ name: 'foo', value: any('bar') }));
      let inherited = new Scope(rules(), context, scope);
      /** Pretend the rules came from the parent scope when evaluating */
      expect(`${inherited.getVar('foo')}`).toBe('$foo: bar');
    });

    it('inherits values when set after', () => {
      let inherited = new Scope(rules(), context, scope);
      push(scope, vardecl({ name: 'foo', value: any('bar') }));
      expect(`${inherited.getVar('foo')}`).toBe('$foo: bar');
    });

    it('shadows variables #1', () => {
      let inherited = new Scope(rules(), context, scope);
      push(scope, vardecl({ name: 'one', value: any('one') }));
      push(inherited, vardecl({ name: 'one', value: any('three') }));
      expect(`${inherited.getVar('one')}`).toBe('$one: three');
    });

    it('shadows variables #2', () => {
      let inherited = new Scope(rules(), context, scope);
      push(scope, vardecl({ name: 'one', value: any('one') }));
      push(inherited, vardecl({ name: 'one', value: any('two') }));
      push(inherited, vardecl({ name: 'one', value: any('three') }));
      expect(`${inherited.getVar('one')}`).toBe('$one: three');
    });

    it('sets existing variables', () => {
      let inherited = new Scope(rules(), context, scope);
      push(scope, vardecl({ name: 'one', value: any('one') }));
      push(inherited, vardecl({ name: 'one', value: any('three') }, { setDefined: true }));
      expect(`${scope.getVar('one')}`).toBe('$one: three');
      expect(`${inherited.getVar('one')}`).toBe('$$one: three');
    });

    it('fails to set if existing variable is readonly', () => {
      let inherited = new Scope(rules(), context, scope);
      push(scope, vardecl({ name: 'one', value: any('one') }), { readonly: true });
      expect(() =>
        push(inherited, vardecl({ name: 'one', value: any('three') }, { setDefined: true }))
      ).toThrow();
    });

    it('looks upwards from position', () => {
      scope.add(vardecl({ name: 'one', value: any('one') }));
      scope.add(vardecl({ name: 'one', value: any('two') }));
      scope.add(vardecl({ name: 'one', value: any('three') }));
      expect(`${scope.getVar('one', {}, 0)}`).toBe('$one: one');
      expect(`${scope.getVar('one', {}, 1)}`).toBe('$one: two');
      expect(`${scope.getVar('one')}`).toBe('$one: three');
    });

    it('sets upwards from position', () => {
      scope.add(vardecl({ name: 'one', value: any('one') }));
      scope.add(vardecl({ name: 'one', value: any('two') }, { setDefined: true }));
      scope.add(vardecl({ name: 'one', value: any('three') }));
      expect(`${scope.getVar('one', {}, 0)}`).toBe('$one: two');
      expect(`${scope.getVar('one', {}, 1)}`).toBe('$$one: two');
      expect(`${scope.getVar('one')}`).toBe('$one: three');
    });

    it('assigns position linearly for nested rules', () => {
      let grandChild = rules([
        vardecl({ name: 'one', value: any('three') })
      ]);
      let child = rules([
        vardecl({ name: 'foo', value: any('bar') }),
        vardecl({ name: 'one', value: any('two') }),
        grandChild
      ]);
      let outer = rules([
        vardecl({ name: 'one', value: any('one') }),
        vardecl({ name: 'root', value: any('value') }),
        child
      ]);
      /** @todo - Add a bunch of parent tests elsewhere */
      expect(grandChild.parent).toBe(child);
      expect(child.parent).toBe(outer);
      for (let [,rule] of outer) {
        scope.add(rule);
      }

      expect(`${scope.getVar('one')}`).toBe('$one: one');
      expect(`${grandChild.getScope(context).getVar('one')}`).toBe('$one: three');

      /** @todo - Doesn't work yet. See NOTES.md */
      // expect(`${grandChild.getScope(context).getVar('foo')}`).toBe('$foo: bar')
      // expect(`${grandChild.getScope(context).getVar('root')}`).toBe('$root: value')
    });

    // it('can deeply inherit scope', () => {
    //   let child = new Scope(rules(), scope)
    //   scope.set(vardecl({ name: 'one', value: any('one') }), 0)
    //   scope.set(vardecl({ name: 'root', value: any('value') }), 1)
    //   child.set(vardecl({ name: 'foo', value: any('bar') }), 2)
    //   child.set(vardecl({ name: 'one', value: any('two') }), 3)
    //   let grandChild = new Scope(rules(), child)
    //   grandChild.set(vardecl({ name: 'one', value: any('three') }), 4)

    //   // inherited.setVar('one', 'three', { setDefined: true })
    //   expect(scope.getVar('one')).toBe('one')
    //   expect(grandChild.getVar('one')).toBe('three')
    //   expect(grandChild.getVar('foo')).toBe('bar')
    //   expect(grandChild.getVar('root')).toBe('value')
    // })

    // it('can merge child scope into parent scope', () => {
    //   scope.setProp('foo', decl({ name: 'foo', value: any('one') }, { assign: AssignmentType.MergeList }))
    //   let child = new Scope()
    //   child.setProp('foo', decl({ name: 'foo', value: any('two') }, { assign: AssignmentType.MergeList }))
    //   scope.merge(child)
    //   expect(`${scope.getProp('foo')}`).toEqual('foo: one, two')
    // })

    // it('will leak undefined vars', () => {
    //   let child = new Scope()
    //   child.setVar('one', 'two')
    //   scope.merge(child, true)
    //   expect(scope.getVar('one')).toEqual('two')
    // })

    // it('will not leak defined vars', () => {
    //   let child = new Scope()
    //   child.setVar('one', 'two')
    //   scope.setVar('one', 'one')
    //   scope.merge(child, true)
    //   expect(scope.getVar('one')).toEqual('one')
    // })
  });

  // describe('key normalization', () => {
  //   it('normalizes into camel case', () => {
  //     expect(scope.normalizeKey('foo-bar')).toBe('fooBar')
  //   })
  //   it('changes a starting dash to underscore', () => {
  //     expect(scope.normalizeKey('-foo-bar')).toBe('_fooBar')
  //   })
  //   /**
  //    * Okay what about #FooBar and .FooBar?
  //    */
  //   it('replaces a leading "." or "#"', () => {
  //     expect(scope.normalizeKey('.foo-bar')).toBe('fooBar')
  //     expect(scope.normalizeKey('#foo-bar')).toBe('FooBar')
  //     expect(scope.normalizeKey('.Foo-bar')).toBe('fooBar')
  //   })
  // })

  // describe('warnings', () => {
  //   it('warns if keys are normalized differently', () => {
  //     scope.setVar('foo-bar', 'one')
  //     scope.setVar('fooBar', 'one')
  //     expect(logger.warn).toBeCalled()
  //   })

  //   it('warns if keys are normalized differently', () => {
  //     scope.setVar('.foo-bar', 'one')
  //     scope.setVar('fooBar', 'one')
  //     expect(logger.warn).toBeCalled()
  //   })
  // })

  // describe('errors', () => {
  //   it('throws if a variable is not defined', () => {
  //     expect(() => scope.getVar('foo')).toThrow()
  //   })

  //   it('throws if a property is not defined', () => {
  //     expect(() => scope.getProp('color')).toThrow()
  //   })

  //   it('throws if a variable is a reserved word', () => {
  //     expect(() => scope.setVar('protected', null)).toThrow()
  //   })

  //   it('throws if a variable starts with "$"', () => {
  //     expect(() => scope.setVar('$foo', null)).toThrow()
  //   })

  //   it('throws if a variable is not a valid JS identifier', () => {
  //     expect(() => scope.setVar('foo~~bar', null)).toThrow()
  //   })

  //   it('throws if a the variable is marked as protected', () => {
  //     scope.setVar('foo', 'one', { protected: true })
  //     expect(() => scope.setVar('foo', 'two')).toThrow()
  //   })

  //   it('throws if trying to set a variable which is unset', () => {
  //     expect(() => scope.setVar('foo', 'one', { setDefined: true })).toThrow()
  //   })

  //   it('throws if trying to declare a variable which is already declared', () => {
  //     scope.setVar('foo', 'one')
  //     expect(() => scope.setVar('foo', 'two', { throwIfDefined: true })).toThrow()
  //   })

  //   it('throws if all items are excluded, so no match found', () => {
  //     scope.setVar('one', 'one')
  //     scope.setVar('one', 'two')
  //     expect(() => scope.getVar('one', {
  //       filter: () => ({ value: Scope.NONE, done: false })
  //     })).toThrow()
  //   })
  // })
});