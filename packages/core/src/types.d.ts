/* eslint-disable @typescript-eslint/naming-convention */
/**
 * @see https://github.com/Pyrolistical/consensus-workstation/blob/4102979a7b7f6391bd636c0051722e484185dd02/typings/@bloomberg/record-tuple-polyfill.d.ts
 */
declare module '@bloomberg/record-tuple-polyfill' {
  export type record<T> = T extends Record<string, infer V> ? Record<string, V> : never
  export function Record<T extends Record<string, any>>(t: T): record<T>

  export type tuple<T = any> = T[]
  export const Tuple: (<T>(...ts: T[]) => tuple<T>) & {
    from<T>(ts: T[]): tuple<T>
  }
}