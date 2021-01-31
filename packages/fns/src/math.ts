import { Dimension, Color, Expression, Node, Paren, Anonymous } from 'jess'
/**
 * This mimics Less's operations, preserving units and types
 * as output.
 * 
 * The only export here is the `op` function
 */

type NumericNode = Dimension | Color
type Numeric = NumericNode | number

/** Turn a value into a Numeric Node */
function normalize(val: Numeric): NumericNode {
  return val.constructor === Number ? new Dimension(val) : <NumericNode>val
}

function doMath(op: string, left: number, right: number) {
  switch (op) {
    case '*':
      return left * right
    case '/':
      return left / right
    case '+':
      return left + right
    case '-':
      return left - right
  }
}

function toColor(node: Color | Dimension): Color {
  if (node instanceof Color) {
    return node
  }
  const value = node.value
  return new Color({
    value: '',
    rgba: [value, value, value, 1]
  })
}

function colorOp(op: string, a: Color | Dimension, b: Color | Dimension) {
  let left = toColor(a).rgba
  let right = toColor(b).rgba
  const rgba = new Array(4)
  for(let i = 0; i < 3; i++) {
    rgba[i] = doMath(op, left[i], right[i])
  }
  rgba[3] = left[3] * (1 - right[3]) + right[3]
  return new Color({
    value: '',
    rgba
  })
}

/**
 * Math multiply
 */
function multiply(left: NumericNode, right: NumericNode) {
  if (left.unit && right.unit) {
    throw { message: 'Can\'t multiply a unit by a unit.' }
  }
  for (let i = 0; i < 2; i++) {
    const a = i === 0 ? left : right
    const b = i === 0 ? right : left
    if (a instanceof Color) {
      if (b instanceof Color) {
        throw { message: 'Can\'t multiply colors. Use a color blending function.' }
      }
      if (b.unit) {
        throw { message: 'Can\'t multiply a unit and a color.' }
      }
      return colorOp('*', a, b)
    }
  }
  const aDim: Dimension = <Dimension>left
  const bDim: Dimension = <Dimension>right
  return new Dimension({
    value: aDim.value * bDim.value,
    unit: aDim.unit || bDim.unit
  })
}

/**
 * Math divide
 */
function divide(left: NumericNode, right: NumericNode) {
  if (left instanceof Color) {
    if (right instanceof Color) {
      throw { message: 'Can\'t divide colors. Use a color blending function.' }
    }
    if (right.unit) {
      throw { message: 'Can\'t divide a color by a unit.' }
    }
    return colorOp('/', left, right)
  }
  if (right instanceof Color) {
    throw { message: 'Can\'t divide a dimension by a color.' }
  }
  if (right.unit && left.unit !== right.unit) {
    throw { message: 'Can\'t divide mixed units.' }
  }
  const value = left.value / right.value
  if (left.unit && left.unit === right.unit) {
    /** Cancel units */
    return new Dimension({ value })
  }
  return new Dimension({
    value,
    unit: left.unit
  })
}

/**
 * Math add & subtract
 */
function add(op: string, left: NumericNode, right: NumericNode) {
  if (left instanceof Color || right instanceof Color) {
    return colorOp(op, left, right)
  }

  return new Dimension({
    value: doMath(op, left.value, right.value),
    unit: left.unit || right.unit
  })
}

function operate(
  operator: string,
  a: NumericNode | Paren,
  b: NumericNode | Paren
) {

  const getValue = (node: Paren) => {
    const value = node.value
    if (
      !(value instanceof Expression) &&
      !(value instanceof Dimension) &&
      !(value instanceof Color)
    ) {
      throw { message: 'Not a valid math expression.' }
    }
    return op(value)
  }

  if (a instanceof Paren) {
    a = getValue(a)
  }
  if (b instanceof Paren) {
    b = getValue(b)
  }
  switch (operator) {
    case '*':
      return multiply(a, b)
    case '/':
      return divide(a, b)
    case '+':
    case '-':
      return add(operator, a, b)
  }
}

/**
 * An operation like `2px * (3 + 1)`
 */
export function op(expr: NumericNode | Expression | any[]): NumericNode {
  let values: any[]
  if (expr instanceof Expression) {
    values = expr.toArray()
  } else if (expr instanceof Node) {
    return expr
  } else {
    values = expr
  }
  /**
   * Convert values to Nodes w/ string operators
   */
  values = values.map((v, i) => {
    if (i % 2 === 0) {
      return normalize(v)
    }
    let op: string
    if (v instanceof Anonymous) {
      op = v.value
    } else if (v.constructor === String) {
      op = <string>v
    }
    if (!op || !/[+\-*\/]/.test(op)) {
      throw { message: 'Not a valid math expression.' }
    }
    return op
  })
  if (values.length === 1) {
    return values[0]
  }
  let a = values[0]
  let additionValues: any[] = []
  
  /** Order of operations */
  for (let i = 1; i < values.length; i += 2) {
    let op = values[i]
    let b = values[i + 1]
    if (op === '*' || op === '/') {
      a = operate(op, a, b)
    } else {
      additionValues.push(a, op)
      a = b
    }
  }
  
  if (additionValues.length) {
    additionValues.push(a)
    a = values[0]
    for (let i = 1; i < values.length; i += 2) {
      let op = values[i]
      let b = values[i + 1]
      a = operate(op, a, b)
    }
  }
  return <NumericNode>a
}