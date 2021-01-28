import isPlainObject from 'lodash/isPlainObject'
import { default as lodashMerge } from 'lodash/merge'

/**
 * Use lodash merge for objects, return plain value otherwise
 */
export const merge = (value: any, incomingValue: any) => {
  if (incomingValue === undefined) {
    return value
  }
  if (isPlainObject(value)) {
    if (isPlainObject(incomingValue)) {
      return lodashMerge({}, value, incomingValue)
    }
    return value
  }
  return incomingValue
}