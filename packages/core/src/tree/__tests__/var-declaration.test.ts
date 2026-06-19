import { vardecl, coll, decl, any, rules, Node } from '../index.js';
import { Context } from '../../context.js';
import { nil } from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { getPrintOptions, OutputWriter } from '../util/print.js';

class CountingWriter extends OutputWriter {
  reads = 0;

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

class WholeBufferCountingWriter extends OutputWriter {
  wholeBufferReads = 0;

  override getSince(mark: number): string {
    if (mark === 0) {
      this.wholeBufferReads++;
    }
    return super.getSince(mark);
  }
}

let context: Context;

describe('Let', () => {
  beforeAll(() => {
    Node.prototype.fullRender = true;
  });
  afterAll(() => {
    Node.prototype.fullRender = false;
  });
  beforeEach(() => {
    context = new Context();
    context.depth = 1;
  });

  describe('serialization', () => {
    it('should serialize a var declaration', () => {
      context.depth = 2;
      let rule = vardecl({
        name: 'brandColor',
        value: any('#eee')
      });
      expect(rule.toTrimmedString()).toBe('$brandColor: #eee');
    // rule.toModule(context, out)
    // expect(out.toString()).toBe('let brandColor = $J.expr([$J.any("#eee")])')
    });

    it('captures var declaration syntax without outer whole-buffer readback', () => {
      const writer = new WholeBufferCountingWriter();
      const rule = vardecl({
        name: 'brandColor',
        value: any('#eee')
      });

      expect(rule.toTrimmedString({ writer })).toBe('$brandColor: #eee');
      expect(writer.wholeBufferReads).toBe(0);
    });

    it('should serialize a collection', () => {
      context.depth = 2;
      let rule = vardecl({
        name: 'brandColor',
        value: coll([
          decl({ name: 'global', value: coll([
            decl({ name: 'dark', value: any('#000') })
          ]) }),
          decl({ name: 'dark', value: any('#222') }),
          decl({ name: 'light', value: any('#eee') })
        ])
      });
      expect(rule.toTrimmedString()).toBeString(`
      $brandColor: {
        global: {
          dark: #000;
        }
        dark: #222;
        light: #eee;
      }
      `
      );
    // rule.toModule(context, out)
    // expect(out.toString()).toBe('let brandColor = $J.expr([$J.any("#eee")])')
    });

    it('serializes parameter vars without nil defaults as bare bindings', () => {
      const rule = vardecl({
        name: 'tone',
        value: nil()
      }, {
        paramVar: true
      });

      expect(rule.toTrimmedString()).toBe('$tone');
    });

    it('returns bare parameter var syntax without writer readback', () => {
      const writer = new CountingWriter();
      const rule = vardecl({
        name: 'tone',
        value: nil()
      }, {
        paramVar: true
      });

      expect(rule.toTrimmedString({ writer })).toBe('$tone');
      expect(writer.toString()).toBe('$tone');
      expect(writer.reads).toBe(0);
    });

    it('writes bare parameter var names without public string transport', () => {
      const writer = new CountingWriter();
      const name = any('tone');
      let stringCalls = 0;
      name.toString = () => {
        stringCalls++;
        return '';
      };
      const rule = vardecl({
        name,
        value: nil()
      }, {
        paramVar: true
      });

      rule.writeSyntax(getPrintOptions({ writer }));

      expect(writer.toString()).toBe('$tone');
      expect(stringCalls).toBe(0);
    });

    it('renders visible parameter vars through render(context)', () => {
      const rule = vardecl({
        name: 'tone',
        value: nil()
      }, {
        paramVar: true
      });

      expect(rule.render(context)).toBe('$tone');
    });

    it('writes visible parameter vars into render buffers through Declaration', () => {
      const buffer = createRenderBuffer('segmented');
      const rule = vardecl({
        name: 'tone',
        value: nil()
      }, {
        paramVar: true
      });
      const originalResolve = rule.resolve;
      let resolveCalls = 0;
      rule.resolve = function countResolveCalls(
        this: typeof rule,
        ...args: Parameters<typeof originalResolve>
      ): ReturnType<typeof originalResolve> {
        resolveCalls++;
        return originalResolve.apply(this, args);
      };

      expect(rule.render(context, buffer)).toBe('$tone');
      expect(buffer.segments).toEqual(['$tone']);
      expect(resolveCalls).toBe(0);
      expect(rule.evaluated).toBe(false);
      expect(rule.registrationPrepared).toBe(false);
    });

    it('resolves visible parameter vars without touching render state', async () => {
      const rule = vardecl({
        name: 'tone',
        value: nil()
      }, {
        paramVar: true
      });

      const resolved = await rule.resolve(context);

      expect(resolved.toTrimmedString()).toBe('$tone');
      expect(rule.evaluated).toBe(false);
      expect(rule.registrationPrepared).toBe(false);
      expect(context.printState.writer).toBeUndefined();
    });
  });

  // it('should serialize a @let collection', () => {
  //   let rule = set(
  //     keyval({
  //       name: 'brand',
  //       value: coll([
  //         keyval({
  //           name: 'global',
  //           value: coll([
  //             keyval({
  //               name: 'dark',
  //               value: any('#000')
  //             })
  //           ])
  //         }),
  //         keyval({
  //           name: 'dark',
  //           value: any('#222')
  //         }),
  //         keyval({
  //           name: 'light',
  //           value: any('#eee')
  //         })
  //       ])
  //     })
  //   )
  //   expect(`${rule}`).toBe(
  //     '@let brand {\n  global {\n    dark: #000;\n  }\n  dark: #222;\n  light: #eee;\n}'
  //   )
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     'brand = $J.merge({}, $J.get($VARS, \'brand\'))\nbrand.global = {}\nbrand.global.dark = $J.get($VARS, \'brand.global.dark\', $J.any("#000"))\nbrand.dark = $J.get($VARS, \'brand.dark\', $J.any("#222"))\nbrand.light = $J.get($VARS, \'brand.light\', $J.any("#eee"))\n'
  //   )
  // })
});
