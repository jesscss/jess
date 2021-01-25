import { tree } from 'jess'

export default function (list: tree.List | tree.Expression | unknown[], mixin: Function) {
  const { List, Expression } = tree
  let collection: unknown[]
  if (list instanceof List || list instanceof Expression) {
    // collection = list.toArray()
  }
}