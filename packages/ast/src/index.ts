/**
 * Creates a Jess AST from a Chevrotain CST
 */

export function getASTFromCST<T extends CssCstParser = CssCstParser>(
  cst: RequiredCstNode,
  cstParserInstance: T,
  // @ts-expect-error - this is exported correctly, not sure what the problem is
  context: TreeContext = new TreeContext()
): Node {
  const BaseVisitor = cstParserInstance.getBaseCstVisitorConstructor<RequiredCstNode, any>()
  let initialScope = context.scope ??= new Scope()

  const visitor = new Visitor()
  return visitor.visit(cst)
}
