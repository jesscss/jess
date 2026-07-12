import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { any, call, decl, mixin, ref, rules } from '../../index.js';
import { getMixinOutputPlacementRecord } from '../mixin-output-slot.js';
import { evaluateCallableCandidateOutput } from '../callable-candidate-output.js';

describe('callable candidate output helper', () => {
  it('skips recursive candidates without disturbing the caller call-map entry', async () => {
    const context = new Context();
    const currentCall = call({
      name: ref({ key: '.loop' }, { type: 'mixin' })
    });
    context.callStack.push(currentCall);
    expect(context.callMap.add(currentCall, 'sig')).toBe(false);

    const candidateParent = rules([]);
    const sourceRules = rules([decl({ name: 'color', value: any('red') })]);
    const candidateRules = rules([decl({ name: 'color', value: any('red') })]);

    const output = await evaluateCallableCandidateOutput({
      context,
      currentCall,
      getParamsSignature: () => 'sig',
      candidateParent,
      candidateIndex: 0,
      rules: candidateRules,
      sourceRules,
      restrictMixinOutputLookup: true
    });

    expect(output).toBeUndefined();
    expect(context.callMap.add(currentCall, 'sig')).toBe(true);
    expect(context.callMap.delete(currentCall)).toBe(true);
    expect(context.callMap.delete(currentCall)).toBe(false);
  });

  it('evaluates candidate rules and attaches mixin output placement state', async () => {
    const context = new Context({ leakyRules: false });
    const sourceRules = rules([decl({ name: 'color', value: any('red') })]);
    const candidate = mixin({
      name: '.demo',
      rules: sourceRules.rules
    });
    const candidateParent = rules([candidate]);
    const candidateRules = rules([decl({ name: 'color', value: any('red') })]);

    const output = await evaluateCallableCandidateOutput({
      context,
      getParamsSignature: () => undefined,
      candidateParent,
      candidateIndex: candidate.index,
      rules: candidateRules,
      sourceRules,
      restrictMixinOutputLookup: true
    });

    expect(output).toBeDefined();
    expect(output?.index).toBe(candidate.index);
    expect(getMixinOutputPlacementRecord(output!)).toEqual({
      source: sourceRules,
      output
    });
  });
});
