export type Operator = '+' | '-' | '*' | '/' | '%'

export function calculate(a: number, op: Operator, b: number) {
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '*': return a * b
    case '/': return a / b
    case '%': return a % b
  }
}