import { describe, it, expect } from 'vitest';
import {
  F_STATIC,
  any,
  quoted,
  interpolated,
  url,
  el,
  compound,
  attr,
  pseudo,
  amp,
  dimension
} from '../index.js';
import type { Node } from '../index.js';

/**
 * Reader-retirement proof: registration asks a name/selector node whether its
 * identity is fixed at construction (`hasStaticName` / `structuralStaticFlag`)
 * instead of reading the bubbled `F_STATIC`. These lock the predicate to the
 * exact value the constructor/bubble computes so the two can never silently
 * diverge.
 */
describe('static-name predicate', () => {
  describe('hasStaticName matches the name-node constructor F_STATIC decision', () => {
    it('plain-string Quoted is a static name; interpolated/escaped is not', () => {
      const plain = quoted('foo');
      expect(plain.hasStaticName()).toBe(true);
      expect(plain.hasFlag(F_STATIC)).toBe(true);

      const escaped = quoted('foo', { escaped: true });
      expect(escaped.hasStaticName()).toBe(false);
      expect(escaped.hasFlag(F_STATIC)).toBe(false);

      const interp = quoted(interpolated({ source: '%%', replacements: [any('x')] }));
      expect(interp.hasStaticName()).toBe(false);
      expect(interp.hasFlag(F_STATIC)).toBe(false);
    });

    it('Interpolated is never a static name', () => {
      const node = interpolated({ source: '%%', replacements: [any('x')] });
      expect(node.hasStaticName()).toBe(false);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });

    it('Url path is never a static name (base default)', () => {
      const node = url('http://example.com');
      expect(node.hasStaticName()).toBe(false);
    });
  });

  describe('structuralStaticFlag reproduces the bubbled F_STATIC for factory selectors', () => {
    const expectMatch = (node: Node) => {
      expect(node.structuralStaticFlag()).toBe(node.hasFlag(F_STATIC));
    };

    it('static selectors', () => {
      const basic = el('.a');
      expect(basic.structuralStaticFlag()).toBe(true);
      expectMatch(basic);

      const comp = compound([el('.a'), el('.b')]);
      expectMatch(comp);

      const staticAttr = attr({ name: 'type', op: '=', value: any('text') });
      expect(staticAttr.structuralStaticFlag()).toBe(true);
      expectMatch(staticAttr);

      const nthChild = pseudo({ name: ':nth-child', arg: dimension({ number: 2, unit: 'n' }) });
      expectMatch(nthChild);
    });

    it('non-static / no-contribution selectors', () => {
      const interpAttr = attr({
        name: 'data',
        op: '=',
        value: quoted(interpolated({ source: '%%', replacements: [any('x')] }))
      });
      expect(interpAttr.structuralStaticFlag()).toBe(false);
      expectMatch(interpAttr);

      const ampersand = amp();
      expect(ampersand.structuralStaticFlag()).toBe(false);
      expectMatch(ampersand);
    });
  });
});
