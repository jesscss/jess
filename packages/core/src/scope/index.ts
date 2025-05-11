import { logger } from '../logger'
import { Declaration } from '../tree/declaration'
import { AssignmentType } from '../tree/base-declaration'
import { List } from '../tree/list'
import { type Node } from '../tree/node'
import type { Mixin } from '../tree/mixin'
import isPlainObject from 'lodash-es/isPlainObject'
import { isNode } from '../tree/util'
import { cast } from '../tree/util/cast'
import { Rules } from '../tree/rules'
import type { Bool } from '../tree/bool'
import type { Condition } from '../tree/condition'
import { Context } from '../context'
import type { General } from '../tree/general'
import { BiMap, LinkedList, NodeList } from '../tree/util/collections'
import { Queue } from 'data-structure-typed'
import { type Ruleset } from '../tree'
import { spaced } from '../tree/sequence'

/**
 * The Scope object is meant to be an efficient
 * lookup mechanism for variables, mixins,
 * and other identifiers (including selectors).
 *
 * It leverages the prototype chain for quick scope
 * lookup, and provides a language-agnostic interface
 * for determing behavior when setting identifiers.
 */
export type ScopeEntryOptions = {
  /**
   * These are from JS import statements
   */
  protected?: boolean
  /**
   * Imports from JS/TS are already normalized
   */
  isNormalized?: boolean

  setDefined?: boolean
  setIfUndefined?: boolean
  throwIfDefined?: boolean

  /**
   * Preserve previous entries. Used by Jess/Less for mixins.
   */
  preserve?: boolean

  /**
   * A variable marked private.
   * In SCSS, this is any variable starting with a dash.
   */
  private?: boolean
}

/**
 * We use this to store meta-information
 * about keys / values. For example, values
 * from imports are protected.
 */
export class ScopeEntry<T = unknown> {
  options: ScopeEntryOptions
  key: string
  value: T | undefined

  constructor(key: string, value?: T, opts?: ScopeEntryOptions) {
    this.key = key
    this.value = value
    this.options = opts ?? {}
  }
}

export type MixinEntry = Mixin | Rules
export type ScopeEntryMap<T = unknown> = Record<string, ScopeEntry<T> | undefined>
export type PropMap = Record<string, Declaration | Declaration[]>

/**
 * For JS interoperability,
 * we cannot allow these identifiers
 */
const RESERVED = [
  'enum',
  'implements',
  'interface',
  'let',
  'package',
  'private',
  'protected',
  'public',
  'static'
]

type FilterResult = {
  value: unknown
  done: boolean
}

export type GetterOptions = {
  /** Filter is a function or value to compare when looking up values */
  filter?: Node | ((value: any, foundValues?: any[]) => FilterResult)

  /** Only return local values, not all scope values */
  local?: boolean
  /**
   * Right now used by Less for functions
   */
  suppressUndefinedError?: boolean
}

export type ScopeFilter = (
  entry: ScopeEntry | undefined,
  valueFilter: (value: any, index?: number, entryValue?: any[]) => boolean
) => ({ value: unknown, done: boolean })

/** Arbitrary prefixes to disambiguate names within maps */
export const enum NodeType {
  MIXIN            = '>',
  RULESET          = '*',
  MIXIN_OR_RULESET = '|',
  PROPERTY         = '.',
  VARIABLE         = '?',
  /** No prefix */
  VAR_OR_PROP      = '',
}

export const enum NodeTypeIndex {
  NONE             = 0b000000,
  MIXIN            = 0b000001,
  RULESET          = 0b000010,
  MIXIN_OR_RULESET = 0b000011,
  PROPERTY         = 0b000100,
  VARIABLE         = 0b001000,
  VAR_OR_PROP      = 0b001100,
  /**
   * Variables and mixins can leak
  */
  LEAKY_RULES      = 0b010000,
  /** @note - Properties and rulesets are always visible. */
  PRIVATE_RULES    = 0b100000,
  RULES            = 0b110000
}

type IndexKey = `${NodeTypeIndex}${string}`

interface NodeEntry<T extends Node = Node> {
  node: T
  position: number
  type: NodeTypeIndex | symbol
}

export class Scope {
  /** A map of positions to nodes */
  private nodePositionMap = new BiMap<number, Node>()

  private counter = 0
  /**
   * All indexed collections, keyed. These are the value
   * per scope (like a set of rules).
   * 
   * @note - Types are stored differently for disambiguation
   *         See the Prefix enum.
   */
  private _entryMap: Map<IndexKey | symbol, Queue<NodeEntry>> | undefined
  private get entryMap(): Map<IndexKey | symbol, Queue<NodeEntry>> {
    return (this._entryMap ??= new Map())
  }

  private _genericType(type: NodeTypeIndex): NodeTypeIndex {
    let genericType = 0
    if ((type & NodeTypeIndex.VAR_OR_PROP) === type) {
      genericType = NodeTypeIndex.VAR_OR_PROP
    } else if ((type & NodeTypeIndex.MIXIN_OR_RULESET) === type) {
      genericType = NodeTypeIndex.MIXIN_OR_RULESET
    } else if ((type & NodeTypeIndex.RULES) === type) {
      genericType = NodeTypeIndex.RULES
    }
    return genericType
  }

  private _addToIndex(
    type: NodeTypeIndex,
    node: Node,
    position: number
  ) {
    let genericType = this._genericType(type)
    let key = ''

    if (node.data.has('name')) {
      key = node.data.get('name')!.valueOf()
    } else if (node.data.has('selector')) {
      key = node.data.get('selector')!.valueOf()
    }
    let indexKey: IndexKey = `${genericType}${key}`
    let list = this.entryMap.get(indexKey)
    if (!list) {
      list = new Queue()
      this.entryMap.set(indexKey, list)
    }
    list.push({ node, position, type })
  }

  private _setNode(n: Node, position: number) {
    if (isNode(n, ['Mixin', 'Declaration', 'Ruleset'])) {
      this.nodePositionMap.set(position, n)
      if (isNode(n, 'Declaration')) {
        if (isNode(n, 'VarDeclaration')) {
          this._addToIndex(
            NodeTypeIndex.VARIABLE,
            n,
            position
          )
        } else {
          this._addToIndex(
            NodeTypeIndex.PROPERTY,
            n,
            position
          )
        }
      } else if (isNode(n, 'Mixin')) {
        this._addToIndex(
          NodeTypeIndex.MIXIN,
          n,
          position
        )
      } else {
        this._addToIndex(
          NodeTypeIndex.RULESET,
          n,
          position
        )
      }
    }
  }

  /**
   * 
   * @param n 
   * @param position
   * @param allowRuleLookups For rules, if we're allowed to look for vars and mixins here. 
   */
  set(n: Mixin | Declaration, position: number): void
  set(n: Rules, position: number, allowRuleLookups: boolean): void
  set(n: Node, position: number, allowRuleLookups = false) {
    if (isNode(n, 'Rules')) {
      this.nodePositionMap.set(position, n)
      this._addToIndex(allowRuleLookups ? NodeTypeIndex.LEAKY_RULES : NodeTypeIndex.PRIVATE_RULES, n, position)
    } else {
      this._setNode(n, position)
    }
  }

  push(n: Node) {
    this.set(n, this.counter++)
  }

  /**
   * Finds _all_ matching nodes in the scope chain.
   */
  find(
    key: string,
    type: NodeTypeIndex,
    includeParents = true,
    start?: number
  ) {
    let scope: Scope | undefined = this
    let nodes: Queue<NodeEntry> | undefined
    let genericType = this._genericType(type)
    while (scope) {
      let map = this.entryMap
      let indexKey: IndexKey = `${genericType}${key}`
      let list = map.get(indexKey)
      if (!list) {
        if (!includeParents) {
          return
        }
        scope = scope._parent
        continue
      }
      let bestMatch: number | undefined
      if (start !== undefined) {
        /** Binary search the queue to find a starting position */
        let left = 0, right = list.length - 1

        while (left <= right) {
          let mid = Math.floor((left + right) / 2)
          let midVal = list.at(mid)!.position
          if (midVal === start) {
            break
          }
          if (midVal < start) {
            bestMatch = midVal
            left = mid + 1
          } else {
            right = mid - 1
          }
        }
        if (!bestMatch) {
          if (!includeParents) {
            return
          }
          scope = scope._parent
          continue
        }
      } else {
        /** We didn't have a start position, so the whole list matches */
        bestMatch = list.length - 1
      }
      nodes ??= new Queue()
      for (let i = bestMatch; i >= 0; i--) {
        let entry = list.at(i)!
        if (entry.type === type) {
          nodes.push(entry)
        }
      }

      if (!includeParents) {
        return nodes
      }
      
      scope = scope._parent
    }
    return nodes
  }

  /**
   * Search scope chain for a variable
   * THEN search any leaky rules
   */
  getVar(key: string, start?: number) {
    let result = this.find(key, NodeTypeIndex.VARIABLE, true, start)
    if (!result) {
      const entries = this.find('', NodeTypeIndex.LEAKY_RULES, false, start) as Queue<NodeEntry<Rules>>
      if (entries) {
        for (let entry of entries) {
          let localResult = entry.node.scope.find(key, NodeTypeIndex.VARIABLE, false, start)
          if (localResult) {
            return localResult.last?.node
          }
        }
      }
    }
    return result?.last?.node
  }

  /**
   * Search local scope for a property, looking at any merging rules.
   */
  getProp(key: string, start?: number) {
    let result = (this.find(key, NodeTypeIndex.PROPERTY, true, start) ?? new Queue()) as Queue<NodeEntry<Declaration>>
    let rules = this.find('', NodeTypeIndex.RULES, false, start) as Queue<NodeEntry<Rules>>
    if (rules) {
      for (let entry of rules) {
        let localResult = entry.node.scope.find(key, NodeTypeIndex.PROPERTY, false, start)
        if (localResult) {
          /** Add every entry of the queue in its current position */
          for (let item of localResult) {
            result.push({
              node: item.node as Declaration,
              position: entry.position,
              type: item.type
            })
          }
        }
      }
    }
    /** If we only have 1 result, we're done */
    if (result.length === 1) {
      return result.first!.node
    }
    /** Sort these so they are evaluated in the proper order */
    result.sort((a, b) => a.position - b.position)
    
    let node = result?.last!.node
    /**
     * If the most recent value is not a merge value
     * return this as the only value.
     */
    let assignment = node.options?.assign
    if (!(assignment === AssignmentType.MergeList || assignment === AssignmentType.MergeSequence)) {
      return node
    }

    let length = result.length
    let values: Queue<Node> = new Queue()
    let important: General<'Flag'> | undefined
    let merge: AssignmentType | undefined
    /**
     * Legacy property joining for Less -- note, we need to
     * explicitly wrap values in a list() when parsing
     */
    for (let i = length - 1; i >= 0; i--) {
      let decl = result.at(i)!.node
      let assignment = decl.options?.assign
      if (assignment === AssignmentType.MergeList || assignment === AssignmentType.MergeSequence) {
        merge = assignment
        values.push(decl.value.value)
        if (decl.value.important) {
          important = decl.value.important
        }
      }
    }
    key = result.first!.node.value.name.toString()
    return new Declaration({
      name: key,
      value: merge === AssignmentType.MergeList ? new List(values.toArray()) : spaced(values.toArray()),
      important
    })

  }

  // get(key: string, type: NodeTypeIndex, start?: number) {
  //   let scope: Scope | undefined = this
  //   while (scope) {
  //     let map = this.entryMap
  //     let indexKey: IndexKey = `${type}${key}`
  //     let list = map.get(indexKey)
  //     if (!list && !map.get(RULES_SCOPE)) {
  //       scope = scope._parent
  //       continue
  //     }
  //     let position = list.find(start)
  //     if (position === undefined) {
  //       return
  //     }
  //     scope = scope._parent
  //   }
  // }

  /**
   * A map of selector keys anywhere in a ruleset to contained ruleset selectors
   * (This is used for partial extends)
   */
  private _partialSelectorMap: Map<string, LinkedList> | undefined
  private get partialSelectorMap(): Map<string, LinkedList> {
    return (this._partialSelectorMap ??= new Map())
  }

  /**
   * Includes vars but also
   * imported functions, JS identifiers, etc
   */
  // _vars: ScopeEntryMap
  /**
   * @note - For Jess, we could have stored all
   * mixins in the vars map, but other languages
   * need more dis-ambiguation.
   */
  // _mixins: ScopeEntryMap<MixinEntry>
  // _props: PropMap
  _parent?: Scope

  /**
   * For none found. Use this to distinguish from
   * found but has a value of undefined.
   *
   * Not sure if this is needed, but works.
   */
  static NONE = Symbol('None')

  /**
   * Keys are normalized to camelCase, therefore we should
   * warn when a key is normalized differently
   */
  static entryKeys = new Map<string, string>()
  /** If we already normalized, don't re-normalize */
  static cachedKeys = new Map<string, string>()

  visibleScopes: Set<Scope> | undefined

  constructor(parent?: Scope) {
    this._parent = parent
  }

  /**
   * Normalizes keys as valid JavaScript identifiers.
   *
   * @todo - I don't think we have to normalize storage / lookups. I think this
   * is only a problem when we're exporting to JS, at which point the _lookup_
   * can be normalized.
   */
  normalizeKey(key: string) {
    let cachedKey = Scope.cachedKeys.get(key)
    if (cachedKey) {
      return cachedKey
    }
    /** @todo - can this be a single replace with the replacer function? */
    let normalKey = key
      /** Replace initial dash with underscore */
      .replace(/^-/, '_')
      /** Replace dot-name to lowerCamelCase */
      .replace(/^\.(.+)/g, (_, p1 = '') => `${p1.toLowerCase()}`)
      /** Convert dash-case to camelCase, as well as leading '#' to UpperCamelCase */
      .replace(/(^_)|(?:[#\-_])(.)/g, (_, p1 = '', p2 = '') => `${p1}${p2.toUpperCase()}`)

    if (RESERVED.includes(normalKey)) {
      logger.warn(`"${normalKey}" is a reserved identifier and is not exportable`)
    } else {
      /**
       * Quick way to identify a valid JS identifier -
       * try to create a variable with it.
       *
       * @see https://stackoverflow.com/questions/2008279/validate-a-javascript-function-name
       */
      try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new, no-new-func
        new Function(`let ${normalKey}`)
      } catch (err) {
        logger.warn(`"${key}" is not exportable`)
      }
    }

    let lookupKey = Scope.entryKeys.get(normalKey)
    if (lookupKey) {
      if (lookupKey !== key) {
        logger.warn(`${key} was previously normalized from ${lookupKey}, which could lead to unexpected behaviors.`)
      }
    }
    Scope.cachedKeys.set(key, normalKey)
    return normalKey
  }

  getMixin(key: string, options?: GetterOptions) {
    let mixins = this._getBase('mixins', key, options)
    if (mixins) {
      return getFunctionFromMixins(mixins)
    }
  }

  // getProp(key: string, options: GetterOptions = {}) {
  //   let props: Declaration | Declaration[] = this._getBase('props', key, {
  //     filter(value: Declaration) {
  //       /**
  //        * Find all declarations, in case we need to merge
  //        */
  //       return { value, done: false }
  //     },
  //     ...options
  //   })
  //   /** Our last entry had a merge flag, so collect merges */
  //   if (Array.isArray(props)) {
  //     /**
  //      * If the most recent value is not a merge value
  //      * return this as the only value.
  //      */
  //     let assignment = props[0]!.options?.assign
  //     if (!(assignment === AssignmentType.MergeList || assignment === AssignmentType.MergeSequence)) {
  //       return props[0]
  //     }

  //     let length = props.length
  //     let values: Node[] = []
  //     let important: General<'Flag'> | undefined
  //     let merge: AssignmentType | undefined
  //     /**
  //      * Legacy property joining for Less -- note, we need to
  //      * explicitly wrap values in a list() when parsing
  //      */
  //     for (let i = length - 1; i >= 0; i--) {
  //       let decl = props[i]!
  //       let assignment = decl.options?.assign
  //       if (assignment === AssignmentType.MergeList || assignment === AssignmentType.MergeSequence) {
  //         merge = assignment
  //         values.push(decl.value)
  //         if (decl.important) {
  //           important = decl.important
  //         }
  //       }
  //     }
  //     key = props[0]!.name.toString()
  //     return new Declaration([
  //       ['name', key],
  //       ['value', merge === AssignmentType.MergeList ? new List(values) : new Spaced(values)],
  //       ['important', important]
  //     ])
  //   }

  //   return props
  // }

  // getLocal(
  //   collection: 'property' | 'mixin' | 'variable',
  //   key: string,
  //   options: GetterOptions = {}
  // ) {
  //   let getter: (key: string, options?: GetterOptions) => unknown
  //   options = {
  //     ...options,
  //     local: true
  //   }

  //   switch (collection) {
  //     case 'property':
  //       getter = this.getProp
  //       break
  //     case 'mixin':
  //       getter = this.getMixin
  //       break
  //     case 'variable':
  //       getter = this.getVar
  //       break
  //   }
  //   return getter.call(this, key, options)
  // }

  /**
   * We can pass in a filter to narrow the
   * entries.
   */
  private _getBase(collection: 'mixins', baseKey: string, options?: GetterOptions): MixinEntry | MixinEntry[] | undefined
  private _getBase(collection: 'vars' | 'props', baseKey: string, options?: GetterOptions): any
  private _getBase(collection: 'vars' | 'props' | 'mixins', baseKey: string, options: GetterOptions = {}): any {
    let NONE = Scope.NONE
    let key = this.normalizeKey(baseKey)
    let {
      /** By default, return the first value */
      filter = (value: unknown) => ({ value, done: true })
    } = options

    if (typeof filter !== 'function') {
      let filteredNode = filter
      filter = (value: unknown) => {
        if (value === filteredNode) {
          return { value: NONE, done: false }
        }
        return { value, done: true }
      }
    }
    /**
     * When getting, use the private variable,
     * so we don't extend the prototype chain.
     */
    let current: ScopeEntryMap | PropMap | undefined = this[collection]
    let results: any[] = []

    /**
     * In Less / Jess, mixins are defined / merged per scope
     * We don't climb the prototype chain, and they aren't filtered.
     */
    if (collection === 'mixins') {
      let entry = current[key]
      if (!entry) {
        if (options.suppressUndefinedError) {
          return undefined
        }
        throw new ReferenceError(`"${baseKey}" is not defined`)
      }
      return (entry as unknown as ScopeEntryMap).value
    }
    while (current) {
      let entry = (options.local && !Object.prototype.hasOwnProperty.call(current, key)) ? undefined : current[key]
      if (!entry) {
        if (options.suppressUndefinedError) {
          return undefined
        }
        throw new ReferenceError(`"${baseKey}" is not defined`)
      }
      let entryValue: unknown = collection === 'vars'
        ? (entry as unknown as ScopeEntryMap).value
        : entry
      let lastResult: FilterResult
      if (Array.isArray(entryValue)) {
        for (let i = 0; i < entryValue.length; i++) {
          let val = filter(entryValue[i], results)
          if (val.value !== NONE) {
            results.push(val.value)
          }
          lastResult = val
          if (val.done) {
            break
          }
        }
      } else {
        let val = filter(entryValue, results)
        lastResult = val
        if (val.value !== NONE) {
          results.push(val.value)
        }
      }

      if (lastResult!.done) {
        break
      }
      /** Traverse up the prototype chain */
      current = Object.getPrototypeOf(current)
    }
    let returnResult = results.length
      ? results.length === 1
        ? results[0]
        : results
      : NONE
    if (returnResult === NONE && !options.suppressUndefinedError) {
      throw new ReferenceError(`"${baseKey}" is not defined`)
    }
    return returnResult
  }
}

Scope.entryKeys = new Map()
Scope.cachedKeys = new Map()

/** Returns a plain JS function for calling a set of mixins */
export function getFunctionFromMixins(mixins: MixinEntry | MixinEntry[]) {
  let mixinArr = Array.isArray(mixins) ? mixins : [mixins]
  /**
   * This will be called by a mixin call or by JavaScript
   *
   * @note - Mixins resolve to async functions because they
   * can contain dynamic imports.
   */
  async function returnFunc(this: unknown, ...args: any[]): Promise<Rules | Record<string, string>>
  async function returnFunc(this: Context, ...args: any[]): Promise<Rules>
  async function returnFunc(this: Context | unknown, ...args: any[]) {
    const mixinLength = mixinArr.length
    let mixinCandidates: MixinEntry[] = []
    let evalCandidates: Array<[MixinEntry, number]>
    let thisContext = this instanceof Context ? this : new Context()
    /**
     * Check named and positional arguments
     * against mixins, to see which ones match.
     * (Any mixin with a mis-match of
     * arguments fails.)
     */
    let argEntries = isPlainObject(args[0]) ? Object.entries(args[0]) : null
    for (let i = 0; i < mixinLength; i++) {
      let mixin = mixinArr[i]!
      let isPlainRule = isNode(mixin, 'Rules')
      let paramLength = isPlainRule ? 0 : (mixin as Mixin).params?.length ?? 0
      if (!paramLength) {
        /** Exit early if args were passed in, but no args are possible */
        if (args.length) {
          continue
        }
        mixinCandidates.push(mixin)
      } else {
        /** The mixin has parameters, so let's check args to see if there's a match */
        let params = (mixin as Mixin).params.clone()
        let positions = new Set(params.value.map((_, i) => i))
        /**
         * First argument can be a plain object with named params
         * e.g. { a: 1, b: 2 }
         */
        let argPos = 0
        if (argEntries) {
          argPos = 1
          let namedMap = new Map(argEntries)
          /**
           * We iterate through params instead of args,
           * because we need to track the position
           * of each parameter.
           */
          for (let [i, param] of params) {
            if (isNode(param, 'VarDeclaration')) {
              let key = param.name as string
              let namedValue = namedMap.get(key)
              /** Replace our param value with the passed in named value */
              if (namedValue) {
                params.value[i] = cast(namedValue)
                /**
                 * Because we've assigned a named value, any
                 * positional arguments will be shifted.
                 */
                positions.delete(i)
                namedMap.delete(key)
              } else {
                /** This mixin is not a match */
                break
              }
            }
          }
          if (namedMap.size) {
            /** This mixin is not a match */
            continue
          }
        }
        /**
         * Now we can check remaining positional matches
         * against the remaining parameters.
         */
        if (args.length - argPos !== positions.size) {
          /** This mixin is not a match */
          continue
        }
        let match = true

        for (let i of positions) {
          let arg = args[argPos]
          let param = params.value[i]!
          if (isNode(param, 'VarDeclaration')) {
            param.value = cast(arg)
          } else if (isNode(param, 'Rest')) {
            param.value = new Spaced(args.slice(argPos))
            /** Check a pattern-matching node */
          } else if (param.compare(arg) !== 0) {
            /** This mixin is not a match */
            match = false
            break
          }
          argPos++
        }
        if (match) {
          (mixin as Mixin).params = params
          mixinCandidates.push(mixin)
        }
      }
    }
    /**
     * Alright, we have mixin candidates (mixins that match
     * by arity, pattern, and/or named arguments), now what?
     *
     * First, let's make an evaluation order that evaluates
     * default guards last.
     */
    let hasDefault = false
    evalCandidates = mixinCandidates
      .map<[MixinEntry, number]>(
      (candidate, i) => {
        let isDefault = candidate.options?.hasDefault
        if (isDefault) {
          if (hasDefault) {
            throw new Error('Ambiguous use of default guard found')
          }
          hasDefault = true
        }
        return [candidate, i]
      })

    if (hasDefault) {
      /** There is a default guard, so sort candidates */
      evalCandidates = evalCandidates.slice(0).sort((a, b) => {
        let aNode = a[0]
        let bNode = b[0]
        let aDefault = aNode.options?.hasDefault
        let bDefault = bNode.options?.hasDefault
        /** No guard (or is just a plain ruleset) */
        if (!aDefault && !bDefault) {
          return 0
        }

        if (!aDefault) {
          return 1
        }
        if (!bDefault) {
          return -1
        }
        return 0
      })
    }

    /**
     * Now we have a set of mixins that can return rulesets,
     * but first we need to create a new scope for each mixin,
     * and create variable declarations for each parameter.
     */
    let hasMatch = false
    let outputRules: Array<[Rules, number]> = []
    for (let [candidate, i] of evalCandidates) {
      if (isNode(candidate, 'Rules')) {
        hasMatch = true
        outputRules.push([candidate, i])
        continue
      }
      let rules = candidate.rules
      /**
       * During parsing, each ruleset should have been assigned
       * a scope by the tree context, so we can use that to
       * create a new scope.
       */
      let scope = new Scope(rules.scope)

      /** Now we need to add our parameters, if any */
      let params = candidate.params
      if (params) {
        for (let param of params.value) {
          if (isNode(param, ['VarDeclaration', 'Rest'])) {
            scope.setVar(param.name as string, param.value)
          }
        }
      }
      /** Now we can evaluate our guards, if any */
      let guard: Condition | Bool | undefined = candidate.guard
      let passes = true
      let incomingScope = thisContext.scope
      thisContext.scope = scope
      if (guard) {
        passes = false
        /** All nodes need context to be evaluated */
        thisContext.isDefault = !hasMatch
        guard = await guard.eval(thisContext)
        /** The guard condition passed */
        if (guard.value) {
          passes = true
        }
      }
      if (passes) {
        let newRules = rules.clone()
        newRules.scope = scope
        newRules = await newRules.eval(thisContext)
        outputRules.push([newRules, i])
      }
      thisContext.scope = incomingScope
    }
    /**
     * Now that we have output rules, we sort them by
     * their original order
     */
    let rulesArr = outputRules.sort((a, b) => a[1] - b[1]).map(r => r[0])
    /** Create a rules wrapper */
    let output = new Rules(rulesArr)
    /** Assign vars to new scope */
    rulesArr.forEach(r => {
      output.scope.merge(r.scope)
    })
    /** Now push all rules into the rules value */
    if (this instanceof Context) {
      return output
    } else {
      return output.toObject()
    }
  }

  return returnFunc
}
