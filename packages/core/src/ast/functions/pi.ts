import { makeDimension } from '../value-factory.js';
import type { Fn } from './types.js';

/** `pi()` — the constant π as a unitless dimension. */
export const pi: Fn = { name: 'pi', params: [], body: () => makeDimension(Math.PI) };
