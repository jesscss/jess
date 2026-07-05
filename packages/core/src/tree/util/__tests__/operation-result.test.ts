import { sourceSpanOf } from '../provenance.js';
import { describe, expect, it } from 'vitest';
import { any } from '../../any.js';
import { finalizeOperationMetadataResult, finalizePublicOperationResult } from '../operation-result.js';

describe('operation result finalization', () => {
  it('uses one public-result boundary for inherited operation metadata', () => {
    const source = any('1px');
    const renderResult = any('2px');
    const publicResult = any('3px');

    expect(finalizePublicOperationResult).toBe(finalizeOperationMetadataResult);
    expect(finalizeOperationMetadataResult(source, renderResult)).toBe(renderResult);
    expect(finalizePublicOperationResult(source, publicResult)).toBe(publicResult);
    expect(sourceSpanOf(publicResult)).toEqual(sourceSpanOf(source));
    expect(publicResult._sourceRoot).toBe(source._sourceRoot);
  });
});
