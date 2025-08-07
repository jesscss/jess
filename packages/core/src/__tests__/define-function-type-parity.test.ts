import { defineFunction as defineFunctionRef } from '../define-function-correct-types';
import { defineFunction as defineFunctionNew } from '../define-function';

// Example usage for type-level assertion
const ref = defineFunctionRef(
  'test',
  (name: string, value: number) => `${name}: ${value}`,
  { params: [
    { name: 'name', type: 'string' },
    { name: 'value', type: 'number' }
  ] }
);

const newFn = defineFunctionNew(
  'test',
  (record: { name: string; value: number }) => `${record.name}: ${record.value}`,
  { params: [
    { name: 'name', type: 'string' },
    { name: 'value', type: 'number' }
  ] }
);

// Type-level assertion: should not error if types are identical
// If this errors, the external API types are not equivalent
// (This is a no-op at runtime, only checked by TypeScript)
type _AssertSame = typeof ref extends typeof newFn
  ? (typeof newFn extends typeof ref ? true : never)
  : never;
