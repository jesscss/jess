import type { ExtendedFn } from '@jesscss/core'
import type { validate } from 'superstruct'

export type { ExtendedFn }

// export function createFn<Args extends any[], F, R>(fn: F extends ExtendedFn<infer Args, infer R> ? ExtendedFn<Args, R> : ExtendedFn<any[], any>) {
//   const returnFn: ExtendedFn<Args, R> = function(this: Context, ...args: Args) {
//     const valid = typia.validate<Args>(args)
//     if (!valid.success || !fn.suppressError) {
//       throw new Error(`error in ${valid.errors[0]?.path}`)
//     }
//     return fn.call(this, ...args) as R
//   }
//   returnFn.suppressError = fn.suppressError
//   returnFn.evalArgs = fn.evalArgs
//   return returnFn
// }

type CheckResult = ReturnType<typeof validate>

export function wrapValidate(
  ...args: CheckResult[]
) {
  const success = args.some(([err]) => !err)
  const errors: Error[] = []
  if (!success) {
    for (let i = 0; i < args.length; i++) {
      let [err] = args[i]!
      if (!err) {
        continue
      }

      let error = err.failures()[0]!
      errors.push(new Error(error.message))
    }
    return errors
  }
  return true
}