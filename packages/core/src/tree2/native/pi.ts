import { makeDimension } from '../value-factory.js';
import type { NativeFn } from './types.js';

/** `pi()` — the constant π as a unitless dimension. */
export const pi: NativeFn = { name: 'pi', params: [], body: () => makeDimension(Math.PI) };
