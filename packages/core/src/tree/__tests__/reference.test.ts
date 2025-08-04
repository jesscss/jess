import { ref, rules, decl, vardecl, spaced, any, quoted, name, expr } from '..';
import { Context } from '../../context';

let context: Context;

describe('reference', () => {
  beforeEach(() => {
    context = new Context();
  });
  describe('serialization', () => {
    it('should serialize a variable reference', () => {
      let node = ref({ key: 'foo' }, { type: 'variable' });
      expect(`${node}`).toBe('foo');
    });

    it('should serialize a property reference', () => {
      let node = ref({ key: 'foo' }, { type: 'property' });
      expect(`${node}`).toBe('.~foo');
    });

    it('should serialize a declaration reference', () => {
      let node = ref({ key: 'foo' }, { type: 'declaration' });
      expect(`${node}`).toBe('.foo');
    });

    it('should serialize an optional reference', () => {
      let node = ref({ key: 'foo' }, { type: 'variable', fallbackValue: true });
      expect(`${node}`).toBe('foo?');
    });

    it('should serialize a mixin reference', () => {
      let node = ref({ key: 'foo' }, { type: 'mixin' });
      expect(`${node}`).toBe('|foo');
    });

    it('should serialize a ruleset reference', () => {
      let node = ref({ key: 'foo' }, { type: 'ruleset' });
      expect(`${node}`).toBe('*(foo)');
    });

    it('should serialize a mixin-ruleset reference', () => {
      let node = ref({ key: 'foo' }, { type: 'mixin-ruleset' });
      expect(`${node}`).toBe('*foo');
    });

    it('should serialize a number index', () => {
      let node = ref({ key: 0 }, { type: 'index' });
      expect(`${node}`).toBe('[0]');
    });

    it('should serialize a string index', () => {
      let node = ref({ key: 'foo' }, { type: 'index' });
      expect(`${node}`).toBe('[foo]');
    });

    it('should serialize a quoted index', () => {
      let node = ref({ key: 'foo' }, { type: 'index' });
      expect(`${node}`).toBe('[foo]');
    });

    it('should serialize a selector index', () => {
      let node = ref({ key: quoted('foo') }, { type: 'index' });
      expect(`${node}`).toBe('["foo"]');
    });
  });

  describe('get from scope', () => {
    it('should get a variable from scope', async () => {
      let node = rules([
        vardecl({
          name: name('foo'),
          value: any('red')
        }),
        decl({
          name: name('bar'),
          value: ref({ key: 'foo' }, { type: 'variable' })
        })
      ]);
      let evald = await node.eval(context);
      /** The var declaration will be removed when going to CSS */
      expect(`${evald}`).toBeString(`
        bar: red;
      `);
    });

    it('should get a property from scope', async () => {
      let node = rules([
        decl({
          name: name('foo'),
          value: any('red')
        }),
        decl({
          name: name('bar'),
          value: ref({ key: 'foo' }, { type: 'property' })
        })
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        foo: red;
        bar: red;
      `);
    });

    it('should get a var from scope below reference', async () => {
      let node = rules([
        decl({
          name: name('bar'),
          value: ref({ key: 'foo' }, { type: 'variable' })
        }),
        vardecl({
          name: name('foo'),
          value: any('red')
        })
      ]);
      let evald = await node.eval(context);
      /** The var declaration will be removed when going to CSS */
      expect(`${evald}`).toBeString(`
        bar: red;
      `);
    });

    it('should get a prop from scope below reference', async () => {
      let node = rules([
        decl({
          name: name('bar'),
          value: ref({ key: 'foo' }, { type: 'property' })
        }),
        decl({
          name: name('foo'),
          value: any('red')
        })
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        bar: red;
        foo: red;
      `);
    });

    it('should allow recursive referencing', async () => {
      /**
       * $foo: red;
       * $foo: $foo red;
       * bar: $foo;
       */
      let node = rules([
        vardecl({
          name: name('foo'),
          value: any('red')
        }),
        vardecl({
          name: name('foo'),
          value: spaced([expr(ref({ key: 'foo' }, { type: 'variable' })), any('red')])
        }),
        decl({
          name: name('bar'),
          value: ref({ key: 'foo' }, { type: 'variable' })
        })
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        bar: red red;
      `);
    });
  });

  describe('errors', () => {
    it('should throw if the variable is not defined', async () => {
      let node = rules([
        decl({
          name: name('bar'),
          value: ref({ key: 'foo' }, { type: 'variable' })
        })
      ]);
      await expect(async () => await node.eval(context)).rejects.toThrow();
    });
  });
});