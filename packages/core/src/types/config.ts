import type { FunctionMode, MathMode, UnitMode } from './modes.js';

export type { FunctionMode, MathMode, UnitMode };
export type SelectorPolicyKind = 'class' | 'simple' | 'basic' | 'pseudo' | 'complex' | 'compound' | 'placeholder';
export type ExtendSelectorKind = SelectorPolicyKind;
export type ApplySelectorKind = SelectorPolicyKind;
