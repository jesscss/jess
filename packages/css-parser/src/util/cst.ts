import type { CstNode } from 'chevrotain'

// export const stringify = (cst: CstNode): string => {
//   let output = ''

//   const recurseCst = (node: CstNode): void => {
//     if (!node) {
//       return
//     }
//     if ('name' in node) {
//       if (!node.children) {
//         console.log(node)
//       }
//       node.children.forEach(child => { recurseCst(child) })
//       return
//     }
//     output += node.image
//   }
//   recurseCst(cst)

//   return output
// }