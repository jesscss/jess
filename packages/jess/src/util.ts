import isPlainObject from 'lodash/isPlainObject'
import { default as lodashMerge } from 'lodash/merge'

/**
 * Like lodash merge except for non-objects
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