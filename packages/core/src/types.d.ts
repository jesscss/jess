/* eslint-disable @typescript-eslint/naming-convention */
/**
 * @see https://github.com/Pyrolistical/consensus-workstation/blob/4102979a7b7f6391bd636c0051722e484185dd02/typings/@bloomberg/record-tuple-polyfill.d.ts
 */
// declare module '@bloomberg/record-tuple-polyfill' {
//   export type record<T> = T extends Record<string, infer V> ? Record<string, V> : never
//   export const Record: (<T extends Record<string, any>>(t: T) => record<T>) & {
//     from<T extends object>(t: T): record<T>
//     isRecord<T>(t: T): t is record<T>
//   }

//   export type tuple<T = any> = readonly T[]
//   export const Tuple: (<T>(...ts: T[]) => tuple<T>) & {
//     from<T>(ts: T[]): tuple<T>
//     isTuple<T>(t: T): t is tuple<T>
//   }
// }

declare interface Set<T> {
  union<U>(b: Set<U>): Set<T | U>
  intersection<U>(b: Set<U>): Set<T | U>
  difference<U>(b: Set<U>): Set<T | U>
  symmetricDifference<U>(b: Set<U>): Set<T | U>
  isSubsetOf<U>(b: Set<U>): boolean
  isSupersetOf<U>(b: Set<U>): boolean
  isDisjointFrom<U>(b: Set<U>): boolean
}
