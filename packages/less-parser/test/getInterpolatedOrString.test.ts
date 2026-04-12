import { getInterpolatedOrString } from '../src/utils.js';
import { Quoted, Reference, Interpolated } from '@jesscss/core';

describe('getInterpolatedOrString', () => {
  describe('variable accessor syntax', () => {
    it('should create Interpolated with Reference for @@key', () => {
      const result = getInterpolatedOrString('@@key');
      expect(typeof result).not.toBe('string');
      if (result instanceof Interpolated) {
        expect(result.value.source).not.toContain('@');
        expect(result.value.replacements.length).toBe(1);
        const replacement = result.value.replacements[0];
        if (replacement instanceof Reference) {
          expect(replacement.value.key).toBe('key');
          expect(replacement.options.type).toBe('variable');
        }
      }
    });

    it('should create Interpolated with Reference for @$key', () => {
      const result = getInterpolatedOrString('@$key');
      expect(typeof result).not.toBe('string');
      if (result instanceof Interpolated) {
        expect(result.value.source).not.toContain('@');
        expect(result.value.replacements.length).toBe(1);
        const replacement = result.value.replacements[0];
        if (replacement instanceof Reference) {
          expect(replacement.value.key).toBeInstanceOf(Quoted);
          expect((replacement.value.key as Quoted).value).toBe('key');
          expect(replacement.options.type).toBe('property');
        }
      }
    });

    it('should create Interpolated with Reference for $$key', () => {
      const result = getInterpolatedOrString('$$key');
      expect(typeof result).not.toBe('string');
      if (result instanceof Interpolated) {
        expect(result.value.source).not.toContain('$');
        expect(result.value.replacements.length).toBe(1);
        const replacement = result.value.replacements[0];
        if (replacement instanceof Reference) {
          expect(replacement.value.key).toBeInstanceOf(Quoted);
          expect((replacement.value.key as Quoted).value).toBe('key');
          expect(replacement.options.type).toBe('property');
        }
      }
    });
  });

  describe('normal interpolation', () => {
    it('should create Interpolated for @{variable}', () => {
      const result = getInterpolatedOrString('@{variable}');
      expect(typeof result).not.toBe('string');
      if (result instanceof Interpolated) {
        expect(result.value.source).not.toContain('@');
        expect(result.value.replacements.length).toBe(1);
        const replacement = result.value.replacements[0];
        if (replacement instanceof Reference) {
          expect(replacement.value.key).toBe('variable');
          expect(replacement.options.type).toBe('variable');
        }
      }
    });

    it('should create Interpolated for ${property}', () => {
      const result = getInterpolatedOrString('${property}');
      expect(typeof result).not.toBe('string');
      if (result instanceof Interpolated) {
        expect(result.value.source).not.toContain('$');
        expect(result.value.replacements.length).toBe(1);
        const replacement = result.value.replacements[0];
        if (replacement instanceof Reference) {
          expect(replacement.value.key).toBeInstanceOf(Quoted);
          expect((replacement.value.key as Quoted).value).toBe('property');
          expect(replacement.options.type).toBe('property');
        }
      }
    });
  });

  describe('simple prefixes', () => {
    it('should remove @', () => {
      const result = getInterpolatedOrString('@example');
      expect(result).toBe('example');
    });

    it('should remove $', () => {
      const result = getInterpolatedOrString('$example');
      expect(result).toBe('example');
    });
  });

  describe('normal interpolation', () => {
    it('should create Interpolated for @{variable}', () => {
      const result = getInterpolatedOrString('@{variable}');
      expect(typeof result).not.toBe('string');
      expect((result as Interpolated).type).toBe('Interpolated');
    });

    it('should create Interpolated for ${property}', () => {
      const result = getInterpolatedOrString('${property}');
      expect(typeof result).not.toBe('string');
      expect((result as Interpolated).type).toBe('Interpolated');
    });
  });
});
