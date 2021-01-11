import isPlainObject from 'lodash/isPlainObject'

export const assign = (value: any, incomingValue: any) => {
  if (incomingValue === undefined) {
    return value
  }
  if (isPlainObject(value)) {
    if (isPlainObject(incomingValue)) {
      return {
        ...value,
        ...incomingValue
      }
    }
    return value
  }
  return incomingValue
}