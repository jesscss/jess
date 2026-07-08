import { describe, it, expect } from 'vitest';
import { el, compound } from '../../index.js';
import { runExtendPipeline, type PipelineInstruction, type PipelineSubject } from '../pipeline.js';

describe('pipeline probe — PLAN→SOLVE→EMIT composed (extend-nest .sidebar shape)', () => {
  const instructions: PipelineInstruction[] = [
    { target: el('.sidebar'), extendWith: el('.sidebar2'), partial: false, path: [el('.sidebar2')], order: 1 },
    { target: el('.sidebar'), extendWith: el('.sidebar3'), partial: false, path: [el('.type1'), el('.sidebar3')], order: 2 },
    { target: el('.sidebar'), extendWith: compound([el('.type2'), el('.sidebar4')]), partial: false, path: [compound([el('.type2'), el('.sidebar4')])], order: 3 }
  ];

  it('.sidebar subject → composed 4-branch header', () => {
    const subjects: PipelineSubject[] = [{ id: 'sidebar', path: [el('.sidebar')], order: 0 }];
    const out = runExtendPipeline(subjects, instructions);
    expect(out.fullyOwnBuilt).toBe(true);
    expect(out.subjects[0]!.header).toBe('.sidebar,.sidebar2,.type1 .sidebar3,.type2.sidebar4');
  });

  it('.box nested child → :is()-collapsed header', () => {
    const subjects: PipelineSubject[] = [
      { id: 'box', path: [el('.sidebar')], order: 0, nestedChildLocal: el('.box') }
    ];
    const out = runExtendPipeline(subjects, instructions);
    expect(out.subjects[0]!.header).toBe(':is(.sidebar,.sidebar2,.type1 .sidebar3,.type2.sidebar4) .box');
  });
});
