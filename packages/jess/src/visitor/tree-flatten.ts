import { Visitor } from '.'
import type { Node, Root, Ruleset, AtRule, Rule } from '../tree'

export class TreeFlattenVisitor extends Visitor {
  rootRules: Node[] = []

  Rule(n: Rule) {
    this.visit(n.value)
    if (n.value.value.length === 0) {
      return
    }
    return n
  }

  Ruleset(n: Ruleset) {
    const rules = n.value
    const newRules: Node[] = []
    rules.forEach(rule => {
      const newRule = this.visit(rule)
      if (newRule) {
        if (rule.type === 'Rule' || rule.type === 'AtRule') {
          this.rootRules.push(rule)
        } else {
          newRules.push(rule)
        }
      }
    })
    n.value = newRules
    return n
  }
  
  Root(n: Root) {
    const rules = n.value
    const newRules: Node[] = []
    rules.forEach(rule => {
      const newRule = this.visit(rule)
      if (newRule) {
        newRules.push(newRule)
      }
      this.rootRules.forEach(rule => newRules.push(rule))
      this.rootRules = []
    })
    n.value = newRules
    return n
  }

  /**
   * Don't let rooted rules bubble past an at-rule
   *
   * @note
   * It's possible that, in the future, some at-rules
   * can be nested. We'll have to decide how to handle those.
   */
  AtRule(n: AtRule) {
    const ruleset = n.rules
    if (ruleset) {
      this.visit(ruleset)
      const rules = ruleset.value
      this.rootRules.forEach(rule => rules.push(rule))
      this.rootRules = []
    }
    return n
  }
}