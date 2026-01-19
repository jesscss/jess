/**
 * Minimal Less.js-compatible structures for plugin compatibility
 * These are standalone implementations that don't require the actual Less.js library
 */

/**
 * Less.js Visitor base class (minimal implementation)
 * Plugins expect this structure to exist
 */
import { isLessProxy } from './transform/proxy';

// Debug logging helper (only in debug mode)
const syncLog = process.env.DEBUG ? (data: object) => {
  try {
    // eslint-disable-next-line no-console
    console.log('[LessVisitor]', JSON.stringify(data, null, 2));
  } catch {
    // Ignore errors
  }
} : () => {};

export class LessVisitor {
  // Track nodes being processed to prevent infinite recursion
  private processingNodes = new WeakSet<any>();
  
  constructor(public visitor?: any) {
    // Some plugins pass a visitor instance
  }

  /**
   * Visit a node - handles both modern and legacy Less.js node types
   * Supports Less.js v2 "Directive" nodes (mapped to AtRule)
   *
   * In Less.js v2, at-rules were called "Directive" instead of "AtRule".
   * For compatibility, we route AtRule nodes to visitDirective() if that method exists,
   * allowing v2 plugins to work with modern AtRule nodes.
   */
  visit(node: any, visitArgs?: any): any {
    // #region agent log
    syncLog({location:'less-compat-structures.ts:25',message:'LessVisitor.visit() entry',data:{nodeType:node?.type,hasVisitor:!!this.visitor,visitDeeper:visitArgs?.visitDeeper,alreadyProcessing:this.processingNodes.has(node)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'});
    // #endregion
    if (!node) {
      return node;
    }

    if (!this.visitor) {
      return node;
    }

    // Prevent infinite recursion - if we're already processing this node, skip
    if (this.processingNodes.has(node)) {
      // #region agent log
      syncLog({location:'less-compat-structures.ts:35',message:'Skipping - already processing node',data:{nodeType:node?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'});
      // #endregion
      return node;
    }

    // Mark as processing
    this.processingNodes.add(node);

    // Initialize visitArgs if not provided (Less.js pattern)
    const args = visitArgs || { visitDeeper: true };
    if (args.visitDeeper === undefined) {
      args.visitDeeper = true;
    }

    const nodeType = node.type;
    if (!nodeType || typeof nodeType !== 'string') {
      // Fallback to generic visit if no type
      if (typeof this.visitor.visit === 'function') {
        const result = this.visitor.visit(node, args);
        // Traverse children if visitDeeper is true
        if (args.visitDeeper && node && node.accept) {
          node.accept(this);
        }
        return result;
      }
      return node;
    }

    // Less.js Visitor pattern: look for visit${NodeType} method
    // e.g., visitRuleset, visitDeclaration, visitMedia, etc.
    const visitMethodName = `visit${nodeType}`;
    let result: any = node;
    let visitMethod: ((node: any, args?: any) => any) | undefined;

    if (typeof this.visitor[visitMethodName] === 'function') {
      visitMethod = this.visitor[visitMethodName];
    } else if (nodeType === 'Directive' || nodeType === 'AtRule') {
      // Handle Less.js v2 legacy: Directive -> AtRule
      // Also handle AtRule -> visitDirective for v2 plugin compatibility
      // Check visitDirective first (v2 plugins), then visitAtRule (modern plugins)
      if (typeof this.visitor.visitDirective === 'function') {
        visitMethod = this.visitor.visitDirective;
      } else if (typeof this.visitor.visitAtRule === 'function') {
        visitMethod = this.visitor.visitAtRule;
      }
    } else if (nodeType === 'Rule') {
      // Handle Less.js v2 legacy: Rule -> Declaration
      if (typeof this.visitor.visitRule === 'function') {
        visitMethod = this.visitor.visitRule;
      } else if (typeof this.visitor.visitDeclaration === 'function') {
        visitMethod = this.visitor.visitDeclaration;
      }
    } else if (nodeType === 'Reference') {
      // Reference -> Variable mapping
      if (typeof this.visitor.visitVariable === 'function') {
        visitMethod = this.visitor.visitVariable;
      } else if (typeof this.visitor.visitReference === 'function') {
        visitMethod = this.visitor.visitReference;
      }
    }

    // Call the visit method if found
    if (visitMethod) {
      result = visitMethod.call(this.visitor, node, args);
      // If visitor is replacing and returned a new node, use it
      if (this.visitor.isReplacing && result !== undefined) {
        node = result;
      }
    } else if (typeof this.visitor.visit === 'function') {
      // Fallback to generic visit method
      result = this.visitor.visit(node, args);
      if (this.visitor.isReplacing && result !== undefined) {
        node = result;
      }
    }

    // Less.js pattern: after calling visit method, traverse children if visitDeeper is true
    // This matches Less.js Visitor.visit() behavior
    // CRITICAL: Only call accept() on Less proxies, NOT on Jess nodes
    // Jess nodes' accept() calls visitor.visit() which would cause infinite recursion
    // Less proxies' accept() methods only traverse children, they don't call visitor.visit()
    if (args.visitDeeper && node && node.accept) {
      // #region agent log
      const isProxy = isLessProxy(node);
      syncLog({location:'less-compat-structures.ts:105',message:'Before accept() call',data:{nodeType:node?.type,isLessProxy:isProxy,hasAccept:!!node.accept,visitDeeper:args.visitDeeper},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'});
      // #endregion
      // Only call accept() if this is a Less proxy
      // Less proxies have accept() that traverses children without calling visit()
      if (isProxy) {
        // #region agent log
        syncLog({location:'less-compat-structures.ts:109',message:'Calling node.accept(this)',data:{nodeType:node?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'});
        // #endregion
        node.accept(this);
        // #region agent log
        syncLog({location:'less-compat-structures.ts:112',message:'After accept() call',data:{nodeType:node?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'});
        // #endregion
      }
      // If it's not a Less proxy (it's a Jess node), we should NOT call accept()
      // because Jess's accept() calls visitor.visit() which would recurse
      // Instead, the plugin visitor's visit() method handles Jess node traversal
    }

    // Note: We keep the node in processingNodes for the entire visitor lifetime
    // to prevent re-processing. The WeakSet will be garbage collected when done.
    // #region agent log
    syncLog({location:'less-compat-structures.ts:120',message:'LessVisitor.visit() exit',data:{nodeType:node?.type,resultType:result?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'});
    // #endregion
    return result;
  }

  /**
   * Visit array of nodes
   */
  visitArray(nodes: any[], visitArgs?: any): any[] {
    // #region agent log
    syncLog({location:'less-compat-structures.ts:110',message:'LessVisitor.visitArray() called',data:{nodeCount:nodes?.length,nodeTypes:nodes?.map((n:any)=>n?.type)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'});
    // #endregion
    if (!nodes) { return nodes; }
    return nodes.map(node => this.visit(node, visitArgs));
  }

  /**
   * Visit Directive node (Less.js v2 compatibility)
   * Maps to AtRule for modern Less.js compatibility
   */
  visitDirective(node: any, visitArgs?: any): any {
    // Convert Directive to AtRule-compatible format
    // Less.js v2 used "Directive", modern versions use "AtRule"
    if (node && node.type === 'Directive') {
      // Try visitDirective first (v2 plugins)
      if (this.visitor && typeof this.visitor.visitDirective === 'function') {
        return this.visitor.visitDirective(node, visitArgs);
      }
      // Fallback to visitAtRule (modern plugins)
      if (this.visitor && typeof this.visitor.visitAtRule === 'function') {
        return this.visitor.visitAtRule(node, visitArgs);
      }
    }
    // Default to regular visit
    return this.visit(node, visitArgs);
  }

  /**
   * Visit Rule node (Less.js v2 compatibility)
   * Maps to Declaration for modern Less.js compatibility
   */
  visitRule(node: any, visitArgs?: any): any {
    // Convert Rule to Declaration-compatible format
    // Less.js v2 used "Rule", modern versions use "Declaration"
    if (node && (node.type === 'Rule' || node.type === 'Declaration')) {
      // Try visitRule first (v2 plugins)
      if (this.visitor && typeof this.visitor.visitRule === 'function') {
        return this.visitor.visitRule(node, visitArgs);
      }
      // Fallback to visitDeclaration (modern plugins)
      if (this.visitor && typeof this.visitor.visitDeclaration === 'function') {
        return this.visitor.visitDeclaration(node, visitArgs);
      }
    }
    // Default to regular visit
    return this.visit(node, visitArgs);
  }
}

/**
 * Less.js PluginManager (minimal implementation)
 * Plugins use this to register visitors, pre/post processors, etc.
 */
export class LessPluginManager {
  public visitors: any[] = [];
  public preProcessors: any[] = [];
  public postProcessors: any[] = [];

  constructor(public less: any, public newFactory?: boolean) {
    // Plugins expect this constructor signature
  }

  /**
   * Add a visitor to the manager
   */
  addVisitor(visitor: any): void {
    this.visitors.push(visitor);
  }

  /**
   * Remove a visitor
   */
  removeVisitor(visitor: any): void {
    const index = this.visitors.indexOf(visitor);
    if (index > -1) {
      this.visitors.splice(index, 1);
    }
  }

  /**
   * Add a pre-processor (runs before parsing)
   */
  addPreProcessor(preProcessor: any): void {
    this.preProcessors.push(preProcessor);
  }

  /**
   * Add a post-processor (runs after compilation)
   */
  addPostProcessor(postProcessor: any): void {
    this.postProcessors.push(postProcessor);
  }

  /**
   * Get all visitors
   */
  getVisitors(): any[] {
    return this.visitors;
  }

  /**
   * Get all pre-processors
   */
  getPreProcessors(): any[] {
    return this.preProcessors;
  }

  /**
   * Get all post-processors
   */
  getPostProcessors(): any[] {
    return this.postProcessors;
  }

  /**
   * Register a plugin (Less.js-compatible API)
   * Some plugins use this method instead of install()
   */
  registerPlugin(plugin: any, options?: any): void {
    if (!plugin) {
      return;
    }

    // If plugin has install method, call it first
    // The install method may add the visitor itself via addVisitor()
    if (typeof plugin.install === 'function') {
      plugin.install(this.less, this, this.less.functions.functionRegistry);
    }

    // If plugin is a visitor and not already added, add it
    // Check if it's already in the visitors array to avoid duplicates
    const isVisitor = typeof plugin.visit === 'function' || typeof plugin.visitRuleset === 'function';
    if (isVisitor && !this.visitors.includes(plugin)) {
      this.addVisitor(plugin);
    }
  }
}

/**
 * Less.js tree constructors (minimal implementations)
 * Plugins may access these via functionRegistry.Call, etc.
 */
export const LessTreeConstructors: Record<string, any> = {
  /**
   * Anonymous node constructor
   */
  Anonymous: function(value: any, index?: number, fileInfo?: any) {
    return {
      type: 'Anonymous',
      value,
      index: index || 0,
      fileInfo: fileInfo || {},
      accept: function(visitor: any) {
        return visitor.visit(this);
      },
      toCSS: function() {
        return String(value);
      }
    };
  },

  /**
   * Quoted node constructor
   */
  Quoted: function(quote: string, value: any, escaped?: boolean, index?: number, fileInfo?: any) {
    return {
      type: 'Quoted',
      quote,
      value,
      escaped: !!escaped,
      index: index || 0,
      fileInfo: fileInfo || {},
      accept: function(visitor: any) {
        return visitor.visit(this);
      },
      toCSS: function() {
        return `${quote}${String(value)}${quote}`;
      }
    };
  },

  /**
   * DetachedRuleset node constructor
   * Used by some Less.js plugins (e.g. test-data/plugin-tree-nodes.js)
   */
  DetachedRuleset: function(ruleset: any) {
    return {
      type: 'DetachedRuleset',
      ruleset,
      accept: function(visitor: any) {
        return visitor.visit(this);
      }
    };
  },

  /**
   * Call node constructor
   */
  Call: function(name: string, args: any[], index?: number, fileInfo?: any) {
    return {
      type: 'Call',
      name,
      args: args || [],
      index: index || 0,
      fileInfo: fileInfo || {},
      value: null,
      accept: function(visitor: any) {
        return visitor.visit(this);
      }
    };
  },

  /**
   * Variable node constructor
   */
  Variable: function(name: string, index?: number, fileInfo?: any) {
    return {
      type: 'Variable',
      name,
      index: index || 0,
      fileInfo: fileInfo || {},
      value: null,
      accept: function(visitor: any) {
        return visitor.visit(this);
      }
    };
  },

  /**
   * VariableCall node constructor
   */
  VariableCall: function(name: string, index?: number, fileInfo?: any) {
    return {
      type: 'VariableCall',
      name,
      index: index || 0,
      fileInfo: fileInfo || {},
      value: null,
      accept: function(visitor: any) {
        return visitor.visit(this);
      }
    };
  },

  /**
   * Ruleset node constructor
   */
  Ruleset: function(selectors: any[], rules: any[], strictImports?: boolean, visibilityInfo?: any, fileInfo?: any) {
    return {
      type: 'Ruleset',
      selectors: selectors || [],
      rules: rules || [],
      strictImports,
      visibilityInfo,
      fileInfo: fileInfo || {},
      accept: function(visitor: any) {
        return visitor.visit(this);
      }
    };
  },

  /**
   * Declaration node constructor
   */
  Declaration: function(name: string, value: any, index?: number, fileInfo?: any, variable?: boolean, important?: string) {
    return {
      type: 'Declaration',
      name,
      value,
      index: index || 0,
      fileInfo: fileInfo || {},
      variable: variable || false,
      important: important || '',
      accept: function(visitor: any) {
        return visitor.visit(this);
      }
    };
  },

  /**
   * Dimension node constructor
   */
  Dimension: function(value: number, unit?: string) {
    return {
      type: 'Dimension',
      value,
      unit: unit || '',
      accept: function(visitor: any) {
        return visitor.visit(this);
      }
    };
  },

  /**
   * Color node constructor
   */
  Color: function(rgb: number[], alpha?: number) {
    return {
      type: 'Color',
      rgb: rgb || [0, 0, 0],
      alpha: alpha !== undefined ? alpha : 1,
      accept: function(visitor: any) {
        return visitor.visit(this);
      }
    };
  },

  /**
   * Directive node constructor (Less.js v2 compatibility)
   * In Less.js v2, at-rules were called "Directive" instead of "AtRule"
   * This creates an AtRule-compatible node for backward compatibility
   */
  Directive: function(name: string, value: any, rules?: any[], index?: number, fileInfo?: any) {
    return {
      type: 'Directive', // Keep type as 'Directive' for v2 compatibility
      name: name || '',
      value: value || null,
      rules: rules || [],
      index: index || 0,
      fileInfo: fileInfo || {},
      // Less.js v2 Directive had these methods
      isCharset: function() {
        return this.name === '@charset' || this.name === 'charset';
      },
      isRulesetLike: function() {
        return this.rules && this.rules.length > 0;
      },
      accept: function(visitor: any) {
        // Map visitDirective to visitAtRule for compatibility
        if (visitor.visitDirective) {
          return visitor.visitDirective(this);
        }
        // Fallback to visitAtRule or generic visit
        if (visitor.visitAtRule) {
          return visitor.visitAtRule(this);
        }
        return visitor.visit(this);
      }
    };
  },

  /**
   * Rule node constructor (Less.js v2 compatibility)
   * In Less.js v2, declarations were called "Rule" instead of "Declaration"
   * This creates a Declaration-compatible node for backward compatibility
   */
  Rule: function(name: string, value: any, important?: string, merge?: boolean, index?: number, fileInfo?: any, inline?: boolean, variable?: boolean) {
    return {
      type: 'Rule', // Keep type as 'Rule' for v2 compatibility
      name: name || '',
      value: value || null,
      important: important || '',
      merge: merge || false,
      index: index || 0,
      fileInfo: fileInfo || {},
      inline: inline || false,
      variable: variable !== undefined ? variable : (name && name.charAt && name.charAt(0) === '@'),
      accept: function(visitor: any) {
        // Map visitRule to visitDeclaration for compatibility
        if (visitor.visitRule) {
          return visitor.visitRule(this);
        }
        // Fallback to visitDeclaration or generic visit
        if (visitor.visitDeclaration) {
          return visitor.visitDeclaration(this);
        }
        return visitor.visit(this);
      }
    };
  }
};

/**
 * Create a Less.js-compatible mock object
 * This provides the minimal structure that plugins expect
 */
export function createLessMock(functionRegistry: any) {
  return {
    visitors: {
      Visitor: LessVisitor
    },
    functions: {
      functionRegistry
    },
    tree: LessTreeConstructors,
    PluginLoader: class {},

    // Minimal Less.js function API used by Less.js test plugins
    // These return "Less-like" nodes; Jess-side wrappers convert them as needed.
    dimension(value: number, unit?: string) {
      return LessTreeConstructors.Dimension(value, unit);
    },
    value(values: any[]) {
      return values;
    },
    declaration(name: string, value: any) {
      return LessTreeConstructors.Declaration(name, value);
    },
    ruleset(selector: any, rules: any[]) {
      return LessTreeConstructors.Ruleset([selector], rules);
    },
    detachedruleset(rulesetLike: any) {
      return LessTreeConstructors.DetachedRuleset(rulesetLike);
    },
    atrule(name: string, value: any) {
      return { type: 'AtRule', name, value };
    }
  };
}
