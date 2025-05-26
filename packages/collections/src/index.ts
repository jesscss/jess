
export default function atIndex(array: any[], index: number = -1) {
  if (index < 0) {
    return array[index]
  }
  /** Use a negative index to access from the last element */
  return array[array.length - index - 1]
}

export function * getReverse<T>(array: T[]) {
  for (let i = array.length - 1; i >= 0; i--) {
    yield array[i]
  }
}

export function * getReverseEntries<T>(array: T[]) {
  for (let i = array.length - 1; i >= 0; i--) {
    yield [i, array[i]] as const
  }
}