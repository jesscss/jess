(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.jess = {}));
}(this, (function (exports) { 'use strict';

	var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

	function getAugmentedNamespace(n) {
		if (n.__esModule) return n;
		var a = Object.defineProperty({}, '__esModule', {value: true});
		Object.keys(n).forEach(function (k) {
			var d = Object.getOwnPropertyDescriptor(n, k);
			Object.defineProperty(a, k, d.get ? d : {
				enumerable: true,
				get: function () {
					return n[k];
				}
			});
		});
		return a;
	}

	function createCommonjsModule(fn) {
	  var module = { exports: {} };
		return fn(module, module.exports), module.exports;
	}

	var node = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Node = exports.isNodeMap = void 0;
	const isNodeMap = (val) => {
	    return val
	        && typeof val === 'object'
	        && val.constructor === Object
	        && Object.prototype.hasOwnProperty.call(val, 'value');
	};
	exports.isNodeMap = isNodeMap;
	class Node {
	    constructor(value, location, fileInfo) {
	        if (value === undefined) {
	            throw { message: 'Node requires a value.' };
	        }
	        let nodes;
	        let nodeKeys;
	        if (exports.isNodeMap(value)) {
	            nodes = value;
	            nodeKeys = Object.keys(nodes);
	        }
	        else {
	            nodes = { value };
	            nodeKeys = ['value'];
	        }
	        this._nodeKeys = nodeKeys;
	        /** Place all sub-node keys on `this` */
	        nodeKeys.forEach(key => {
	            const value = nodes[key];
	            this[key] = value;
	        });
	        this.location = location || [];
	        this.fileInfo = fileInfo || {};
	    }
	    /**
	     * Mutates node children in place. Used by eval()
	     * which first makes a shallow clone before mutating.
	     */
	    processNodes(func) {
	        const keys = this._nodeKeys;
	        keys.forEach(key => {
	            const nodeVal = this[key];
	            if (nodeVal) {
	                /** Process Node arrays only */
	                if (Array.isArray(nodeVal)) {
	                    const out = [];
	                    for (let i = 0; i < nodeVal.length; i++) {
	                        const node = nodeVal[i];
	                        const result = node instanceof Node ? func(node) : node;
	                        if (result) {
	                            out.push(result);
	                        }
	                    }
	                    this[key] = out;
	                }
	                else if (nodeVal instanceof Node) {
	                    this[key] = func(nodeVal);
	                }
	            }
	        });
	    }
	    accept(visitor) {
	        this.processNodes(n => visitor.visit(n));
	    }
	    /**
	     * Creates a copy of the current node.
	     */
	    clone() {
	        const Clazz = Object.getPrototypeOf(this).constructor;
	        const nodeKeys = this._nodeKeys;
	        const nodes = {};
	        nodeKeys.forEach(key => {
	            nodes[key] = this[key];
	        });
	        const newNode = new Clazz(nodes, this.location, this.fileInfo);
	        /**
	         * Copy added properties on `this`
	         */
	        for (let prop in this) {
	            if (Object.prototype.hasOwnProperty.call(this, prop) && nodeKeys.indexOf(prop) === -1) {
	                newNode[prop] = this[prop];
	            }
	        }
	        /** Copy inheritance props */
	        newNode.inherit(this);
	        return newNode;
	    }
	    eval(context) {
	        if (!this.evaluated) {
	            const node = this.clone();
	            node.processNodes(n => n.eval(context));
	            node.evaluated = true;
	            return node;
	        }
	        return this;
	    }
	    inherit(node) {
	        this.location = node.location;
	        this.fileInfo = node.fileInfo;
	        this.evaluated = node.evaluated;
	        return this;
	    }
	    fround(value) {
	        // add "epsilon" to ensure numbers like 1.000000005 (represented as 1.000000004999...) are properly rounded:
	        return Number((value + 2e-16).toFixed(8));
	    }
	    valueOf() {
	        return this.value;
	    }
	    /** Generate a .css file and .css.map */
	    toCSS(context, out) {
	        const value = this.value;
	        const loc = this.location;
	        if (Array.isArray(value)) {
	            value.forEach(n => {
	                if (n instanceof Node) {
	                    n.toCSS(context, out);
	                }
	                else {
	                    out.add(n.toString(), loc);
	                }
	            });
	        }
	        else {
	            if (value instanceof Node) {
	                value.toCSS(context, out);
	            }
	            else {
	                out.add(value.toString(), loc);
	            }
	        }
	    }
	}
	exports.Node = Node;
	});

	var nil_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.nil = exports.Nil = void 0;

	/**
	 * A Node type that outputs nothing.
	 * We use this for nodes that expect other
	 * nodes in the form of { value: any }
	 */
	class Nil extends node.Node {
	    constructor(value, location) {
	        super('', location);
	    }
	    eval() { return this; }
	    toString() { return ''; }
	    toCSS() { return ''; }
	    toModule() { return ''; }
	}
	exports.Nil = Nil;
	Nil.prototype.allowRoot = true;
	Nil.prototype.allowRuleRoot = true;
	Nil.prototype.type = 'Nil';
	const nil = (value, location) => new Nil(value, location);
	exports.nil = nil;
	});

	var list_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.list = exports.List = void 0;

	/**
	 * A list of expressions
	 *
	 * i.e. one, two, three
	 * or .sel, #id.class, [attr]
	 */
	class List extends node.Node {
	    toArray() {
	        return this.value;
	    }
	    toCSS(context, out) {
	        out.add('', this.location);
	        const length = this.value.length - 1;
	        const pre = context.pre;
	        const cast = context.cast;
	        this.value.forEach((node, i) => {
	            const val = cast(node);
	            val.toCSS(context, out);
	            if (i < length) {
	                if (context.inSelector) {
	                    out.add(`,\n${pre}`);
	                }
	                else {
	                    out.add(', ');
	                }
	            }
	        });
	    }
	    toModule(context, out) {
	        out.add(`$J.list([\n`, this.location);
	        context.indent++;
	        let pre = context.pre;
	        const length = this.value.length - 1;
	        this.value.forEach((node$1, i) => {
	            out.add(pre);
	            if (node$1 instanceof node.Node) {
	                node$1.toModule(context, out);
	            }
	            else {
	                out.add(JSON.stringify(node$1));
	            }
	            if (i < length) {
	                out.add(',\n');
	            }
	        });
	        context.indent--;
	        pre = context.pre;
	        out.add(`\n${pre}])`);
	        return out;
	    }
	}
	exports.List = List;
	List.prototype.type = 'List';
	const list = (value, location) => new List(value, location);
	exports.list = list;
	});

	var dimension_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.num = exports.dimension = exports.Dimension = void 0;

	/**
	 * A number or dimension
	 */
	class Dimension extends node.Node {
	    constructor(value, location) {
	        if (node.isNodeMap(value)) {
	            super(value, location);
	            return;
	        }
	        else if (value.constructor === Number) {
	            super({ value }, location);
	            return;
	        }
	        const regex = /([-+]?[0-9]*(?:\.[0-9]+)?)(%|[a-z]*)/;
	        const found = value.match(regex);
	        if (!found) {
	            throw { message: 'Not a valid dimension.' };
	        }
	        super({
	            value: parseFloat(found[1]),
	            unit: found[2]
	        }, location);
	    }
	    toString() {
	        const precision = 100000000;
	        let { value, unit } = this;
	        value = Math.round(value * precision) / precision;
	        return `${value}${unit || ''}`;
	    }
	    toCSS(context, out) {
	        out.add(this.toString(), this.location);
	    }
	    toModule(context, out) {
	        var _a;
	        const pre = context.pre;
	        out.add(`$J.num({\n`
	            + `  ${pre}value: ${this.value},\n`
	            + `  ${pre}unit: "${(_a = this.unit) !== null && _a !== void 0 ? _a : ''}"\n`
	            + `${pre}})`, this.location);
	    }
	}
	exports.Dimension = Dimension;
	Dimension.prototype.type = 'Dimension';
	const dimension = (...args) => new Dimension(...args);
	exports.dimension = dimension;
	/** alias */
	exports.num = exports.dimension;
	});

	var anonymous = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.anon = exports.Anonymous = void 0;

	/**
	 * A generic value that needs to
	 * be escaped for module output
	 */
	class Anonymous extends node.Node {
	    toModule(context, out) {
	        out.add(`$J.anon(${JSON.stringify(this.value)})`, this.location);
	    }
	}
	exports.Anonymous = Anonymous;
	Anonymous.prototype.type = 'Anonymous';
	const anon = (value, location) => new Anonymous(value, location);
	exports.anon = anon;
	});

	/** Detect free variable `global` from Node.js. */

	var freeGlobal = typeof commonjsGlobal == 'object' && commonjsGlobal && commonjsGlobal.Object === Object && commonjsGlobal;

	var _freeGlobal = freeGlobal;

	/** Detect free variable `self`. */
	var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

	/** Used as a reference to the global object. */
	var root = _freeGlobal || freeSelf || Function('return this')();

	var _root = root;

	/** Built-in value references. */
	var Symbol = _root.Symbol;

	var _Symbol = Symbol;

	/** Used for built-in method references. */
	var objectProto = Object.prototype;

	/** Used to check objects for own properties. */
	var hasOwnProperty = objectProto.hasOwnProperty;

	/**
	 * Used to resolve the
	 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
	 * of values.
	 */
	var nativeObjectToString = objectProto.toString;

	/** Built-in value references. */
	var symToStringTag = _Symbol ? _Symbol.toStringTag : undefined;

	/**
	 * A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
	 *
	 * @private
	 * @param {*} value The value to query.
	 * @returns {string} Returns the raw `toStringTag`.
	 */
	function getRawTag(value) {
	  var isOwn = hasOwnProperty.call(value, symToStringTag),
	      tag = value[symToStringTag];

	  try {
	    value[symToStringTag] = undefined;
	    var unmasked = true;
	  } catch (e) {}

	  var result = nativeObjectToString.call(value);
	  if (unmasked) {
	    if (isOwn) {
	      value[symToStringTag] = tag;
	    } else {
	      delete value[symToStringTag];
	    }
	  }
	  return result;
	}

	var _getRawTag = getRawTag;

	/** Used for built-in method references. */
	var objectProto$1 = Object.prototype;

	/**
	 * Used to resolve the
	 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
	 * of values.
	 */
	var nativeObjectToString$1 = objectProto$1.toString;

	/**
	 * Converts `value` to a string using `Object.prototype.toString`.
	 *
	 * @private
	 * @param {*} value The value to convert.
	 * @returns {string} Returns the converted string.
	 */
	function objectToString(value) {
	  return nativeObjectToString$1.call(value);
	}

	var _objectToString = objectToString;

	/** `Object#toString` result references. */
	var nullTag = '[object Null]',
	    undefinedTag = '[object Undefined]';

	/** Built-in value references. */
	var symToStringTag$1 = _Symbol ? _Symbol.toStringTag : undefined;

	/**
	 * The base implementation of `getTag` without fallbacks for buggy environments.
	 *
	 * @private
	 * @param {*} value The value to query.
	 * @returns {string} Returns the `toStringTag`.
	 */
	function baseGetTag(value) {
	  if (value == null) {
	    return value === undefined ? undefinedTag : nullTag;
	  }
	  return (symToStringTag$1 && symToStringTag$1 in Object(value))
	    ? _getRawTag(value)
	    : _objectToString(value);
	}

	var _baseGetTag = baseGetTag;

	/**
	 * Creates a unary function that invokes `func` with its argument transformed.
	 *
	 * @private
	 * @param {Function} func The function to wrap.
	 * @param {Function} transform The argument transform.
	 * @returns {Function} Returns the new function.
	 */
	function overArg(func, transform) {
	  return function(arg) {
	    return func(transform(arg));
	  };
	}

	var _overArg = overArg;

	/** Built-in value references. */
	var getPrototype = _overArg(Object.getPrototypeOf, Object);

	var _getPrototype = getPrototype;

	/**
	 * Checks if `value` is object-like. A value is object-like if it's not `null`
	 * and has a `typeof` result of "object".
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
	 * @example
	 *
	 * _.isObjectLike({});
	 * // => true
	 *
	 * _.isObjectLike([1, 2, 3]);
	 * // => true
	 *
	 * _.isObjectLike(_.noop);
	 * // => false
	 *
	 * _.isObjectLike(null);
	 * // => false
	 */
	function isObjectLike(value) {
	  return value != null && typeof value == 'object';
	}

	var isObjectLike_1 = isObjectLike;

	/** `Object#toString` result references. */
	var objectTag = '[object Object]';

	/** Used for built-in method references. */
	var funcProto = Function.prototype,
	    objectProto$2 = Object.prototype;

	/** Used to resolve the decompiled source of functions. */
	var funcToString = funcProto.toString;

	/** Used to check objects for own properties. */
	var hasOwnProperty$1 = objectProto$2.hasOwnProperty;

	/** Used to infer the `Object` constructor. */
	var objectCtorString = funcToString.call(Object);

	/**
	 * Checks if `value` is a plain object, that is, an object created by the
	 * `Object` constructor or one with a `[[Prototype]]` of `null`.
	 *
	 * @static
	 * @memberOf _
	 * @since 0.8.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a plain object, else `false`.
	 * @example
	 *
	 * function Foo() {
	 *   this.a = 1;
	 * }
	 *
	 * _.isPlainObject(new Foo);
	 * // => false
	 *
	 * _.isPlainObject([1, 2, 3]);
	 * // => false
	 *
	 * _.isPlainObject({ 'x': 0, 'y': 0 });
	 * // => true
	 *
	 * _.isPlainObject(Object.create(null));
	 * // => true
	 */
	function isPlainObject(value) {
	  if (!isObjectLike_1(value) || _baseGetTag(value) != objectTag) {
	    return false;
	  }
	  var proto = _getPrototype(value);
	  if (proto === null) {
	    return true;
	  }
	  var Ctor = hasOwnProperty$1.call(proto, 'constructor') && proto.constructor;
	  return typeof Ctor == 'function' && Ctor instanceof Ctor &&
	    funcToString.call(Ctor) == objectCtorString;
	}

	var isPlainObject_1 = isPlainObject;

	var context = createCommonjsModule(function (module, exports) {
	var __importDefault = (commonjsGlobal && commonjsGlobal.__importDefault) || function (mod) {
	    return (mod && mod.__esModule) ? mod : { "default": mod };
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Context = exports.generateId = void 0;





	const isPlainObject_1$1 = __importDefault(isPlainObject_1);
	const idChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');
	const generateId = (length = 8) => {
	    let str = '';
	    for (let i = 0; i < length; i++) {
	        str += idChars[Math.floor(Math.random() * idChars.length)];
	    }
	    return str;
	};
	exports.generateId = generateId;
	class Context {
	    constructor(opts = {}) {
	        this.varCounter = 0;
	        this.originalOpts = opts;
	        this.opts = opts;
	        this.id = exports.generateId();
	        this.frames = [];
	        this.exports = new Set();
	        this.indent = 0;
	        this.rootLevel = 0;
	        this.classMap = Object.create(null);
	        this.rootRules = [];
	    }
	    get pre() {
	        return Array(this.indent + 1).join('  ');
	    }
	    /** Hash a CSS class name or not depending on the `module` setting */
	    hashClass(name) {
	        /** Remove dot for mapping */
	        name = name.slice(1);
	        const lookup = this.classMap[name];
	        if (lookup) {
	            return `.${lookup}`;
	        }
	        let mapVal;
	        if (this.opts.module) {
	            mapVal = `${name}_${this.id}`;
	        }
	        else {
	            mapVal = name;
	        }
	        this.classMap[name] = mapVal;
	        return `.${mapVal}`;
	    }
	    getVar() {
	        return `--v${this.id}-${this.varCounter++}`;
	    }
	    /**
	     * Casts a primitive value to a Jess node
	     * (if not already). This is for CSS output.
	     *
	     * @example
	     * cast(area(5))
	     */
	    cast(value) {
	        if (value === undefined || value === null) {
	            return new nil_1.Nil;
	        }
	        if (value instanceof node.Node) {
	            return value;
	        }
	        if (isPlainObject_1$1.default(value)) {
	            if (Object.prototype.hasOwnProperty.call(value, '$root')) {
	                return value.$root;
	            }
	            return new anonymous.Anonymous('[object]');
	        }
	        if (Array.isArray(value)) {
	            return new list_1.List(value);
	        }
	        if (value.constructor === Number) {
	            return new dimension_1.Dimension(value);
	        }
	        return new anonymous.Anonymous(value.toString());
	    }
	}
	exports.Context = Context;
	});

	var output = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.OutputCollector = void 0;
	class OutputCollector {
	    constructor() {
	        this.strings = [];
	        this.map = [];
	        /** @todo - for output tracking */
	        this.line = 0;
	        this.column = 0;
	    }
	    add(str, originalLocation) {
	        this.strings.push(str);
	        /**
	         * @todo
	         * @see https://hacks.mozilla.org/2013/05/compiling-to-javascript-and-debugging-with-source-maps/
	         * @see https://github.com/mozilla/source-map
	         */
	        if (originalLocation) {
	            this.map.push(originalLocation);
	        }
	    }
	    toString() {
	        return this.strings.join('');
	    }
	}
	exports.OutputCollector = OutputCollector;
	});

	var jsNode = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.JsNode = void 0;

	/**
	 * A super-type for inheritance checks
	 */
	class JsNode extends node.Node {
	}
	exports.JsNode = JsNode;
	});

	var ampersand = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.amp = exports.Ampersand = void 0;


	/**
	 * The '&' selector element
	 */
	class Ampersand extends node.Node {
	    constructor(value, location) {
	        value = value || '&';
	        super(value, location);
	    }
	    /** Return the parent selector from context */
	    eval(context) {
	        const frame = context.frames[0];
	        if (frame) {
	            return frame.clone();
	        }
	        return new nil_1.Nil();
	    }
	    toModule(context, out) {
	        out.add(`$J.amp()`, this.location);
	    }
	}
	exports.Ampersand = Ampersand;
	Ampersand.prototype.type = 'Ampersand';
	const amp = (value, location) => new Ampersand(value, location);
	exports.amp = amp;
	});

	var declaration = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.decl = exports.Declaration = void 0;


	/**
	 * A continuous collection of nodes
	 */
	class Declaration extends node.Node {
	    constructor(value, location) {
	        const name = value.name;
	        if (name.constructor === String) {
	            value.name = new anonymous.Anonymous(name);
	        }
	        super(value, location);
	    }
	    eval(context) {
	        const node = this.clone();
	        node.name = this.name.eval(context);
	        node.value = context.cast(this.value).eval(context);
	        if (node.important) {
	            node.important = new anonymous.Anonymous(this.important.value);
	        }
	        return node;
	    }
	    toCSS(context, out) {
	        this.name.toCSS(context, out);
	        out.add(': ');
	        context.cast(this.value).toCSS(context, out);
	        if (this.important) {
	            out.add(' ');
	            this.important.toCSS(context, out);
	        }
	        out.add(';');
	    }
	    toModule(context, out) {
	        let pre = context.pre;
	        const loc = this.location;
	        out.add(`$J.decl({\n`, loc);
	        context.indent++;
	        out.add(`  ${pre}name: `);
	        this.name.toModule(context, out);
	        out.add(`,\n  ${pre}value: `);
	        this.value.toModule(context, out);
	        if (this.important) {
	            out.add(`,\n  ${pre}important: `);
	            this.important.toModule(context, out);
	        }
	        context.indent--;
	        out.add(`\n${pre}})`);
	    }
	}
	exports.Declaration = Declaration;
	Declaration.prototype.allowRuleRoot = true;
	Declaration.prototype.type = 'Declaration';
	const decl = (value, location) => new Declaration(value, location);
	exports.decl = decl;
	});

	var jsExpr = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.js = exports.JsExpr = void 0;


	/**
	 * A JS expression
	 * (compile-time node)
	 *
	 * @example
	 * $variable
	 * $(func(arg1, arg2))
	 */
	class JsExpr extends node.Node {
	    getValue() {
	        const { value, post } = this;
	        if (post) {
	            return `${value} + '${post}'`;
	        }
	        return value;
	    }
	    getVar(context) {
	        context.rootRules.push(new declaration.Declaration({
	            name: context.getVar(),
	            value: this
	        }));
	    }
	    toCSS(context, out) {
	        out.add('[[JS]]', this.location);
	    }
	    toModule(context, out) {
	        out.add(this.getValue(), this.location);
	    }
	}
	exports.JsExpr = JsExpr;
	JsExpr.prototype.type = 'JsExpr';
	const js = (value, location) => new JsExpr(value, location);
	exports.js = js;
	});

	var jsIdent = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.ident = exports.JsIdent = exports.JsReservedWords = void 0;


	exports.JsReservedWords = [
	    'abstract', 'arguments',
	    'await', 'boolean',
	    'break', 'byte',
	    'case', 'catch',
	    'char', 'class',
	    'const', 'continue',
	    'debugger', 'default',
	    'delete', 'do',
	    'double', 'else',
	    'enum', 'eval',
	    'export', 'extends',
	    'false', 'final',
	    'finally', 'float',
	    'for', 'function',
	    'goto', 'if',
	    'implements', 'import',
	    'in', 'instanceof',
	    'int', 'interface',
	    'let', 'long',
	    'native', 'new',
	    'null', 'package',
	    'private', 'protected',
	    'public', 'return',
	    'short', 'static',
	    'super', 'switch',
	    'synchronized', 'this',
	    'throw', 'throws',
	    'transient', 'true',
	    'try', 'typeof',
	    'undefined',
	    'var', 'void',
	    'volatile', 'while',
	    'with', 'yield'
	];
	/**
	 * A super-type for inheritance checks
	 */
	class JsIdent extends jsNode.JsNode {
	    constructor(value, location) {
	        let name;
	        if (node.isNodeMap(value)) {
	            name = value.value;
	        }
	        else {
	            name = value;
	        }
	        if (name.includes('-')) {
	            throw {
	                message: 'Dashes are not allowed in JS identifiers.'
	            };
	        }
	        if (exports.JsReservedWords.includes(name)) {
	            throw {
	                message: `'${name}' is a reserved word.`
	            };
	        }
	        super(name, location);
	    }
	    toModule(context, out) {
	        out.add(this.value);
	    }
	}
	exports.JsIdent = JsIdent;
	JsIdent.prototype.type = 'JsIdent';
	const ident = (value, location) => new JsIdent(value, location);
	exports.ident = ident;
	});

	var call_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.call = exports.Call = void 0;



	/**
	 * A function call
	 */
	class Call extends node.Node {
	    eval(context) {
	        let ref;
	        try {
	            /** Try to get a function reference in the current scope */
	            ref = this.ref();
	        }
	        catch (e) {
	            /** We didn't find it, so output as CSS */
	            const call = this.clone();
	            call.value = call.value.eval(context);
	            return call;
	        }
	        if (!ref) {
	            const call = this.clone();
	            call.value = call.value.eval(context);
	            return call;
	        }
	        const value = this.value;
	        let args;
	        if (value instanceof list_1.List) {
	            args = value.value;
	        }
	        else {
	            args = [value];
	        }
	        /**
	         * @todo
	         * Like Less, allow late evaluation?
	         */
	        args = args.map(arg => arg && arg instanceof node.Node ? arg.eval(context) : arg);
	        /**
	         * The proxied default function returns hashed classes as props,
	         * so to not cause conflicts, Function props like `call` are aliased
	         * as `__call`
	         */
	        const returnVal = ref['$IS_PROXY'] === true
	            ? ref.__call(context, args[0], true)
	            : ref.call(context, ...args);
	        return returnVal instanceof node.Node ? returnVal.eval(context) : returnVal;
	    }
	    toCSS(context, out) {
	        out.add(`${this.name}(`, this.location);
	        this.value.toCSS(context, out);
	        out.add(')');
	    }
	    toModule(context, out) {
	        const name = this.name;
	        out.add(`$J.call({\n`, this.location);
	        context.indent++;
	        let pre = context.pre;
	        out.add(`${pre}name: ${JSON.stringify(name)},\n`);
	        out.add(`${pre}value: `);
	        this.value.toModule(context, out);
	        out.add(`,\n`);
	        /**
	         * @todo - in the future, get a list of imported and defined JS idents
	         * to determine this part of output. For Alpha, we do a try / catch
	         * on the name to determine if it's a JS function call.
	         */
	        if (!(jsIdent.JsReservedWords.includes(name)) && !(name.includes('-'))) {
	            out.add(`${pre}ref: () => ${name},\n`);
	        }
	        context.indent--;
	        pre = context.pre;
	        out.add(`${pre}})`);
	    }
	}
	exports.Call = Call;
	Call.prototype.type = 'Call';
	const call = (...args) => new Call(...args);
	exports.call = call;
	});

	var ruleset_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.ruleset = exports.Ruleset = void 0;







	/**
	 * A set of nodes (usually declarations)
	 * Used by Rule and Mixin
	 *
	 * @example
	 * color: black;
	 * background-color: white;
	 */
	class Ruleset extends node.Node {
	    eval(context) {
	        if (!this.evaluated) {
	            const rule = this.clone();
	            const rules = [];
	            this.value.forEach(rule => {
	                rule = rule.eval(context);
	                if (rule && !(rule instanceof nil_1.Nil)) {
	                    if (rule.type === 'Rule' || rule.type === 'AtRule') {
	                        context.rootRules.push(rule);
	                    }
	                    else if (rule instanceof Ruleset) {
	                        rules.push(...rule.value);
	                    }
	                    else {
	                        rules.push(rule);
	                    }
	                }
	            });
	            rule.value = rules;
	            rule.evaluated = true;
	            return rule;
	        }
	        return this;
	    }
	    toCSS(context, out) {
	        const value = this.value;
	        out.add('{\n');
	        context.indent++;
	        let pre = context.pre;
	        value.forEach(v => {
	            out.add(pre);
	            v.toCSS(context, out);
	            out.add('\n');
	        });
	        context.indent--;
	        pre = context.pre;
	        out.add(`${pre}}`);
	    }
	    toModule(context, out) {
	        const rootLevel = context.rootLevel;
	        context.rootLevel = 2;
	        out.add(`$J.ruleset(\n`, this.location);
	        context.indent++;
	        let pre = context.pre;
	        out.add(`${pre}(() => {\n`);
	        context.indent++;
	        out.add(`  ${pre}const $OUT = []\n`);
	        this.value.forEach((node, i) => {
	            out.add(`  ${pre}`);
	            if (node instanceof jsNode.JsNode) {
	                node.toModule(context, out);
	                out.add('\n');
	            }
	            else if (node instanceof declaration.Declaration && context.opts.dynamic) {
	                /**
	                 * Creates either runtime vars or var() depending on settings
	                 */
	                const n = node.clone();
	                const process = (n) => {
	                    if (n instanceof jsExpr.JsExpr || n instanceof call_1.Call) {
	                        if (n instanceof call_1.Call) {
	                            n.processNodes(process);
	                        }
	                        if (context.isRuntime) {
	                            context.rootRules.push(new declaration.Declaration({
	                                name: context.getVar(),
	                                value: n
	                            }));
	                            return n;
	                        }
	                        return new call_1.Call({
	                            name: 'var',
	                            value: new list_1.List([
	                                context.getVar(),
	                                n
	                            ])
	                        });
	                    }
	                    n.processNodes(process);
	                    return n;
	                };
	                n.processNodes(process);
	                if (context.isRuntime) {
	                    context.rootRules.forEach(n => {
	                        out.add(`$OUT.push(`);
	                        n.toModule(context, out);
	                        out.add(`)\n`);
	                    });
	                    context.rootRules = [];
	                }
	                else {
	                    out.add(`$OUT.push(`);
	                    n.toModule(context, out);
	                    out.add(`)\n`);
	                }
	            }
	            else {
	                out.add(`$OUT.push(`);
	                node.toModule(context, out);
	                out.add(`)\n`);
	            }
	        });
	        out.add(`  ${pre}return $OUT\n${pre}})()`);
	        context.indent -= 2;
	        pre = context.pre;
	        out.add(`\n${pre})`);
	        context.rootLevel = rootLevel;
	    }
	}
	exports.Ruleset = Ruleset;
	Ruleset.prototype.allowRuleRoot = true;
	Ruleset.prototype.type = 'Ruleset';
	const ruleset = (value, location) => new Ruleset(value, location);
	exports.ruleset = ruleset;
	});

	var rule_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.rule = exports.Rule = void 0;



	/**
	 * A qualified rule
	 * @example
	 * .box {
	 *   color: black;
	 * }
	 */
	class Rule extends node.Node {
	    constructor(value, location) {
	        const val = value.value;
	        if (Array.isArray(val)) {
	            value.value = new ruleset_1.Ruleset(val);
	        }
	        super(value, location);
	    }
	    eval(context) {
	        if (!this.evaluated) {
	            const rule = this.clone();
	            const sels = this.sels.eval(context);
	            rule.sels = sels;
	            context.frames.unshift(sels);
	            rule.value = this.value.eval(context);
	            context.frames.shift();
	            rule.evaluated = true;
	            /** Remove empty rules */
	            if (rule.value.value.length === 0) {
	                return new nil_1.Nil();
	            }
	            return rule;
	        }
	        return this;
	    }
	    toCSS(context, out) {
	        const { sels, value } = this;
	        context.inSelector = true;
	        sels.toCSS(context, out);
	        context.inSelector = false;
	        out.add(' ');
	        value.toCSS(context, out);
	    }
	    toModule(context, out) {
	        out.add(`$J.rule({\n`, this.location);
	        context.indent++;
	        let pre = context.pre;
	        out.add(`${pre}sels: `);
	        this.sels.toModule(context, out);
	        out.add(`,\n${pre}value: `);
	        this.value.toModule(context, out);
	        context.indent--;
	        out.add(`},${JSON.stringify(this.location)})`);
	    }
	}
	exports.Rule = Rule;
	Rule.prototype.allowRoot = true;
	Rule.prototype.type = 'Rule';
	const rule = (value, location) => new Rule(value, location);
	exports.rule = rule;
	});

	var atRule = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.atrule = exports.AtRule = void 0;




	/**
	 * A rule like @charset or @media
	 */
	class AtRule extends node.Node {
	    eval(context) {
	        const node = super.eval(context);
	        /** Don't let rooted rules bubble past an at-rule */
	        if (node.rules) {
	            let rules = node.rules.value;
	            /** Wrap sub-rules of a media query like Less */
	            if (context.frames.length !== 0) {
	                const rule = new rule_1.Rule({ sels: new list_1.List([new ampersand.Ampersand()]), value: rules })
	                    .inherit(this)
	                    .eval(context);
	                rules = [rule];
	                node.rules.value = rules;
	            }
	            context.rootRules
	                .sort((a, b) => a.location[0] - b.location[0])
	                .forEach(rule => rules.push(rule));
	            context.rootRules = [];
	        }
	        return node;
	    }
	    toCSS(context, out) {
	        out.add(`${this.name}`, this.location);
	        /** Prelude expression includes white space */
	        const value = this.value;
	        if (value) {
	            value.toCSS(context, out);
	        }
	        if (this.rules) {
	            this.rules.toCSS(context, out);
	        }
	        else {
	            out.add(';');
	        }
	    }
	    toModule(context, out) {
	        out.add(`$J.atrule({\n`, this.location);
	        let pre = context.pre;
	        context.indent++;
	        out.add(`${pre}  name: ${JSON.stringify(this.name)}`);
	        const value = this.value;
	        if (value) {
	            out.add(`,\n${pre}  value: `);
	            value.toModule(context, out);
	        }
	        const rules = this.rules;
	        if (rules) {
	            out.add(`,\n${pre}  rules: `);
	            rules.toModule(context, out);
	        }
	        context.indent--;
	        out.add(`\n${pre}},${JSON.stringify(this.location)})`);
	    }
	}
	exports.AtRule = AtRule;
	AtRule.prototype.allowRoot = true;
	AtRule.prototype.type = 'AtRule';
	const atrule = (value, location) => new AtRule(value, location);
	exports.atrule = atrule;
	});

	var color_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.color = exports.Color = void 0;

	function clamp(v, max) {
	    return Math.min(Math.max(v, 0), max);
	}
	class Color extends node.Node {
	    constructor(val, location) {
	        if (node.isNodeMap(val)) {
	            const { value, rgba } = val;
	            super({ value }, location);
	            this._rgba = rgba;
	            return;
	        }
	        super({ value: val }, location);
	    }
	    /** Create an rgba map only if we need it */
	    get rgba() {
	        if (!this._rgba) {
	            const value = this.value;
	            const rgba = [];
	            if (value.charAt(0) !== '#') {
	                throw new Error(`Only hex string values can be converted to colors.`);
	            }
	            const hex = value.slice(1);
	            if (hex.length >= 6) {
	                hex.match(/.{2}/g).map((c, i) => {
	                    if (i < 3) {
	                        rgba.push(parseInt(c, 16));
	                    }
	                    else {
	                        rgba.push(parseInt(c, 16) / 255);
	                    }
	                });
	            }
	            else {
	                hex.split('').map((c, i) => {
	                    if (i < 3) {
	                        rgba.push(parseInt(c + c, 16));
	                    }
	                    else {
	                        rgba.push(parseInt(c + c, 16) / 255);
	                    }
	                });
	            }
	            /** Make sure an alpha value is present */
	            if (rgba.length === 3) {
	                rgba.push(1);
	            }
	            this._rgba = rgba;
	            return rgba;
	        }
	        return this._rgba;
	    }
	    get rgb() {
	        const [r, g, b] = this.rgba;
	        return [r, g, b];
	    }
	    get alpha() {
	        return this.rgba[3];
	    }
	    toHex() {
	        return `#${this.rgb.map(c => {
            c = clamp(Math.round(c), 255);
            return (c < 16 ? '0' : '') + c.toString(16);
        }).join('')}`;
	    }
	    toHSL() {
	        const r = this.rgb[0] / 255;
	        const g = this.rgb[1] / 255;
	        const b = this.rgb[2] / 255;
	        const a = this.alpha;
	        const max = Math.max(r, g, b);
	        const min = Math.min(r, g, b);
	        let h;
	        let s;
	        const l = (max + min) / 2;
	        const d = max - min;
	        if (max === min) {
	            h = s = 0;
	        }
	        else {
	            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	            switch (max) {
	                case r:
	                    h = (g - b) / d + (g < b ? 6 : 0);
	                    break;
	                case g:
	                    h = (b - r) / d + 2;
	                    break;
	                case b:
	                    h = (r - g) / d + 4;
	                    break;
	            }
	            h /= 6;
	        }
	        return { h: h * 360, s, l, a };
	    }
	    toString() {
	        const value = this.value;
	        let colorFunction;
	        /**
	         * If we haven't operated on this value, like with a color
	         * function, then value should be the original parsed value
	         *
	         * If we used an rgb()-like function, then value is the
	         * color function name.
	         */
	        if (value) {
	            if (value.indexOf('rgb') === 0) {
	                if (this.alpha < 1) {
	                    colorFunction = 'rgba';
	                }
	                else {
	                    colorFunction = 'rgb';
	                }
	            }
	            else if (value.indexOf('hsl') === 0) {
	                if (this.alpha < 1) {
	                    colorFunction = 'hsla';
	                }
	                else {
	                    colorFunction = 'hsl';
	                }
	            }
	            else {
	                return value;
	            }
	        }
	        else {
	            if (this.alpha < 1) {
	                colorFunction = 'rgba';
	            }
	        }
	        const alpha = this.alpha;
	        let args = [];
	        switch (colorFunction) {
	            case 'rgba':
	                args.push(clamp(alpha, 1));
	            case 'rgb': // eslint-disable-line no-fallthrough
	                args = this.rgb.map(function (c) {
	                    return clamp(Math.round(c), 255);
	                }).concat(args);
	                break;
	            case 'hsla':
	                args.push(clamp(alpha, 1));
	            case 'hsl': { // eslint-disable-line no-fallthrough
	                const color = this.toHSL();
	                args = [
	                    this.fround(color.h),
	                    `${this.fround(color.s * 100)}%`,
	                    `${this.fround(color.l * 100)}%`
	                ].concat(args);
	            }
	        }
	        if (colorFunction) {
	            return `${colorFunction}(${args.join(', ')})`;
	        }
	        return this.toHex();
	    }
	    toCSS(context, out) {
	        out.add(this.toString(), this.location);
	    }
	    toModule(context, out) {
	        out.add(`$J.color("${this.value}")`);
	    }
	}
	exports.Color = Color;
	Color.prototype.type = 'Color';
	const color = (value, location) => new Color(value, location);
	exports.color = color;
	});

	var combinator = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.co = exports.Combinator = void 0;

	class Combinator extends anonymous.Anonymous {
	    toCSS(context, out) {
	        const val = this.value;
	        out.add(val === ' ' ? val : ` ${val} `, this.location);
	    }
	    toModule(context, out) {
	        out.add(`$J.co("${this.value}")`);
	    }
	}
	exports.Combinator = Combinator;
	Combinator.prototype.type = 'Combinator';
	const co = (value, location) => new Combinator(value, location);
	exports.co = co;
	});

	var ws_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.ws = exports.WS = void 0;

	/**
	 * A whitespace node
	 */
	class WS extends node.Node {
	    constructor(value, location) {
	        if (!value) {
	            super({ value: ' ' });
	            return;
	        }
	        super(value, location);
	    }
	    eval(context) {
	        if (!context.inCustom) {
	            this.value = ' ';
	        }
	        return this;
	    }
	    toModule(context, out) {
	        out.add(`$J.ws()`);
	    }
	}
	exports.WS = WS;
	WS.prototype.type = 'WS';
	const ws = (value, location) => new WS(value, location);
	exports.ws = ws;
	});

	var __assign = (commonjsGlobal && commonjsGlobal.__assign) || function () {
	    __assign = Object.assign || function(t) {
	        for (var s, i = 1, n = arguments.length; i < n; i++) {
	            s = arguments[i];
	            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
	                t[p] = s[p];
	        }
	        return t;
	    };
	    return __assign.apply(this, arguments);
	};

	function combinate(obj) {
	    var _a;
	    var combos = [];
	    for (var key in obj) {
	        var values = obj[key];
	        var all = [];
	        for (var i = 0; i < values.length; i++) {
	            for (var j = 0; j < (combos.length || 1); j++) {
	                var newCombo = __assign(__assign({}, combos[j]), (_a = {}, _a[key] = values[i], _a));
	                all.push(newCombo);
	            }
	        }
	        combos = all;
	    }
	    return combos;
	}
	var _default = combinate;

	var dist = /*#__PURE__*/Object.defineProperty({
		default: _default
	}, '__esModule', {value: true});

	var expression = createCommonjsModule(function (module, exports) {
	var __importDefault = (commonjsGlobal && commonjsGlobal.__importDefault) || function (mod) {
	    return (mod && mod.__esModule) ? mod : { "default": mod };
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.expr = exports.Expression = void 0;





	const combinate_1 = __importDefault(dist);
	/**
	 * A continuous collection of nodes
	 */
	class Expression extends node.Node {
	    constructor(value, location) {
	        if (node.isNodeMap(value)) {
	            super(value, location);
	            return;
	        }
	        const values = value.map(v => v.constructor === String ? new anonymous.Anonymous(v) : v);
	        super({
	            value: values
	        }, location);
	    }
	    toArray() {
	        return this.value.filter(node => node && !(node instanceof ws_1.WS));
	    }
	    eval(context) {
	        const node = this.clone();
	        /** Convert all values to Nodes */
	        const cast = context.cast;
	        node.value = node.value
	            .map(n => cast(n).eval(context))
	            .filter(n => n && !(n instanceof nil_1.Nil));
	        let lists;
	        node.value.forEach((n, i) => {
	            if (n instanceof list_1.List) {
	                if (!lists) {
	                    lists = {};
	                }
	                lists[i] = n.value;
	            }
	        });
	        if (lists) {
	            const combinations = combinate_1.default(lists);
	            const returnList = new list_1.List([]).inherit(this);
	            combinations.forEach(combo => {
	                const expr = [...node.value];
	                for (let pos in combo) {
	                    if (Object.prototype.hasOwnProperty.call(combo, pos)) {
	                        expr[pos] = combo[pos];
	                    }
	                }
	                returnList.value.push(new Expression(expr));
	            });
	            return returnList;
	        }
	        if (node.value.length === 1) {
	            return node.value[0];
	        }
	        return node;
	    }
	    toCSS(context, out) {
	        const cast = context.cast;
	        this.value.forEach(n => {
	            const val = cast(n);
	            val.toCSS(context, out);
	        });
	    }
	    toModule(context, out) {
	        const loc = this.location;
	        out.add(`$J.expr([`, loc);
	        const length = this.value.length - 1;
	        this.value.forEach((n, i) => {
	            n.toModule(context, out);
	            if (i < length) {
	                out.add(', ');
	            }
	        });
	        out.add(`])`);
	    }
	}
	exports.Expression = Expression;
	Expression.prototype.type = 'Expression';
	const expr = (...args) => new Expression(...args);
	exports.expr = expr;
	});

	var element = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.el = exports.Element = void 0;




	class Element extends node.Node {
	    constructor(value, location) {
	        if (node.isNodeMap(value)) {
	            super(value, location);
	            return;
	        }
	        super({
	            value: value.constructor === String ? new anonymous.Anonymous(value) : value
	        });
	    }
	    /** Very simple string matching */
	    get isAttr() {
	        return /^\[/.test(this.value.value);
	    }
	    get isClass() {
	        return /^\./.test(this.value.value);
	    }
	    get isId() {
	        return /^#/.test(this.value.value);
	    }
	    get isPseudo() {
	        return /^:/.test(this.value.value);
	    }
	    get isIdent() {
	        return /^[a-z]/.test(this.value.value);
	    }
	    eval(context) {
	        const node = this.clone();
	        const value = context.cast(node.value).eval(context);
	        node.value = value;
	        // Bubble expressions and lists up to Selectors
	        if (value instanceof expression.Expression || value instanceof list_1.List) {
	            return value;
	        }
	        if (node.isClass) {
	            context.hashClass(node.value.value);
	        }
	        return node;
	    }
	    toCSS(context, out) {
	        if (this.isClass) {
	            out.add(context.hashClass(this.value.value), this.location);
	        }
	        else {
	            out.add(this.value.value, this.location);
	        }
	    }
	    toModule(context, out) {
	        const loc = this.location;
	        out.add(`$J.el(`, loc);
	        this.value.toModule(context, out);
	        out.add(')');
	    }
	}
	exports.Element = Element;
	Element.prototype.type = 'Element';
	const el = (...args) => new Element(...args);
	exports.el = el;
	});

	var root_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.root = exports.Root = void 0;




	/**
	 * The root node. Contains a collection of nodes
	 */
	class Root extends node.Node {
	    eval(context) {
	        const node = this.clone();
	        const rules = [];
	        this.value.forEach(rule => {
	            rule = rule.eval(context);
	            if (rule) {
	                if (rule instanceof ruleset_1.Ruleset) {
	                    rules.push(...rule.value);
	                }
	                else if (!(rule instanceof nil_1.Nil)) {
	                    rules.push(rule);
	                }
	            }
	            /**
	             * Inner-most rules get pushed first because
	             * of cascading evaluation, so we need to sort them.
	             */
	            context.rootRules
	                .sort((a, b) => a.location[0] - b.location[0])
	                .forEach(rule => rules.push(rule));
	            context.rootRules = [];
	        });
	        node.value = rules;
	        return node;
	    }
	    toCSS(context, out) {
	        this.value.forEach(v => {
	            v.toCSS(context, out);
	            /** Another root will add its own line breaks */
	            if (!(v instanceof Root)) {
	                out.add('\n');
	            }
	        });
	    }
	    toModule(context, out) {
	        out.add(`import * as $J from 'jess'\n` +
	            `const $CONTEXT = new $J.Context(${JSON.stringify(context.originalOpts)})\n` +
	            `$CONTEXT.id = '${context.id}'\n`, this.location);
	        const jsNodes = this.value.filter(n => n instanceof jsNode.JsNode);
	        jsNodes.forEach(node => {
	            node.toModule(context, out);
	            out.add('\n');
	        });
	        out.add(`function $DEFAULT ($VARS = {}, $RETURN_NODE) {\n`);
	        context.indent++;
	        context.rootLevel++;
	        let pre = context.pre;
	        jsNodes.forEach(node => {
	            out.add(pre);
	            node.toModule(context, out);
	            out.add('\n');
	        });
	        if (!context.opts.dynamic && context.isRuntime) {
	            out.add(`${pre}return {\n`);
	            let i = 0;
	            context.exports.forEach(key => {
	                if (i !== 0) {
	                    out.add(',\n');
	                }
	                i++;
	                out.add(`${pre}  ${key}`);
	            });
	            out.add(`\n${pre}}\n`);
	        }
	        else {
	            out.add(`${pre}const $TREE = $J.root((() => {\n`);
	            out.add(`  ${pre}const $OUT = []\n`);
	            context.indent++;
	            pre = context.pre;
	            this.value.forEach(node => {
	                if (!(node instanceof jsNode.JsNode)) {
	                    out.add(pre);
	                    out.add(`$OUT.push(`);
	                    node.toModule(context, out);
	                    out.add(`)\n`);
	                }
	            });
	            context.indent--;
	            pre = context.pre;
	            out.add(`  ${pre}return $OUT\n${pre}})(),${JSON.stringify(this.location)})\n`);
	            out.add(`${pre}if ($RETURN_NODE) {\n`);
	            out.add(`${pre}  return $TREE\n`);
	            out.add(`${pre}}\n`);
	            out.add(`${pre}return {\n`);
	            out.add(`${pre}  ...$J.renderCss($TREE, $CONTEXT)`);
	            context.exports.forEach(key => {
	                out.add(`,\n${pre}  ${key}`);
	            });
	            out.add(`\n${pre}}\n`);
	        }
	        out.add('}\n');
	        // out.add(`$DEFAULT.$IS_NODE = true\n`)
	        out.add('const $DEFAULT_PROXY = $J.proxy($DEFAULT, $CONTEXT)\n');
	        out.add('$DEFAULT_PROXY(undefined, true)\n');
	        out.add('export default $DEFAULT_PROXY');
	        context.indent = 0;
	        context.rootLevel = 0;
	    }
	}
	exports.Root = Root;
	Root.prototype.type = 'Root';
	const root = (value, location) => new Root(value, location);
	exports.root = root;
	});

	var include_1 = createCommonjsModule(function (module, exports) {
	var __importDefault = (commonjsGlobal && commonjsGlobal.__importDefault) || function (mod) {
	    return (mod && mod.__esModule) ? mod : { "default": mod };
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.include = exports.Include = void 0;
	const isPlainObject_1$1 = __importDefault(isPlainObject_1);





	class Include extends node.Node {
	    constructor(value, location) {
	        if (node.isNodeMap(value)) {
	            super(value, location);
	        }
	        else {
	            super({ value }, location);
	        }
	    }
	    eval(context) {
	        let value = this.value;
	        /** Convert included objects into declaration sets */
	        if (isPlainObject_1$1.default(value)) {
	            const rules = [];
	            for (let name in value) {
	                if (Object.prototype.hasOwnProperty.call(value, name)) {
	                    rules.push(new declaration.Declaration({
	                        name,
	                        value: context.cast((value[name])).eval(context)
	                    }));
	                }
	            }
	            return new ruleset_1.Ruleset(rules);
	        }
	        value = context.cast(value).eval(context);
	        /**
	         * Include Roots as plain Rulesets
	         */
	        if (value instanceof root_1.Root) {
	            return new ruleset_1.Ruleset(value.value).eval(context);
	        }
	        if (!value.allowRoot && !value.allowRuleRoot) {
	            let message = '@include returned an invalid node.';
	            if (value instanceof call_1.Call && this.value instanceof call_1.Call) {
	                message += ` Unknown function "${value.name}"`;
	            }
	            throw { message };
	        }
	        return value;
	    }
	    toModule(context, out) {
	        out.add('$J.include(');
	        this.value.toModule(context, out);
	        out.add(')');
	    }
	}
	exports.Include = Include;
	Include.prototype.type = 'Include';
	const include = (value, location) => new Include(value, location);
	exports.include = include;
	});

	var jsCollection = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.coll = exports.JsCollection = void 0;

	/**
	 * Assigned to by a @let statement
	 */
	class JsCollection extends node.Node {
	    toCSS(context, out) {
	        let pre = context.pre;
	        context.indent++;
	        out.add(`{\n`, this.location);
	        const length = this.value.length;
	        this.value.forEach((decl, i) => {
	            out.add(`${pre}  `);
	            decl.toCSS(context, out);
	            if (i < length) {
	                out.add('\n');
	            }
	        });
	        context.indent--;
	        out.add(`${pre}}`);
	        return out;
	    }
	    toModule(context, out) {
	        const pre = context.pre;
	        context.indent++;
	        out.add(`{\n`, this.location);
	        const length = this.value.length - 1;
	        this.value.forEach((node, i) => {
	            out.add(`  ${pre}${JSON.stringify(node.name.toString())}: `);
	            node.value.toModule(context, out);
	            if (i < length) {
	                out.add(',');
	            }
	            out.add('\n');
	        });
	        out.add(`${pre}}`);
	        context.indent--;
	    }
	}
	exports.JsCollection = JsCollection;
	JsCollection.prototype.type = 'JsCollection';
	const coll = (value, location) => new JsCollection(value, location);
	exports.coll = coll;
	});

	var jsImport = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.jsimport = exports.JsImport = void 0;

	/**
	 * @import { foo } from './something.js';
	 *
	 * @todo - for alpha, we just store the raw string
	 * Later, we should collect identifiers
	 */
	class JsImport extends jsNode.JsNode {
	    toCSS(context, out) {
	        out.add('[[JS]]', this.location);
	    }
	    toModule(context, out) {
	        if (context.rootLevel === 0) {
	            out.add(`import${this.value}`, this.location);
	        }
	    }
	}
	exports.JsImport = JsImport;
	JsImport.prototype.type = 'JsImport';
	const jsimport = (value, location) => new JsImport(value, location);
	exports.jsimport = jsimport;
	});

	var jsKeyValue = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.keyval = exports.JsKeyValue = void 0;



	/**
	 * Either the left-hand side of a @let assignment,
	 * or the key (prop) in a collection.
	 *
	 * @todo - technically we don't need to limit
	 * reserved words in object properties, just
	 * initial @let identifiers
	 */
	class JsKeyValue extends jsNode.JsNode {
	    constructor(val, location) {
	        let { name, value } = val;
	        if (name.constructor === String) {
	            name = new jsIdent.JsIdent(name);
	        }
	        super({ name, value }, location);
	    }
	    toCSS(context, out) {
	        const value = this.value;
	        out.add(this.name.value, this.location);
	        if (!(value instanceof jsCollection.JsCollection)) {
	            out.add(':');
	        }
	        out.add(' ');
	        value.toCSS(context, out);
	        if (!(value instanceof jsCollection.JsCollection)) {
	            out.add(';');
	        }
	    }
	    toModule(context, out) {
	        out.add(`${this.name.value}: `, this.location);
	        this.value.toModule(context, out);
	    }
	}
	exports.JsKeyValue = JsKeyValue;
	JsKeyValue.prototype.type = 'JsKeyValue';
	const keyval = (value, location) => new JsKeyValue(value, location);
	exports.keyval = keyval;
	});

	var _let = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.set = exports.Let = void 0;


	/**
	 * @let
	 *
	 * @note
	 * The lower-case API variant for this is `set()`,
	 * see the note below.
	 *
	 * @todo
	 * Check that we're not redefining vars? To do that, we'd have to
	 * address the todo in js-import to get a true list of scoped vars.
	 * For now, JS will simply throw an eval error.
	 */
	class Let extends jsNode.JsNode {
	    toCSS(context, out) {
	        out.add('@let ', this.location);
	        this.value.toCSS(context, out);
	    }
	    recurseValue(value, keys, context, out) {
	        const pre = context.pre;
	        if (value instanceof jsCollection.JsCollection) {
	            if (keys.length === 1) {
	                out.add(`${keys[0]} = $J.merge({}, $J.get($VARS, '${keys[0]}'))\n${pre}`);
	            }
	            else {
	                out.add(`${keys.join('.')} = {}\n${pre}`);
	            }
	            value.value.forEach(node => {
	                this.recurseValue(node.value, [...keys, node.name.value], context, out);
	            });
	        }
	        else {
	            out.add(`${keys.join('.')} = $J.get($VARS, '${keys.join('.')}', `);
	            value.toModule(context, out);
	            out.add(`)\n${pre}`);
	        }
	    }
	    toModule(context, out) {
	        const name = this.value.name.value;
	        if (context.rootLevel === 0) {
	            out.add(`export let ${name}`, this.location);
	            context.exports.add(name);
	        }
	        else {
	            if (context.rootLevel !== 1) {
	                out.add(`let ${name} = `);
	                this.value.value.toModule(context, out);
	                return;
	            }
	            this.recurseValue(this.value.value, [name], context, out);
	        }
	    }
	}
	exports.Let = Let;
	Let.prototype.type = 'Let';
	/**
	 * `let` is a reserved word, so we'll use `set`
	 * for lower-case API
	 */
	const set = (value, location) => new Let(value, location);
	exports.set = set;
	});

	var mixin_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.mixin = exports.Mixin = void 0;


	/**
	 * @mixin someMixin (arg1, arg2: 10px) {
	 *   color: black;
	 *   background-color: white;
	 *   border-radius: $arg2;
	 * }
	 */
	class Mixin extends jsNode.JsNode {
	    /**
	     * @todo -
	     * Return either a ruleset if `this` is the eval context,
	     * or return ruleset.obj() if not (for React/Vue)
	     */
	    toModule(context, out) {
	        const { name, args, value } = this;
	        const nm = name.value;
	        context.exports.add(nm);
	        if (context.rootLevel === 0) {
	            out.add(`export let ${nm}`, this.location);
	        }
	        else {
	            if (context.rootLevel !== 1) {
	                out.add(`let `);
	            }
	            out.add(`${nm} = (`);
	            if (args) {
	                const length = args.value.length - 1;
	                args.value.forEach((node, i) => {
	                    if (node instanceof jsIdent.JsIdent) {
	                        out.add(node.value);
	                    }
	                    else {
	                        out.add(node.name.value);
	                        out.add(' = ');
	                        node.value.toModule(context, out);
	                    }
	                    if (i < length) {
	                        out.add(', ');
	                    }
	                });
	            }
	            out.add(') => ');
	            value.toModule(context, out);
	        }
	    }
	}
	exports.Mixin = Mixin;
	Mixin.prototype.type = 'Mixin';
	const mixin = (value, location) => new Mixin(value, location);
	exports.mixin = mixin;
	});

	var paren_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.paren = exports.Paren = void 0;

	/**
	 * An expression in parenthesis
	 */
	class Paren extends node.Node {
	    toCSS(context, out) {
	        out.add('(');
	        this.value.toCSS(context, out);
	        out.add(')');
	    }
	    toModule(context, out) {
	        const loc = this.location;
	        out.add(`$J.paren(`, loc);
	        this.value.toModule(context, out);
	        out.add(')');
	    }
	}
	exports.Paren = Paren;
	Paren.prototype.type = 'Paren';
	const paren = (value, location) => new Paren(value, location);
	exports.paren = paren;
	});

	var selector = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.sel = exports.Selector = void 0;





	/**
	 * @example
	 * #id > .class.class
	 *
	 * Stored as:
	 * [Element, Combinator, Element, Element]
	 *
	 * @todo
	 * Push an ampersand at the beginning of selector expressions
	 * if there isn't one
	 */
	class Selector extends expression.Expression {
	    constructor(value, location) {
	        if (node.isNodeMap(value)) {
	            super(value, location);
	            return;
	        }
	        const values = value.map(v => v.constructor === String ? new combinator.Combinator(v) : v);
	        super({
	            value: values
	        }, location);
	    }
	    eval(context) {
	        let selector = this.clone();
	        let elements = [...selector.value];
	        selector.value = elements;
	        const hasAmp = elements.find(el => el instanceof ampersand.Ampersand);
	        /**
	         * Try to evaluate all selectors as if they are prepended by `&`
	         */
	        if (!hasAmp) {
	            if (elements[0] instanceof combinator.Combinator) {
	                elements.unshift(new ampersand.Ampersand());
	            }
	            else {
	                elements.unshift(new ampersand.Ampersand(), new combinator.Combinator(' '));
	            }
	        }
	        selector = super.eval.call(selector, context);
	        elements = selector.value;
	        for (let i = 0; i < elements.length; i++) {
	            let value = elements[0];
	            if (value instanceof combinator.Combinator ||
	                value instanceof ws_1.WS) {
	                elements.shift();
	            }
	            else {
	                break;
	            }
	        }
	        return selector;
	    }
	    toCSS(context, out) {
	        this.value.forEach(node => node.toCSS(context, out));
	    }
	    toModule(context, out) {
	        out.add(`$J.sel([`, this.location);
	        const length = this.value.length - 1;
	        this.value.forEach((node, i) => {
	            node.toModule(context, out);
	            if (i < length) {
	                out.add(', ');
	            }
	        });
	        out.add(`])`);
	    }
	}
	exports.Selector = Selector;
	Selector.prototype.type = 'Selector';
	const sel = (value, location) => new Selector(value, location);
	exports.sel = sel;
	});

	var spaced_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.spaced = exports.Spaced = void 0;



	/**
	 * A space-separated expression.
	 * This is basically API sugar for expressions
	 */
	class Spaced extends expression.Expression {
	    constructor(value, location) {
	        if (node.isNodeMap(value)) {
	            super(value, location);
	            return;
	        }
	        const values = [value[0]];
	        for (let i = 1; i < value.length; i++) {
	            values.push(new ws_1.WS(), value[i]);
	        }
	        super(values, location);
	    }
	    toModule(context, out) {
	        const loc = this.location;
	        out.add(`$J.spaced([`, loc);
	        const length = this.value.length - 1;
	        this.value.forEach((n, i) => {
	            if (i % 2 === 0) {
	                n.toModule(context, out);
	                if (i < length) {
	                    out.add(', ', loc);
	                }
	            }
	        });
	        out.add(`])`);
	    }
	}
	exports.Spaced = Spaced;
	Spaced.prototype.type = 'Spaced';
	const spaced = (...args) => new Spaced(...args);
	exports.spaced = spaced;
	});

	var square_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.square = exports.Square = void 0;

	/**
	 * An expression in square brackets
	 */
	class Square extends node.Node {
	    toCSS(context, out) {
	        out.add('[');
	        this.value.toCSS(context, out);
	        out.add(']');
	    }
	    toModule(context, out) {
	        out.add(`$J.square(`, this.location);
	        this.value.toModule(context, out);
	        out.add(')');
	    }
	}
	exports.Square = Square;
	Square.prototype.type = 'Square';
	const square = (value, location) => new Square(value, location);
	exports.square = square;
	});

	var tree = createCommonjsModule(function (module, exports) {
	/**
	 * @note
	 * These nodes are actually taking the role of two ASTs,
	 * because there are nodes that will be used to produce a module,
	 * and that module will create AST nodes to create CSS.
	 */
	var __createBinding = (commonjsGlobal && commonjsGlobal.__createBinding) || (Object.create ? (function(o, m, k, k2) {
	    if (k2 === undefined) k2 = k;
	    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
	}) : (function(o, m, k, k2) {
	    if (k2 === undefined) k2 = k;
	    o[k2] = m[k];
	}));
	var __exportStar = (commonjsGlobal && commonjsGlobal.__exportStar) || function(m, exports) {
	    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Node = void 0;
	/** Base classes - keep these on top */

	Object.defineProperty(exports, "Node", { enumerable: true, get: function () { return node.Node; } });


	/**
	 * We bind this here to avoid circular dependencies
	 * between Context and Node
	 */
	node.Node.prototype.toString = function () {
	    const out = new output.OutputCollector;
	    this.toCSS(new context.Context, out);
	    return out.toString();
	};
	__exportStar(jsNode, exports);
	/** @todo - remove nodes from tree index that we don't need to bundle for runtime? */
	__exportStar(atRule, exports);
	__exportStar(ampersand, exports);
	__exportStar(anonymous, exports);
	__exportStar(call_1, exports);
	__exportStar(color_1, exports);
	__exportStar(combinator, exports);
	__exportStar(declaration, exports);
	__exportStar(dimension_1, exports);
	__exportStar(element, exports);
	__exportStar(expression, exports);
	__exportStar(include_1, exports);
	__exportStar(jsCollection, exports);
	__exportStar(jsIdent, exports);
	__exportStar(jsImport, exports);
	__exportStar(jsKeyValue, exports);
	__exportStar(jsExpr, exports);
	__exportStar(_let, exports);
	__exportStar(list_1, exports);
	__exportStar(mixin_1, exports);
	__exportStar(nil_1, exports);
	__exportStar(paren_1, exports);
	__exportStar(rule_1, exports);
	__exportStar(ruleset_1, exports);
	__exportStar(root_1, exports);
	__exportStar(selector, exports);
	__exportStar(spaced_1, exports);
	__exportStar(square_1, exports);
	__exportStar(ws_1, exports);
	});

	var renderCss_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.renderCss = void 0;

	/**
	 * Given a root node (usually from a module) render to CSS
	 */
	const renderCss = (root, context) => {
	    const evaldRoot = root.eval(context);
	    const result = {
	        /**
	         * @todo - patch document in browser
	         */
	        $toCSS: () => {
	            const out = new output.OutputCollector;
	            evaldRoot.toCSS(context, out);
	            return out.toString();
	        },
	        $root: evaldRoot
	    };
	    return result;
	};
	exports.renderCss = renderCss;
	});

	/**
	 * Removes all key-value entries from the list cache.
	 *
	 * @private
	 * @name clear
	 * @memberOf ListCache
	 */
	function listCacheClear() {
	  this.__data__ = [];
	  this.size = 0;
	}

	var _listCacheClear = listCacheClear;

	/**
	 * Performs a
	 * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
	 * comparison between two values to determine if they are equivalent.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to compare.
	 * @param {*} other The other value to compare.
	 * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
	 * @example
	 *
	 * var object = { 'a': 1 };
	 * var other = { 'a': 1 };
	 *
	 * _.eq(object, object);
	 * // => true
	 *
	 * _.eq(object, other);
	 * // => false
	 *
	 * _.eq('a', 'a');
	 * // => true
	 *
	 * _.eq('a', Object('a'));
	 * // => false
	 *
	 * _.eq(NaN, NaN);
	 * // => true
	 */
	function eq(value, other) {
	  return value === other || (value !== value && other !== other);
	}

	var eq_1 = eq;

	/**
	 * Gets the index at which the `key` is found in `array` of key-value pairs.
	 *
	 * @private
	 * @param {Array} array The array to inspect.
	 * @param {*} key The key to search for.
	 * @returns {number} Returns the index of the matched value, else `-1`.
	 */
	function assocIndexOf(array, key) {
	  var length = array.length;
	  while (length--) {
	    if (eq_1(array[length][0], key)) {
	      return length;
	    }
	  }
	  return -1;
	}

	var _assocIndexOf = assocIndexOf;

	/** Used for built-in method references. */
	var arrayProto = Array.prototype;

	/** Built-in value references. */
	var splice = arrayProto.splice;

	/**
	 * Removes `key` and its value from the list cache.
	 *
	 * @private
	 * @name delete
	 * @memberOf ListCache
	 * @param {string} key The key of the value to remove.
	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
	 */
	function listCacheDelete(key) {
	  var data = this.__data__,
	      index = _assocIndexOf(data, key);

	  if (index < 0) {
	    return false;
	  }
	  var lastIndex = data.length - 1;
	  if (index == lastIndex) {
	    data.pop();
	  } else {
	    splice.call(data, index, 1);
	  }
	  --this.size;
	  return true;
	}

	var _listCacheDelete = listCacheDelete;

	/**
	 * Gets the list cache value for `key`.
	 *
	 * @private
	 * @name get
	 * @memberOf ListCache
	 * @param {string} key The key of the value to get.
	 * @returns {*} Returns the entry value.
	 */
	function listCacheGet(key) {
	  var data = this.__data__,
	      index = _assocIndexOf(data, key);

	  return index < 0 ? undefined : data[index][1];
	}

	var _listCacheGet = listCacheGet;

	/**
	 * Checks if a list cache value for `key` exists.
	 *
	 * @private
	 * @name has
	 * @memberOf ListCache
	 * @param {string} key The key of the entry to check.
	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
	 */
	function listCacheHas(key) {
	  return _assocIndexOf(this.__data__, key) > -1;
	}

	var _listCacheHas = listCacheHas;

	/**
	 * Sets the list cache `key` to `value`.
	 *
	 * @private
	 * @name set
	 * @memberOf ListCache
	 * @param {string} key The key of the value to set.
	 * @param {*} value The value to set.
	 * @returns {Object} Returns the list cache instance.
	 */
	function listCacheSet(key, value) {
	  var data = this.__data__,
	      index = _assocIndexOf(data, key);

	  if (index < 0) {
	    ++this.size;
	    data.push([key, value]);
	  } else {
	    data[index][1] = value;
	  }
	  return this;
	}

	var _listCacheSet = listCacheSet;

	/**
	 * Creates an list cache object.
	 *
	 * @private
	 * @constructor
	 * @param {Array} [entries] The key-value pairs to cache.
	 */
	function ListCache(entries) {
	  var index = -1,
	      length = entries == null ? 0 : entries.length;

	  this.clear();
	  while (++index < length) {
	    var entry = entries[index];
	    this.set(entry[0], entry[1]);
	  }
	}

	// Add methods to `ListCache`.
	ListCache.prototype.clear = _listCacheClear;
	ListCache.prototype['delete'] = _listCacheDelete;
	ListCache.prototype.get = _listCacheGet;
	ListCache.prototype.has = _listCacheHas;
	ListCache.prototype.set = _listCacheSet;

	var _ListCache = ListCache;

	/**
	 * Removes all key-value entries from the stack.
	 *
	 * @private
	 * @name clear
	 * @memberOf Stack
	 */
	function stackClear() {
	  this.__data__ = new _ListCache;
	  this.size = 0;
	}

	var _stackClear = stackClear;

	/**
	 * Removes `key` and its value from the stack.
	 *
	 * @private
	 * @name delete
	 * @memberOf Stack
	 * @param {string} key The key of the value to remove.
	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
	 */
	function stackDelete(key) {
	  var data = this.__data__,
	      result = data['delete'](key);

	  this.size = data.size;
	  return result;
	}

	var _stackDelete = stackDelete;

	/**
	 * Gets the stack value for `key`.
	 *
	 * @private
	 * @name get
	 * @memberOf Stack
	 * @param {string} key The key of the value to get.
	 * @returns {*} Returns the entry value.
	 */
	function stackGet(key) {
	  return this.__data__.get(key);
	}

	var _stackGet = stackGet;

	/**
	 * Checks if a stack value for `key` exists.
	 *
	 * @private
	 * @name has
	 * @memberOf Stack
	 * @param {string} key The key of the entry to check.
	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
	 */
	function stackHas(key) {
	  return this.__data__.has(key);
	}

	var _stackHas = stackHas;

	/**
	 * Checks if `value` is the
	 * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
	 * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
	 * @example
	 *
	 * _.isObject({});
	 * // => true
	 *
	 * _.isObject([1, 2, 3]);
	 * // => true
	 *
	 * _.isObject(_.noop);
	 * // => true
	 *
	 * _.isObject(null);
	 * // => false
	 */
	function isObject(value) {
	  var type = typeof value;
	  return value != null && (type == 'object' || type == 'function');
	}

	var isObject_1 = isObject;

	/** `Object#toString` result references. */
	var asyncTag = '[object AsyncFunction]',
	    funcTag = '[object Function]',
	    genTag = '[object GeneratorFunction]',
	    proxyTag = '[object Proxy]';

	/**
	 * Checks if `value` is classified as a `Function` object.
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a function, else `false`.
	 * @example
	 *
	 * _.isFunction(_);
	 * // => true
	 *
	 * _.isFunction(/abc/);
	 * // => false
	 */
	function isFunction(value) {
	  if (!isObject_1(value)) {
	    return false;
	  }
	  // The use of `Object#toString` avoids issues with the `typeof` operator
	  // in Safari 9 which returns 'object' for typed arrays and other constructors.
	  var tag = _baseGetTag(value);
	  return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
	}

	var isFunction_1 = isFunction;

	/** Used to detect overreaching core-js shims. */
	var coreJsData = _root['__core-js_shared__'];

	var _coreJsData = coreJsData;

	/** Used to detect methods masquerading as native. */
	var maskSrcKey = (function() {
	  var uid = /[^.]+$/.exec(_coreJsData && _coreJsData.keys && _coreJsData.keys.IE_PROTO || '');
	  return uid ? ('Symbol(src)_1.' + uid) : '';
	}());

	/**
	 * Checks if `func` has its source masked.
	 *
	 * @private
	 * @param {Function} func The function to check.
	 * @returns {boolean} Returns `true` if `func` is masked, else `false`.
	 */
	function isMasked(func) {
	  return !!maskSrcKey && (maskSrcKey in func);
	}

	var _isMasked = isMasked;

	/** Used for built-in method references. */
	var funcProto$1 = Function.prototype;

	/** Used to resolve the decompiled source of functions. */
	var funcToString$1 = funcProto$1.toString;

	/**
	 * Converts `func` to its source code.
	 *
	 * @private
	 * @param {Function} func The function to convert.
	 * @returns {string} Returns the source code.
	 */
	function toSource(func) {
	  if (func != null) {
	    try {
	      return funcToString$1.call(func);
	    } catch (e) {}
	    try {
	      return (func + '');
	    } catch (e) {}
	  }
	  return '';
	}

	var _toSource = toSource;

	/**
	 * Used to match `RegExp`
	 * [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
	 */
	var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;

	/** Used to detect host constructors (Safari). */
	var reIsHostCtor = /^\[object .+?Constructor\]$/;

	/** Used for built-in method references. */
	var funcProto$2 = Function.prototype,
	    objectProto$3 = Object.prototype;

	/** Used to resolve the decompiled source of functions. */
	var funcToString$2 = funcProto$2.toString;

	/** Used to check objects for own properties. */
	var hasOwnProperty$2 = objectProto$3.hasOwnProperty;

	/** Used to detect if a method is native. */
	var reIsNative = RegExp('^' +
	  funcToString$2.call(hasOwnProperty$2).replace(reRegExpChar, '\\$&')
	  .replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$'
	);

	/**
	 * The base implementation of `_.isNative` without bad shim checks.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a native function,
	 *  else `false`.
	 */
	function baseIsNative(value) {
	  if (!isObject_1(value) || _isMasked(value)) {
	    return false;
	  }
	  var pattern = isFunction_1(value) ? reIsNative : reIsHostCtor;
	  return pattern.test(_toSource(value));
	}

	var _baseIsNative = baseIsNative;

	/**
	 * Gets the value at `key` of `object`.
	 *
	 * @private
	 * @param {Object} [object] The object to query.
	 * @param {string} key The key of the property to get.
	 * @returns {*} Returns the property value.
	 */
	function getValue(object, key) {
	  return object == null ? undefined : object[key];
	}

	var _getValue = getValue;

	/**
	 * Gets the native function at `key` of `object`.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @param {string} key The key of the method to get.
	 * @returns {*} Returns the function if it's native, else `undefined`.
	 */
	function getNative(object, key) {
	  var value = _getValue(object, key);
	  return _baseIsNative(value) ? value : undefined;
	}

	var _getNative = getNative;

	/* Built-in method references that are verified to be native. */
	var Map = _getNative(_root, 'Map');

	var _Map = Map;

	/* Built-in method references that are verified to be native. */
	var nativeCreate = _getNative(Object, 'create');

	var _nativeCreate = nativeCreate;

	/**
	 * Removes all key-value entries from the hash.
	 *
	 * @private
	 * @name clear
	 * @memberOf Hash
	 */
	function hashClear() {
	  this.__data__ = _nativeCreate ? _nativeCreate(null) : {};
	  this.size = 0;
	}

	var _hashClear = hashClear;

	/**
	 * Removes `key` and its value from the hash.
	 *
	 * @private
	 * @name delete
	 * @memberOf Hash
	 * @param {Object} hash The hash to modify.
	 * @param {string} key The key of the value to remove.
	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
	 */
	function hashDelete(key) {
	  var result = this.has(key) && delete this.__data__[key];
	  this.size -= result ? 1 : 0;
	  return result;
	}

	var _hashDelete = hashDelete;

	/** Used to stand-in for `undefined` hash values. */
	var HASH_UNDEFINED = '__lodash_hash_undefined__';

	/** Used for built-in method references. */
	var objectProto$4 = Object.prototype;

	/** Used to check objects for own properties. */
	var hasOwnProperty$3 = objectProto$4.hasOwnProperty;

	/**
	 * Gets the hash value for `key`.
	 *
	 * @private
	 * @name get
	 * @memberOf Hash
	 * @param {string} key The key of the value to get.
	 * @returns {*} Returns the entry value.
	 */
	function hashGet(key) {
	  var data = this.__data__;
	  if (_nativeCreate) {
	    var result = data[key];
	    return result === HASH_UNDEFINED ? undefined : result;
	  }
	  return hasOwnProperty$3.call(data, key) ? data[key] : undefined;
	}

	var _hashGet = hashGet;

	/** Used for built-in method references. */
	var objectProto$5 = Object.prototype;

	/** Used to check objects for own properties. */
	var hasOwnProperty$4 = objectProto$5.hasOwnProperty;

	/**
	 * Checks if a hash value for `key` exists.
	 *
	 * @private
	 * @name has
	 * @memberOf Hash
	 * @param {string} key The key of the entry to check.
	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
	 */
	function hashHas(key) {
	  var data = this.__data__;
	  return _nativeCreate ? (data[key] !== undefined) : hasOwnProperty$4.call(data, key);
	}

	var _hashHas = hashHas;

	/** Used to stand-in for `undefined` hash values. */
	var HASH_UNDEFINED$1 = '__lodash_hash_undefined__';

	/**
	 * Sets the hash `key` to `value`.
	 *
	 * @private
	 * @name set
	 * @memberOf Hash
	 * @param {string} key The key of the value to set.
	 * @param {*} value The value to set.
	 * @returns {Object} Returns the hash instance.
	 */
	function hashSet(key, value) {
	  var data = this.__data__;
	  this.size += this.has(key) ? 0 : 1;
	  data[key] = (_nativeCreate && value === undefined) ? HASH_UNDEFINED$1 : value;
	  return this;
	}

	var _hashSet = hashSet;

	/**
	 * Creates a hash object.
	 *
	 * @private
	 * @constructor
	 * @param {Array} [entries] The key-value pairs to cache.
	 */
	function Hash(entries) {
	  var index = -1,
	      length = entries == null ? 0 : entries.length;

	  this.clear();
	  while (++index < length) {
	    var entry = entries[index];
	    this.set(entry[0], entry[1]);
	  }
	}

	// Add methods to `Hash`.
	Hash.prototype.clear = _hashClear;
	Hash.prototype['delete'] = _hashDelete;
	Hash.prototype.get = _hashGet;
	Hash.prototype.has = _hashHas;
	Hash.prototype.set = _hashSet;

	var _Hash = Hash;

	/**
	 * Removes all key-value entries from the map.
	 *
	 * @private
	 * @name clear
	 * @memberOf MapCache
	 */
	function mapCacheClear() {
	  this.size = 0;
	  this.__data__ = {
	    'hash': new _Hash,
	    'map': new (_Map || _ListCache),
	    'string': new _Hash
	  };
	}

	var _mapCacheClear = mapCacheClear;

	/**
	 * Checks if `value` is suitable for use as unique object key.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is suitable, else `false`.
	 */
	function isKeyable(value) {
	  var type = typeof value;
	  return (type == 'string' || type == 'number' || type == 'symbol' || type == 'boolean')
	    ? (value !== '__proto__')
	    : (value === null);
	}

	var _isKeyable = isKeyable;

	/**
	 * Gets the data for `map`.
	 *
	 * @private
	 * @param {Object} map The map to query.
	 * @param {string} key The reference key.
	 * @returns {*} Returns the map data.
	 */
	function getMapData(map, key) {
	  var data = map.__data__;
	  return _isKeyable(key)
	    ? data[typeof key == 'string' ? 'string' : 'hash']
	    : data.map;
	}

	var _getMapData = getMapData;

	/**
	 * Removes `key` and its value from the map.
	 *
	 * @private
	 * @name delete
	 * @memberOf MapCache
	 * @param {string} key The key of the value to remove.
	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
	 */
	function mapCacheDelete(key) {
	  var result = _getMapData(this, key)['delete'](key);
	  this.size -= result ? 1 : 0;
	  return result;
	}

	var _mapCacheDelete = mapCacheDelete;

	/**
	 * Gets the map value for `key`.
	 *
	 * @private
	 * @name get
	 * @memberOf MapCache
	 * @param {string} key The key of the value to get.
	 * @returns {*} Returns the entry value.
	 */
	function mapCacheGet(key) {
	  return _getMapData(this, key).get(key);
	}

	var _mapCacheGet = mapCacheGet;

	/**
	 * Checks if a map value for `key` exists.
	 *
	 * @private
	 * @name has
	 * @memberOf MapCache
	 * @param {string} key The key of the entry to check.
	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
	 */
	function mapCacheHas(key) {
	  return _getMapData(this, key).has(key);
	}

	var _mapCacheHas = mapCacheHas;

	/**
	 * Sets the map `key` to `value`.
	 *
	 * @private
	 * @name set
	 * @memberOf MapCache
	 * @param {string} key The key of the value to set.
	 * @param {*} value The value to set.
	 * @returns {Object} Returns the map cache instance.
	 */
	function mapCacheSet(key, value) {
	  var data = _getMapData(this, key),
	      size = data.size;

	  data.set(key, value);
	  this.size += data.size == size ? 0 : 1;
	  return this;
	}

	var _mapCacheSet = mapCacheSet;

	/**
	 * Creates a map cache object to store key-value pairs.
	 *
	 * @private
	 * @constructor
	 * @param {Array} [entries] The key-value pairs to cache.
	 */
	function MapCache(entries) {
	  var index = -1,
	      length = entries == null ? 0 : entries.length;

	  this.clear();
	  while (++index < length) {
	    var entry = entries[index];
	    this.set(entry[0], entry[1]);
	  }
	}

	// Add methods to `MapCache`.
	MapCache.prototype.clear = _mapCacheClear;
	MapCache.prototype['delete'] = _mapCacheDelete;
	MapCache.prototype.get = _mapCacheGet;
	MapCache.prototype.has = _mapCacheHas;
	MapCache.prototype.set = _mapCacheSet;

	var _MapCache = MapCache;

	/** Used as the size to enable large array optimizations. */
	var LARGE_ARRAY_SIZE = 200;

	/**
	 * Sets the stack `key` to `value`.
	 *
	 * @private
	 * @name set
	 * @memberOf Stack
	 * @param {string} key The key of the value to set.
	 * @param {*} value The value to set.
	 * @returns {Object} Returns the stack cache instance.
	 */
	function stackSet(key, value) {
	  var data = this.__data__;
	  if (data instanceof _ListCache) {
	    var pairs = data.__data__;
	    if (!_Map || (pairs.length < LARGE_ARRAY_SIZE - 1)) {
	      pairs.push([key, value]);
	      this.size = ++data.size;
	      return this;
	    }
	    data = this.__data__ = new _MapCache(pairs);
	  }
	  data.set(key, value);
	  this.size = data.size;
	  return this;
	}

	var _stackSet = stackSet;

	/**
	 * Creates a stack cache object to store key-value pairs.
	 *
	 * @private
	 * @constructor
	 * @param {Array} [entries] The key-value pairs to cache.
	 */
	function Stack(entries) {
	  var data = this.__data__ = new _ListCache(entries);
	  this.size = data.size;
	}

	// Add methods to `Stack`.
	Stack.prototype.clear = _stackClear;
	Stack.prototype['delete'] = _stackDelete;
	Stack.prototype.get = _stackGet;
	Stack.prototype.has = _stackHas;
	Stack.prototype.set = _stackSet;

	var _Stack = Stack;

	var defineProperty = (function() {
	  try {
	    var func = _getNative(Object, 'defineProperty');
	    func({}, '', {});
	    return func;
	  } catch (e) {}
	}());

	var _defineProperty = defineProperty;

	/**
	 * The base implementation of `assignValue` and `assignMergeValue` without
	 * value checks.
	 *
	 * @private
	 * @param {Object} object The object to modify.
	 * @param {string} key The key of the property to assign.
	 * @param {*} value The value to assign.
	 */
	function baseAssignValue(object, key, value) {
	  if (key == '__proto__' && _defineProperty) {
	    _defineProperty(object, key, {
	      'configurable': true,
	      'enumerable': true,
	      'value': value,
	      'writable': true
	    });
	  } else {
	    object[key] = value;
	  }
	}

	var _baseAssignValue = baseAssignValue;

	/**
	 * This function is like `assignValue` except that it doesn't assign
	 * `undefined` values.
	 *
	 * @private
	 * @param {Object} object The object to modify.
	 * @param {string} key The key of the property to assign.
	 * @param {*} value The value to assign.
	 */
	function assignMergeValue(object, key, value) {
	  if ((value !== undefined && !eq_1(object[key], value)) ||
	      (value === undefined && !(key in object))) {
	    _baseAssignValue(object, key, value);
	  }
	}

	var _assignMergeValue = assignMergeValue;

	/**
	 * Creates a base function for methods like `_.forIn` and `_.forOwn`.
	 *
	 * @private
	 * @param {boolean} [fromRight] Specify iterating from right to left.
	 * @returns {Function} Returns the new base function.
	 */
	function createBaseFor(fromRight) {
	  return function(object, iteratee, keysFunc) {
	    var index = -1,
	        iterable = Object(object),
	        props = keysFunc(object),
	        length = props.length;

	    while (length--) {
	      var key = props[fromRight ? length : ++index];
	      if (iteratee(iterable[key], key, iterable) === false) {
	        break;
	      }
	    }
	    return object;
	  };
	}

	var _createBaseFor = createBaseFor;

	/**
	 * The base implementation of `baseForOwn` which iterates over `object`
	 * properties returned by `keysFunc` and invokes `iteratee` for each property.
	 * Iteratee functions may exit iteration early by explicitly returning `false`.
	 *
	 * @private
	 * @param {Object} object The object to iterate over.
	 * @param {Function} iteratee The function invoked per iteration.
	 * @param {Function} keysFunc The function to get the keys of `object`.
	 * @returns {Object} Returns `object`.
	 */
	var baseFor = _createBaseFor();

	var _baseFor = baseFor;

	var _cloneBuffer = createCommonjsModule(function (module, exports) {
	/** Detect free variable `exports`. */
	var freeExports =  exports && !exports.nodeType && exports;

	/** Detect free variable `module`. */
	var freeModule = freeExports && 'object' == 'object' && module && !module.nodeType && module;

	/** Detect the popular CommonJS extension `module.exports`. */
	var moduleExports = freeModule && freeModule.exports === freeExports;

	/** Built-in value references. */
	var Buffer = moduleExports ? _root.Buffer : undefined,
	    allocUnsafe = Buffer ? Buffer.allocUnsafe : undefined;

	/**
	 * Creates a clone of  `buffer`.
	 *
	 * @private
	 * @param {Buffer} buffer The buffer to clone.
	 * @param {boolean} [isDeep] Specify a deep clone.
	 * @returns {Buffer} Returns the cloned buffer.
	 */
	function cloneBuffer(buffer, isDeep) {
	  if (isDeep) {
	    return buffer.slice();
	  }
	  var length = buffer.length,
	      result = allocUnsafe ? allocUnsafe(length) : new buffer.constructor(length);

	  buffer.copy(result);
	  return result;
	}

	module.exports = cloneBuffer;
	});

	/** Built-in value references. */
	var Uint8Array = _root.Uint8Array;

	var _Uint8Array = Uint8Array;

	/**
	 * Creates a clone of `arrayBuffer`.
	 *
	 * @private
	 * @param {ArrayBuffer} arrayBuffer The array buffer to clone.
	 * @returns {ArrayBuffer} Returns the cloned array buffer.
	 */
	function cloneArrayBuffer(arrayBuffer) {
	  var result = new arrayBuffer.constructor(arrayBuffer.byteLength);
	  new _Uint8Array(result).set(new _Uint8Array(arrayBuffer));
	  return result;
	}

	var _cloneArrayBuffer = cloneArrayBuffer;

	/**
	 * Creates a clone of `typedArray`.
	 *
	 * @private
	 * @param {Object} typedArray The typed array to clone.
	 * @param {boolean} [isDeep] Specify a deep clone.
	 * @returns {Object} Returns the cloned typed array.
	 */
	function cloneTypedArray(typedArray, isDeep) {
	  var buffer = isDeep ? _cloneArrayBuffer(typedArray.buffer) : typedArray.buffer;
	  return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
	}

	var _cloneTypedArray = cloneTypedArray;

	/**
	 * Copies the values of `source` to `array`.
	 *
	 * @private
	 * @param {Array} source The array to copy values from.
	 * @param {Array} [array=[]] The array to copy values to.
	 * @returns {Array} Returns `array`.
	 */
	function copyArray(source, array) {
	  var index = -1,
	      length = source.length;

	  array || (array = Array(length));
	  while (++index < length) {
	    array[index] = source[index];
	  }
	  return array;
	}

	var _copyArray = copyArray;

	/** Built-in value references. */
	var objectCreate = Object.create;

	/**
	 * The base implementation of `_.create` without support for assigning
	 * properties to the created object.
	 *
	 * @private
	 * @param {Object} proto The object to inherit from.
	 * @returns {Object} Returns the new object.
	 */
	var baseCreate = (function() {
	  function object() {}
	  return function(proto) {
	    if (!isObject_1(proto)) {
	      return {};
	    }
	    if (objectCreate) {
	      return objectCreate(proto);
	    }
	    object.prototype = proto;
	    var result = new object;
	    object.prototype = undefined;
	    return result;
	  };
	}());

	var _baseCreate = baseCreate;

	/** Used for built-in method references. */
	var objectProto$6 = Object.prototype;

	/**
	 * Checks if `value` is likely a prototype object.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a prototype, else `false`.
	 */
	function isPrototype(value) {
	  var Ctor = value && value.constructor,
	      proto = (typeof Ctor == 'function' && Ctor.prototype) || objectProto$6;

	  return value === proto;
	}

	var _isPrototype = isPrototype;

	/**
	 * Initializes an object clone.
	 *
	 * @private
	 * @param {Object} object The object to clone.
	 * @returns {Object} Returns the initialized clone.
	 */
	function initCloneObject(object) {
	  return (typeof object.constructor == 'function' && !_isPrototype(object))
	    ? _baseCreate(_getPrototype(object))
	    : {};
	}

	var _initCloneObject = initCloneObject;

	/** `Object#toString` result references. */
	var argsTag = '[object Arguments]';

	/**
	 * The base implementation of `_.isArguments`.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is an `arguments` object,
	 */
	function baseIsArguments(value) {
	  return isObjectLike_1(value) && _baseGetTag(value) == argsTag;
	}

	var _baseIsArguments = baseIsArguments;

	/** Used for built-in method references. */
	var objectProto$7 = Object.prototype;

	/** Used to check objects for own properties. */
	var hasOwnProperty$5 = objectProto$7.hasOwnProperty;

	/** Built-in value references. */
	var propertyIsEnumerable = objectProto$7.propertyIsEnumerable;

	/**
	 * Checks if `value` is likely an `arguments` object.
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is an `arguments` object,
	 *  else `false`.
	 * @example
	 *
	 * _.isArguments(function() { return arguments; }());
	 * // => true
	 *
	 * _.isArguments([1, 2, 3]);
	 * // => false
	 */
	var isArguments = _baseIsArguments(function() { return arguments; }()) ? _baseIsArguments : function(value) {
	  return isObjectLike_1(value) && hasOwnProperty$5.call(value, 'callee') &&
	    !propertyIsEnumerable.call(value, 'callee');
	};

	var isArguments_1 = isArguments;

	/**
	 * Checks if `value` is classified as an `Array` object.
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is an array, else `false`.
	 * @example
	 *
	 * _.isArray([1, 2, 3]);
	 * // => true
	 *
	 * _.isArray(document.body.children);
	 * // => false
	 *
	 * _.isArray('abc');
	 * // => false
	 *
	 * _.isArray(_.noop);
	 * // => false
	 */
	var isArray = Array.isArray;

	var isArray_1 = isArray;

	/** Used as references for various `Number` constants. */
	var MAX_SAFE_INTEGER = 9007199254740991;

	/**
	 * Checks if `value` is a valid array-like length.
	 *
	 * **Note:** This method is loosely based on
	 * [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
	 * @example
	 *
	 * _.isLength(3);
	 * // => true
	 *
	 * _.isLength(Number.MIN_VALUE);
	 * // => false
	 *
	 * _.isLength(Infinity);
	 * // => false
	 *
	 * _.isLength('3');
	 * // => false
	 */
	function isLength(value) {
	  return typeof value == 'number' &&
	    value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
	}

	var isLength_1 = isLength;

	/**
	 * Checks if `value` is array-like. A value is considered array-like if it's
	 * not a function and has a `value.length` that's an integer greater than or
	 * equal to `0` and less than or equal to `Number.MAX_SAFE_INTEGER`.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is array-like, else `false`.
	 * @example
	 *
	 * _.isArrayLike([1, 2, 3]);
	 * // => true
	 *
	 * _.isArrayLike(document.body.children);
	 * // => true
	 *
	 * _.isArrayLike('abc');
	 * // => true
	 *
	 * _.isArrayLike(_.noop);
	 * // => false
	 */
	function isArrayLike(value) {
	  return value != null && isLength_1(value.length) && !isFunction_1(value);
	}

	var isArrayLike_1 = isArrayLike;

	/**
	 * This method is like `_.isArrayLike` except that it also checks if `value`
	 * is an object.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is an array-like object,
	 *  else `false`.
	 * @example
	 *
	 * _.isArrayLikeObject([1, 2, 3]);
	 * // => true
	 *
	 * _.isArrayLikeObject(document.body.children);
	 * // => true
	 *
	 * _.isArrayLikeObject('abc');
	 * // => false
	 *
	 * _.isArrayLikeObject(_.noop);
	 * // => false
	 */
	function isArrayLikeObject(value) {
	  return isObjectLike_1(value) && isArrayLike_1(value);
	}

	var isArrayLikeObject_1 = isArrayLikeObject;

	/**
	 * This method returns `false`.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.13.0
	 * @category Util
	 * @returns {boolean} Returns `false`.
	 * @example
	 *
	 * _.times(2, _.stubFalse);
	 * // => [false, false]
	 */
	function stubFalse() {
	  return false;
	}

	var stubFalse_1 = stubFalse;

	var isBuffer_1 = createCommonjsModule(function (module, exports) {
	/** Detect free variable `exports`. */
	var freeExports =  exports && !exports.nodeType && exports;

	/** Detect free variable `module`. */
	var freeModule = freeExports && 'object' == 'object' && module && !module.nodeType && module;

	/** Detect the popular CommonJS extension `module.exports`. */
	var moduleExports = freeModule && freeModule.exports === freeExports;

	/** Built-in value references. */
	var Buffer = moduleExports ? _root.Buffer : undefined;

	/* Built-in method references for those with the same name as other `lodash` methods. */
	var nativeIsBuffer = Buffer ? Buffer.isBuffer : undefined;

	/**
	 * Checks if `value` is a buffer.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.3.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a buffer, else `false`.
	 * @example
	 *
	 * _.isBuffer(new Buffer(2));
	 * // => true
	 *
	 * _.isBuffer(new Uint8Array(2));
	 * // => false
	 */
	var isBuffer = nativeIsBuffer || stubFalse_1;

	module.exports = isBuffer;
	});

	/** `Object#toString` result references. */
	var argsTag$1 = '[object Arguments]',
	    arrayTag = '[object Array]',
	    boolTag = '[object Boolean]',
	    dateTag = '[object Date]',
	    errorTag = '[object Error]',
	    funcTag$1 = '[object Function]',
	    mapTag = '[object Map]',
	    numberTag = '[object Number]',
	    objectTag$1 = '[object Object]',
	    regexpTag = '[object RegExp]',
	    setTag = '[object Set]',
	    stringTag = '[object String]',
	    weakMapTag = '[object WeakMap]';

	var arrayBufferTag = '[object ArrayBuffer]',
	    dataViewTag = '[object DataView]',
	    float32Tag = '[object Float32Array]',
	    float64Tag = '[object Float64Array]',
	    int8Tag = '[object Int8Array]',
	    int16Tag = '[object Int16Array]',
	    int32Tag = '[object Int32Array]',
	    uint8Tag = '[object Uint8Array]',
	    uint8ClampedTag = '[object Uint8ClampedArray]',
	    uint16Tag = '[object Uint16Array]',
	    uint32Tag = '[object Uint32Array]';

	/** Used to identify `toStringTag` values of typed arrays. */
	var typedArrayTags = {};
	typedArrayTags[float32Tag] = typedArrayTags[float64Tag] =
	typedArrayTags[int8Tag] = typedArrayTags[int16Tag] =
	typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] =
	typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] =
	typedArrayTags[uint32Tag] = true;
	typedArrayTags[argsTag$1] = typedArrayTags[arrayTag] =
	typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] =
	typedArrayTags[dataViewTag] = typedArrayTags[dateTag] =
	typedArrayTags[errorTag] = typedArrayTags[funcTag$1] =
	typedArrayTags[mapTag] = typedArrayTags[numberTag] =
	typedArrayTags[objectTag$1] = typedArrayTags[regexpTag] =
	typedArrayTags[setTag] = typedArrayTags[stringTag] =
	typedArrayTags[weakMapTag] = false;

	/**
	 * The base implementation of `_.isTypedArray` without Node.js optimizations.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
	 */
	function baseIsTypedArray(value) {
	  return isObjectLike_1(value) &&
	    isLength_1(value.length) && !!typedArrayTags[_baseGetTag(value)];
	}

	var _baseIsTypedArray = baseIsTypedArray;

	/**
	 * The base implementation of `_.unary` without support for storing metadata.
	 *
	 * @private
	 * @param {Function} func The function to cap arguments for.
	 * @returns {Function} Returns the new capped function.
	 */
	function baseUnary(func) {
	  return function(value) {
	    return func(value);
	  };
	}

	var _baseUnary = baseUnary;

	var _nodeUtil = createCommonjsModule(function (module, exports) {
	/** Detect free variable `exports`. */
	var freeExports =  exports && !exports.nodeType && exports;

	/** Detect free variable `module`. */
	var freeModule = freeExports && 'object' == 'object' && module && !module.nodeType && module;

	/** Detect the popular CommonJS extension `module.exports`. */
	var moduleExports = freeModule && freeModule.exports === freeExports;

	/** Detect free variable `process` from Node.js. */
	var freeProcess = moduleExports && _freeGlobal.process;

	/** Used to access faster Node.js helpers. */
	var nodeUtil = (function() {
	  try {
	    // Use `util.types` for Node.js 10+.
	    var types = freeModule && freeModule.require && freeModule.require('util').types;

	    if (types) {
	      return types;
	    }

	    // Legacy `process.binding('util')` for Node.js < 10.
	    return freeProcess && freeProcess.binding && freeProcess.binding('util');
	  } catch (e) {}
	}());

	module.exports = nodeUtil;
	});

	/* Node.js helper references. */
	var nodeIsTypedArray = _nodeUtil && _nodeUtil.isTypedArray;

	/**
	 * Checks if `value` is classified as a typed array.
	 *
	 * @static
	 * @memberOf _
	 * @since 3.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
	 * @example
	 *
	 * _.isTypedArray(new Uint8Array);
	 * // => true
	 *
	 * _.isTypedArray([]);
	 * // => false
	 */
	var isTypedArray = nodeIsTypedArray ? _baseUnary(nodeIsTypedArray) : _baseIsTypedArray;

	var isTypedArray_1 = isTypedArray;

	/**
	 * Gets the value at `key`, unless `key` is "__proto__" or "constructor".
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @param {string} key The key of the property to get.
	 * @returns {*} Returns the property value.
	 */
	function safeGet(object, key) {
	  if (key === 'constructor' && typeof object[key] === 'function') {
	    return;
	  }

	  if (key == '__proto__') {
	    return;
	  }

	  return object[key];
	}

	var _safeGet = safeGet;

	/** Used for built-in method references. */
	var objectProto$8 = Object.prototype;

	/** Used to check objects for own properties. */
	var hasOwnProperty$6 = objectProto$8.hasOwnProperty;

	/**
	 * Assigns `value` to `key` of `object` if the existing value is not equivalent
	 * using [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
	 * for equality comparisons.
	 *
	 * @private
	 * @param {Object} object The object to modify.
	 * @param {string} key The key of the property to assign.
	 * @param {*} value The value to assign.
	 */
	function assignValue(object, key, value) {
	  var objValue = object[key];
	  if (!(hasOwnProperty$6.call(object, key) && eq_1(objValue, value)) ||
	      (value === undefined && !(key in object))) {
	    _baseAssignValue(object, key, value);
	  }
	}

	var _assignValue = assignValue;

	/**
	 * Copies properties of `source` to `object`.
	 *
	 * @private
	 * @param {Object} source The object to copy properties from.
	 * @param {Array} props The property identifiers to copy.
	 * @param {Object} [object={}] The object to copy properties to.
	 * @param {Function} [customizer] The function to customize copied values.
	 * @returns {Object} Returns `object`.
	 */
	function copyObject(source, props, object, customizer) {
	  var isNew = !object;
	  object || (object = {});

	  var index = -1,
	      length = props.length;

	  while (++index < length) {
	    var key = props[index];

	    var newValue = customizer
	      ? customizer(object[key], source[key], key, object, source)
	      : undefined;

	    if (newValue === undefined) {
	      newValue = source[key];
	    }
	    if (isNew) {
	      _baseAssignValue(object, key, newValue);
	    } else {
	      _assignValue(object, key, newValue);
	    }
	  }
	  return object;
	}

	var _copyObject = copyObject;

	/**
	 * The base implementation of `_.times` without support for iteratee shorthands
	 * or max array length checks.
	 *
	 * @private
	 * @param {number} n The number of times to invoke `iteratee`.
	 * @param {Function} iteratee The function invoked per iteration.
	 * @returns {Array} Returns the array of results.
	 */
	function baseTimes(n, iteratee) {
	  var index = -1,
	      result = Array(n);

	  while (++index < n) {
	    result[index] = iteratee(index);
	  }
	  return result;
	}

	var _baseTimes = baseTimes;

	/** Used as references for various `Number` constants. */
	var MAX_SAFE_INTEGER$1 = 9007199254740991;

	/** Used to detect unsigned integer values. */
	var reIsUint = /^(?:0|[1-9]\d*)$/;

	/**
	 * Checks if `value` is a valid array-like index.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @param {number} [length=MAX_SAFE_INTEGER] The upper bounds of a valid index.
	 * @returns {boolean} Returns `true` if `value` is a valid index, else `false`.
	 */
	function isIndex(value, length) {
	  var type = typeof value;
	  length = length == null ? MAX_SAFE_INTEGER$1 : length;

	  return !!length &&
	    (type == 'number' ||
	      (type != 'symbol' && reIsUint.test(value))) &&
	        (value > -1 && value % 1 == 0 && value < length);
	}

	var _isIndex = isIndex;

	/** Used for built-in method references. */
	var objectProto$9 = Object.prototype;

	/** Used to check objects for own properties. */
	var hasOwnProperty$7 = objectProto$9.hasOwnProperty;

	/**
	 * Creates an array of the enumerable property names of the array-like `value`.
	 *
	 * @private
	 * @param {*} value The value to query.
	 * @param {boolean} inherited Specify returning inherited property names.
	 * @returns {Array} Returns the array of property names.
	 */
	function arrayLikeKeys(value, inherited) {
	  var isArr = isArray_1(value),
	      isArg = !isArr && isArguments_1(value),
	      isBuff = !isArr && !isArg && isBuffer_1(value),
	      isType = !isArr && !isArg && !isBuff && isTypedArray_1(value),
	      skipIndexes = isArr || isArg || isBuff || isType,
	      result = skipIndexes ? _baseTimes(value.length, String) : [],
	      length = result.length;

	  for (var key in value) {
	    if ((inherited || hasOwnProperty$7.call(value, key)) &&
	        !(skipIndexes && (
	           // Safari 9 has enumerable `arguments.length` in strict mode.
	           key == 'length' ||
	           // Node.js 0.10 has enumerable non-index properties on buffers.
	           (isBuff && (key == 'offset' || key == 'parent')) ||
	           // PhantomJS 2 has enumerable non-index properties on typed arrays.
	           (isType && (key == 'buffer' || key == 'byteLength' || key == 'byteOffset')) ||
	           // Skip index properties.
	           _isIndex(key, length)
	        ))) {
	      result.push(key);
	    }
	  }
	  return result;
	}

	var _arrayLikeKeys = arrayLikeKeys;

	/**
	 * This function is like
	 * [`Object.keys`](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
	 * except that it includes inherited enumerable properties.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @returns {Array} Returns the array of property names.
	 */
	function nativeKeysIn(object) {
	  var result = [];
	  if (object != null) {
	    for (var key in Object(object)) {
	      result.push(key);
	    }
	  }
	  return result;
	}

	var _nativeKeysIn = nativeKeysIn;

	/** Used for built-in method references. */
	var objectProto$a = Object.prototype;

	/** Used to check objects for own properties. */
	var hasOwnProperty$8 = objectProto$a.hasOwnProperty;

	/**
	 * The base implementation of `_.keysIn` which doesn't treat sparse arrays as dense.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @returns {Array} Returns the array of property names.
	 */
	function baseKeysIn(object) {
	  if (!isObject_1(object)) {
	    return _nativeKeysIn(object);
	  }
	  var isProto = _isPrototype(object),
	      result = [];

	  for (var key in object) {
	    if (!(key == 'constructor' && (isProto || !hasOwnProperty$8.call(object, key)))) {
	      result.push(key);
	    }
	  }
	  return result;
	}

	var _baseKeysIn = baseKeysIn;

	/**
	 * Creates an array of the own and inherited enumerable property names of `object`.
	 *
	 * **Note:** Non-object values are coerced to objects.
	 *
	 * @static
	 * @memberOf _
	 * @since 3.0.0
	 * @category Object
	 * @param {Object} object The object to query.
	 * @returns {Array} Returns the array of property names.
	 * @example
	 *
	 * function Foo() {
	 *   this.a = 1;
	 *   this.b = 2;
	 * }
	 *
	 * Foo.prototype.c = 3;
	 *
	 * _.keysIn(new Foo);
	 * // => ['a', 'b', 'c'] (iteration order is not guaranteed)
	 */
	function keysIn(object) {
	  return isArrayLike_1(object) ? _arrayLikeKeys(object, true) : _baseKeysIn(object);
	}

	var keysIn_1 = keysIn;

	/**
	 * Converts `value` to a plain object flattening inherited enumerable string
	 * keyed properties of `value` to own properties of the plain object.
	 *
	 * @static
	 * @memberOf _
	 * @since 3.0.0
	 * @category Lang
	 * @param {*} value The value to convert.
	 * @returns {Object} Returns the converted plain object.
	 * @example
	 *
	 * function Foo() {
	 *   this.b = 2;
	 * }
	 *
	 * Foo.prototype.c = 3;
	 *
	 * _.assign({ 'a': 1 }, new Foo);
	 * // => { 'a': 1, 'b': 2 }
	 *
	 * _.assign({ 'a': 1 }, _.toPlainObject(new Foo));
	 * // => { 'a': 1, 'b': 2, 'c': 3 }
	 */
	function toPlainObject(value) {
	  return _copyObject(value, keysIn_1(value));
	}

	var toPlainObject_1 = toPlainObject;

	/**
	 * A specialized version of `baseMerge` for arrays and objects which performs
	 * deep merges and tracks traversed objects enabling objects with circular
	 * references to be merged.
	 *
	 * @private
	 * @param {Object} object The destination object.
	 * @param {Object} source The source object.
	 * @param {string} key The key of the value to merge.
	 * @param {number} srcIndex The index of `source`.
	 * @param {Function} mergeFunc The function to merge values.
	 * @param {Function} [customizer] The function to customize assigned values.
	 * @param {Object} [stack] Tracks traversed source values and their merged
	 *  counterparts.
	 */
	function baseMergeDeep(object, source, key, srcIndex, mergeFunc, customizer, stack) {
	  var objValue = _safeGet(object, key),
	      srcValue = _safeGet(source, key),
	      stacked = stack.get(srcValue);

	  if (stacked) {
	    _assignMergeValue(object, key, stacked);
	    return;
	  }
	  var newValue = customizer
	    ? customizer(objValue, srcValue, (key + ''), object, source, stack)
	    : undefined;

	  var isCommon = newValue === undefined;

	  if (isCommon) {
	    var isArr = isArray_1(srcValue),
	        isBuff = !isArr && isBuffer_1(srcValue),
	        isTyped = !isArr && !isBuff && isTypedArray_1(srcValue);

	    newValue = srcValue;
	    if (isArr || isBuff || isTyped) {
	      if (isArray_1(objValue)) {
	        newValue = objValue;
	      }
	      else if (isArrayLikeObject_1(objValue)) {
	        newValue = _copyArray(objValue);
	      }
	      else if (isBuff) {
	        isCommon = false;
	        newValue = _cloneBuffer(srcValue, true);
	      }
	      else if (isTyped) {
	        isCommon = false;
	        newValue = _cloneTypedArray(srcValue, true);
	      }
	      else {
	        newValue = [];
	      }
	    }
	    else if (isPlainObject_1(srcValue) || isArguments_1(srcValue)) {
	      newValue = objValue;
	      if (isArguments_1(objValue)) {
	        newValue = toPlainObject_1(objValue);
	      }
	      else if (!isObject_1(objValue) || isFunction_1(objValue)) {
	        newValue = _initCloneObject(srcValue);
	      }
	    }
	    else {
	      isCommon = false;
	    }
	  }
	  if (isCommon) {
	    // Recursively merge objects and arrays (susceptible to call stack limits).
	    stack.set(srcValue, newValue);
	    mergeFunc(newValue, srcValue, srcIndex, customizer, stack);
	    stack['delete'](srcValue);
	  }
	  _assignMergeValue(object, key, newValue);
	}

	var _baseMergeDeep = baseMergeDeep;

	/**
	 * The base implementation of `_.merge` without support for multiple sources.
	 *
	 * @private
	 * @param {Object} object The destination object.
	 * @param {Object} source The source object.
	 * @param {number} srcIndex The index of `source`.
	 * @param {Function} [customizer] The function to customize merged values.
	 * @param {Object} [stack] Tracks traversed source values and their merged
	 *  counterparts.
	 */
	function baseMerge(object, source, srcIndex, customizer, stack) {
	  if (object === source) {
	    return;
	  }
	  _baseFor(source, function(srcValue, key) {
	    stack || (stack = new _Stack);
	    if (isObject_1(srcValue)) {
	      _baseMergeDeep(object, source, key, srcIndex, baseMerge, customizer, stack);
	    }
	    else {
	      var newValue = customizer
	        ? customizer(_safeGet(object, key), srcValue, (key + ''), object, source, stack)
	        : undefined;

	      if (newValue === undefined) {
	        newValue = srcValue;
	      }
	      _assignMergeValue(object, key, newValue);
	    }
	  }, keysIn_1);
	}

	var _baseMerge = baseMerge;

	/**
	 * This method returns the first argument it receives.
	 *
	 * @static
	 * @since 0.1.0
	 * @memberOf _
	 * @category Util
	 * @param {*} value Any value.
	 * @returns {*} Returns `value`.
	 * @example
	 *
	 * var object = { 'a': 1 };
	 *
	 * console.log(_.identity(object) === object);
	 * // => true
	 */
	function identity(value) {
	  return value;
	}

	var identity_1 = identity;

	/**
	 * A faster alternative to `Function#apply`, this function invokes `func`
	 * with the `this` binding of `thisArg` and the arguments of `args`.
	 *
	 * @private
	 * @param {Function} func The function to invoke.
	 * @param {*} thisArg The `this` binding of `func`.
	 * @param {Array} args The arguments to invoke `func` with.
	 * @returns {*} Returns the result of `func`.
	 */
	function apply(func, thisArg, args) {
	  switch (args.length) {
	    case 0: return func.call(thisArg);
	    case 1: return func.call(thisArg, args[0]);
	    case 2: return func.call(thisArg, args[0], args[1]);
	    case 3: return func.call(thisArg, args[0], args[1], args[2]);
	  }
	  return func.apply(thisArg, args);
	}

	var _apply = apply;

	/* Built-in method references for those with the same name as other `lodash` methods. */
	var nativeMax = Math.max;

	/**
	 * A specialized version of `baseRest` which transforms the rest array.
	 *
	 * @private
	 * @param {Function} func The function to apply a rest parameter to.
	 * @param {number} [start=func.length-1] The start position of the rest parameter.
	 * @param {Function} transform The rest array transform.
	 * @returns {Function} Returns the new function.
	 */
	function overRest(func, start, transform) {
	  start = nativeMax(start === undefined ? (func.length - 1) : start, 0);
	  return function() {
	    var args = arguments,
	        index = -1,
	        length = nativeMax(args.length - start, 0),
	        array = Array(length);

	    while (++index < length) {
	      array[index] = args[start + index];
	    }
	    index = -1;
	    var otherArgs = Array(start + 1);
	    while (++index < start) {
	      otherArgs[index] = args[index];
	    }
	    otherArgs[start] = transform(array);
	    return _apply(func, this, otherArgs);
	  };
	}

	var _overRest = overRest;

	/**
	 * Creates a function that returns `value`.
	 *
	 * @static
	 * @memberOf _
	 * @since 2.4.0
	 * @category Util
	 * @param {*} value The value to return from the new function.
	 * @returns {Function} Returns the new constant function.
	 * @example
	 *
	 * var objects = _.times(2, _.constant({ 'a': 1 }));
	 *
	 * console.log(objects);
	 * // => [{ 'a': 1 }, { 'a': 1 }]
	 *
	 * console.log(objects[0] === objects[1]);
	 * // => true
	 */
	function constant(value) {
	  return function() {
	    return value;
	  };
	}

	var constant_1 = constant;

	/**
	 * The base implementation of `setToString` without support for hot loop shorting.
	 *
	 * @private
	 * @param {Function} func The function to modify.
	 * @param {Function} string The `toString` result.
	 * @returns {Function} Returns `func`.
	 */
	var baseSetToString = !_defineProperty ? identity_1 : function(func, string) {
	  return _defineProperty(func, 'toString', {
	    'configurable': true,
	    'enumerable': false,
	    'value': constant_1(string),
	    'writable': true
	  });
	};

	var _baseSetToString = baseSetToString;

	/** Used to detect hot functions by number of calls within a span of milliseconds. */
	var HOT_COUNT = 800,
	    HOT_SPAN = 16;

	/* Built-in method references for those with the same name as other `lodash` methods. */
	var nativeNow = Date.now;

	/**
	 * Creates a function that'll short out and invoke `identity` instead
	 * of `func` when it's called `HOT_COUNT` or more times in `HOT_SPAN`
	 * milliseconds.
	 *
	 * @private
	 * @param {Function} func The function to restrict.
	 * @returns {Function} Returns the new shortable function.
	 */
	function shortOut(func) {
	  var count = 0,
	      lastCalled = 0;

	  return function() {
	    var stamp = nativeNow(),
	        remaining = HOT_SPAN - (stamp - lastCalled);

	    lastCalled = stamp;
	    if (remaining > 0) {
	      if (++count >= HOT_COUNT) {
	        return arguments[0];
	      }
	    } else {
	      count = 0;
	    }
	    return func.apply(undefined, arguments);
	  };
	}

	var _shortOut = shortOut;

	/**
	 * Sets the `toString` method of `func` to return `string`.
	 *
	 * @private
	 * @param {Function} func The function to modify.
	 * @param {Function} string The `toString` result.
	 * @returns {Function} Returns `func`.
	 */
	var setToString = _shortOut(_baseSetToString);

	var _setToString = setToString;

	/**
	 * The base implementation of `_.rest` which doesn't validate or coerce arguments.
	 *
	 * @private
	 * @param {Function} func The function to apply a rest parameter to.
	 * @param {number} [start=func.length-1] The start position of the rest parameter.
	 * @returns {Function} Returns the new function.
	 */
	function baseRest(func, start) {
	  return _setToString(_overRest(func, start, identity_1), func + '');
	}

	var _baseRest = baseRest;

	/**
	 * Checks if the given arguments are from an iteratee call.
	 *
	 * @private
	 * @param {*} value The potential iteratee value argument.
	 * @param {*} index The potential iteratee index or key argument.
	 * @param {*} object The potential iteratee object argument.
	 * @returns {boolean} Returns `true` if the arguments are from an iteratee call,
	 *  else `false`.
	 */
	function isIterateeCall(value, index, object) {
	  if (!isObject_1(object)) {
	    return false;
	  }
	  var type = typeof index;
	  if (type == 'number'
	        ? (isArrayLike_1(object) && _isIndex(index, object.length))
	        : (type == 'string' && index in object)
	      ) {
	    return eq_1(object[index], value);
	  }
	  return false;
	}

	var _isIterateeCall = isIterateeCall;

	/**
	 * Creates a function like `_.assign`.
	 *
	 * @private
	 * @param {Function} assigner The function to assign values.
	 * @returns {Function} Returns the new assigner function.
	 */
	function createAssigner(assigner) {
	  return _baseRest(function(object, sources) {
	    var index = -1,
	        length = sources.length,
	        customizer = length > 1 ? sources[length - 1] : undefined,
	        guard = length > 2 ? sources[2] : undefined;

	    customizer = (assigner.length > 3 && typeof customizer == 'function')
	      ? (length--, customizer)
	      : undefined;

	    if (guard && _isIterateeCall(sources[0], sources[1], guard)) {
	      customizer = length < 3 ? undefined : customizer;
	      length = 1;
	    }
	    object = Object(object);
	    while (++index < length) {
	      var source = sources[index];
	      if (source) {
	        assigner(object, source, index, customizer);
	      }
	    }
	    return object;
	  });
	}

	var _createAssigner = createAssigner;

	/**
	 * This method is like `_.assign` except that it recursively merges own and
	 * inherited enumerable string keyed properties of source objects into the
	 * destination object. Source properties that resolve to `undefined` are
	 * skipped if a destination value exists. Array and plain object properties
	 * are merged recursively. Other objects and value types are overridden by
	 * assignment. Source objects are applied from left to right. Subsequent
	 * sources overwrite property assignments of previous sources.
	 *
	 * **Note:** This method mutates `object`.
	 *
	 * @static
	 * @memberOf _
	 * @since 0.5.0
	 * @category Object
	 * @param {Object} object The destination object.
	 * @param {...Object} [sources] The source objects.
	 * @returns {Object} Returns `object`.
	 * @example
	 *
	 * var object = {
	 *   'a': [{ 'b': 2 }, { 'd': 4 }]
	 * };
	 *
	 * var other = {
	 *   'a': [{ 'c': 3 }, { 'e': 5 }]
	 * };
	 *
	 * _.merge(object, other);
	 * // => { 'a': [{ 'b': 2, 'c': 3 }, { 'd': 4, 'e': 5 }] }
	 */
	var merge = _createAssigner(function(object, source, srcIndex) {
	  _baseMerge(object, source, srcIndex);
	});

	var merge_1 = merge;

	/** `Object#toString` result references. */
	var symbolTag = '[object Symbol]';

	/**
	 * Checks if `value` is classified as a `Symbol` primitive or object.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to check.
	 * @returns {boolean} Returns `true` if `value` is a symbol, else `false`.
	 * @example
	 *
	 * _.isSymbol(Symbol.iterator);
	 * // => true
	 *
	 * _.isSymbol('abc');
	 * // => false
	 */
	function isSymbol(value) {
	  return typeof value == 'symbol' ||
	    (isObjectLike_1(value) && _baseGetTag(value) == symbolTag);
	}

	var isSymbol_1 = isSymbol;

	/** Used to match property names within property paths. */
	var reIsDeepProp = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/,
	    reIsPlainProp = /^\w*$/;

	/**
	 * Checks if `value` is a property name and not a property path.
	 *
	 * @private
	 * @param {*} value The value to check.
	 * @param {Object} [object] The object to query keys on.
	 * @returns {boolean} Returns `true` if `value` is a property name, else `false`.
	 */
	function isKey(value, object) {
	  if (isArray_1(value)) {
	    return false;
	  }
	  var type = typeof value;
	  if (type == 'number' || type == 'symbol' || type == 'boolean' ||
	      value == null || isSymbol_1(value)) {
	    return true;
	  }
	  return reIsPlainProp.test(value) || !reIsDeepProp.test(value) ||
	    (object != null && value in Object(object));
	}

	var _isKey = isKey;

	/** Error message constants. */
	var FUNC_ERROR_TEXT = 'Expected a function';

	/**
	 * Creates a function that memoizes the result of `func`. If `resolver` is
	 * provided, it determines the cache key for storing the result based on the
	 * arguments provided to the memoized function. By default, the first argument
	 * provided to the memoized function is used as the map cache key. The `func`
	 * is invoked with the `this` binding of the memoized function.
	 *
	 * **Note:** The cache is exposed as the `cache` property on the memoized
	 * function. Its creation may be customized by replacing the `_.memoize.Cache`
	 * constructor with one whose instances implement the
	 * [`Map`](http://ecma-international.org/ecma-262/7.0/#sec-properties-of-the-map-prototype-object)
	 * method interface of `clear`, `delete`, `get`, `has`, and `set`.
	 *
	 * @static
	 * @memberOf _
	 * @since 0.1.0
	 * @category Function
	 * @param {Function} func The function to have its output memoized.
	 * @param {Function} [resolver] The function to resolve the cache key.
	 * @returns {Function} Returns the new memoized function.
	 * @example
	 *
	 * var object = { 'a': 1, 'b': 2 };
	 * var other = { 'c': 3, 'd': 4 };
	 *
	 * var values = _.memoize(_.values);
	 * values(object);
	 * // => [1, 2]
	 *
	 * values(other);
	 * // => [3, 4]
	 *
	 * object.a = 2;
	 * values(object);
	 * // => [1, 2]
	 *
	 * // Modify the result cache.
	 * values.cache.set(object, ['a', 'b']);
	 * values(object);
	 * // => ['a', 'b']
	 *
	 * // Replace `_.memoize.Cache`.
	 * _.memoize.Cache = WeakMap;
	 */
	function memoize(func, resolver) {
	  if (typeof func != 'function' || (resolver != null && typeof resolver != 'function')) {
	    throw new TypeError(FUNC_ERROR_TEXT);
	  }
	  var memoized = function() {
	    var args = arguments,
	        key = resolver ? resolver.apply(this, args) : args[0],
	        cache = memoized.cache;

	    if (cache.has(key)) {
	      return cache.get(key);
	    }
	    var result = func.apply(this, args);
	    memoized.cache = cache.set(key, result) || cache;
	    return result;
	  };
	  memoized.cache = new (memoize.Cache || _MapCache);
	  return memoized;
	}

	// Expose `MapCache`.
	memoize.Cache = _MapCache;

	var memoize_1 = memoize;

	/** Used as the maximum memoize cache size. */
	var MAX_MEMOIZE_SIZE = 500;

	/**
	 * A specialized version of `_.memoize` which clears the memoized function's
	 * cache when it exceeds `MAX_MEMOIZE_SIZE`.
	 *
	 * @private
	 * @param {Function} func The function to have its output memoized.
	 * @returns {Function} Returns the new memoized function.
	 */
	function memoizeCapped(func) {
	  var result = memoize_1(func, function(key) {
	    if (cache.size === MAX_MEMOIZE_SIZE) {
	      cache.clear();
	    }
	    return key;
	  });

	  var cache = result.cache;
	  return result;
	}

	var _memoizeCapped = memoizeCapped;

	/** Used to match property names within property paths. */
	var rePropName = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g;

	/** Used to match backslashes in property paths. */
	var reEscapeChar = /\\(\\)?/g;

	/**
	 * Converts `string` to a property path array.
	 *
	 * @private
	 * @param {string} string The string to convert.
	 * @returns {Array} Returns the property path array.
	 */
	var stringToPath = _memoizeCapped(function(string) {
	  var result = [];
	  if (string.charCodeAt(0) === 46 /* . */) {
	    result.push('');
	  }
	  string.replace(rePropName, function(match, number, quote, subString) {
	    result.push(quote ? subString.replace(reEscapeChar, '$1') : (number || match));
	  });
	  return result;
	});

	var _stringToPath = stringToPath;

	/**
	 * A specialized version of `_.map` for arrays without support for iteratee
	 * shorthands.
	 *
	 * @private
	 * @param {Array} [array] The array to iterate over.
	 * @param {Function} iteratee The function invoked per iteration.
	 * @returns {Array} Returns the new mapped array.
	 */
	function arrayMap(array, iteratee) {
	  var index = -1,
	      length = array == null ? 0 : array.length,
	      result = Array(length);

	  while (++index < length) {
	    result[index] = iteratee(array[index], index, array);
	  }
	  return result;
	}

	var _arrayMap = arrayMap;

	/** Used as references for various `Number` constants. */
	var INFINITY = 1 / 0;

	/** Used to convert symbols to primitives and strings. */
	var symbolProto = _Symbol ? _Symbol.prototype : undefined,
	    symbolToString = symbolProto ? symbolProto.toString : undefined;

	/**
	 * The base implementation of `_.toString` which doesn't convert nullish
	 * values to empty strings.
	 *
	 * @private
	 * @param {*} value The value to process.
	 * @returns {string} Returns the string.
	 */
	function baseToString(value) {
	  // Exit early for strings to avoid a performance hit in some environments.
	  if (typeof value == 'string') {
	    return value;
	  }
	  if (isArray_1(value)) {
	    // Recursively convert values (susceptible to call stack limits).
	    return _arrayMap(value, baseToString) + '';
	  }
	  if (isSymbol_1(value)) {
	    return symbolToString ? symbolToString.call(value) : '';
	  }
	  var result = (value + '');
	  return (result == '0' && (1 / value) == -INFINITY) ? '-0' : result;
	}

	var _baseToString = baseToString;

	/**
	 * Converts `value` to a string. An empty string is returned for `null`
	 * and `undefined` values. The sign of `-0` is preserved.
	 *
	 * @static
	 * @memberOf _
	 * @since 4.0.0
	 * @category Lang
	 * @param {*} value The value to convert.
	 * @returns {string} Returns the converted string.
	 * @example
	 *
	 * _.toString(null);
	 * // => ''
	 *
	 * _.toString(-0);
	 * // => '-0'
	 *
	 * _.toString([1, 2, 3]);
	 * // => '1,2,3'
	 */
	function toString(value) {
	  return value == null ? '' : _baseToString(value);
	}

	var toString_1 = toString;

	/**
	 * Casts `value` to a path array if it's not one.
	 *
	 * @private
	 * @param {*} value The value to inspect.
	 * @param {Object} [object] The object to query keys on.
	 * @returns {Array} Returns the cast property path array.
	 */
	function castPath(value, object) {
	  if (isArray_1(value)) {
	    return value;
	  }
	  return _isKey(value, object) ? [value] : _stringToPath(toString_1(value));
	}

	var _castPath = castPath;

	/** Used as references for various `Number` constants. */
	var INFINITY$1 = 1 / 0;

	/**
	 * Converts `value` to a string key if it's not a string or symbol.
	 *
	 * @private
	 * @param {*} value The value to inspect.
	 * @returns {string|symbol} Returns the key.
	 */
	function toKey(value) {
	  if (typeof value == 'string' || isSymbol_1(value)) {
	    return value;
	  }
	  var result = (value + '');
	  return (result == '0' && (1 / value) == -INFINITY$1) ? '-0' : result;
	}

	var _toKey = toKey;

	/**
	 * The base implementation of `_.get` without support for default values.
	 *
	 * @private
	 * @param {Object} object The object to query.
	 * @param {Array|string} path The path of the property to get.
	 * @returns {*} Returns the resolved value.
	 */
	function baseGet(object, path) {
	  path = _castPath(path, object);

	  var index = 0,
	      length = path.length;

	  while (object != null && index < length) {
	    object = object[_toKey(path[index++])];
	  }
	  return (index && index == length) ? object : undefined;
	}

	var _baseGet = baseGet;

	/**
	 * Gets the value at `path` of `object`. If the resolved value is
	 * `undefined`, the `defaultValue` is returned in its place.
	 *
	 * @static
	 * @memberOf _
	 * @since 3.7.0
	 * @category Object
	 * @param {Object} object The object to query.
	 * @param {Array|string} path The path of the property to get.
	 * @param {*} [defaultValue] The value returned for `undefined` resolved values.
	 * @returns {*} Returns the resolved value.
	 * @example
	 *
	 * var object = { 'a': [{ 'b': { 'c': 3 } }] };
	 *
	 * _.get(object, 'a[0].b.c');
	 * // => 3
	 *
	 * _.get(object, ['a', '0', 'b', 'c']);
	 * // => 3
	 *
	 * _.get(object, 'a.b.c', 'default');
	 * // => 'default'
	 */
	function get(object, path, defaultValue) {
	  var result = object == null ? undefined : _baseGet(object, path);
	  return result === undefined ? defaultValue : result;
	}

	var get_1 = get;

	/**
	 * @constant DEFAULT_OPTIONS_KEYS the default options keys
	 */
	var DEFAULT_OPTIONS_KEYS = {
	    isEqual: true,
	    isMatchingKey: true,
	    isPromise: true,
	    maxSize: true,
	    onCacheAdd: true,
	    onCacheChange: true,
	    onCacheHit: true,
	    transformKey: true,
	};
	/**
	 * @function slice
	 *
	 * @description
	 * slice.call() pre-bound
	 */
	var slice = Array.prototype.slice;
	/**
	 * @function cloneArray
	 *
	 * @description
	 * clone the array-like object and return the new array
	 *
	 * @param arrayLike the array-like object to clone
	 * @returns the clone as an array
	 */
	function cloneArray(arrayLike) {
	    var length = arrayLike.length;
	    if (!length) {
	        return [];
	    }
	    if (length === 1) {
	        return [arrayLike[0]];
	    }
	    if (length === 2) {
	        return [arrayLike[0], arrayLike[1]];
	    }
	    if (length === 3) {
	        return [arrayLike[0], arrayLike[1], arrayLike[2]];
	    }
	    return slice.call(arrayLike, 0);
	}
	/**
	 * @function getCustomOptions
	 *
	 * @description
	 * get the custom options on the object passed
	 *
	 * @param options the memoization options passed
	 * @returns the custom options passed
	 */
	function getCustomOptions(options) {
	    var customOptions = {};
	    /* eslint-disable no-restricted-syntax */
	    for (var key in options) {
	        if (!DEFAULT_OPTIONS_KEYS[key]) {
	            customOptions[key] = options[key];
	        }
	    }
	    /* eslint-enable */
	    return customOptions;
	}
	/**
	 * @function isMemoized
	 *
	 * @description
	 * is the function passed already memoized
	 *
	 * @param fn the function to test
	 * @returns is the function already memoized
	 */
	function isMemoized(fn) {
	    return (typeof fn === 'function' &&
	        fn.isMemoized);
	}
	/**
	 * @function isSameValueZero
	 *
	 * @description
	 * are the objects equal based on SameValueZero equality
	 *
	 * @param object1 the first object to compare
	 * @param object2 the second object to compare
	 * @returns are the two objects equal
	 */
	function isSameValueZero(object1, object2) {
	    // eslint-disable-next-line no-self-compare
	    return object1 === object2 || (object1 !== object1 && object2 !== object2);
	}
	/**
	 * @function mergeOptions
	 *
	 * @description
	 * merge the options into the target
	 *
	 * @param existingOptions the options provided
	 * @param newOptions the options to include
	 * @returns the merged options
	 */
	function mergeOptions(existingOptions, newOptions) {
	    // @ts-ignore
	    var target = {};
	    /* eslint-disable no-restricted-syntax */
	    for (var key in existingOptions) {
	        target[key] = existingOptions[key];
	    }
	    for (var key in newOptions) {
	        target[key] = newOptions[key];
	    }
	    /* eslint-enable */
	    return target;
	}

	// utils
	var Cache = /** @class */ (function () {
	    function Cache(options) {
	        this.keys = [];
	        this.values = [];
	        this.options = options;
	        var isMatchingKeyFunction = typeof options.isMatchingKey === 'function';
	        if (isMatchingKeyFunction) {
	            this.getKeyIndex = this._getKeyIndexFromMatchingKey;
	        }
	        else if (options.maxSize > 1) {
	            this.getKeyIndex = this._getKeyIndexForMany;
	        }
	        else {
	            this.getKeyIndex = this._getKeyIndexForSingle;
	        }
	        this.canTransformKey = typeof options.transformKey === 'function';
	        this.shouldCloneArguments = this.canTransformKey || isMatchingKeyFunction;
	        this.shouldUpdateOnAdd = typeof options.onCacheAdd === 'function';
	        this.shouldUpdateOnChange = typeof options.onCacheChange === 'function';
	        this.shouldUpdateOnHit = typeof options.onCacheHit === 'function';
	    }
	    Object.defineProperty(Cache.prototype, "size", {
	        get: function () {
	            return this.keys.length;
	        },
	        enumerable: true,
	        configurable: true
	    });
	    Object.defineProperty(Cache.prototype, "snapshot", {
	        get: function () {
	            return {
	                keys: cloneArray(this.keys),
	                size: this.size,
	                values: cloneArray(this.values),
	            };
	        },
	        enumerable: true,
	        configurable: true
	    });
	    /**
	     * @function _getKeyIndexFromMatchingKey
	     *
	     * @description
	     * gets the matching key index when a custom key matcher is used
	     *
	     * @param keyToMatch the key to match
	     * @returns the index of the matching key, or -1
	     */
	    Cache.prototype._getKeyIndexFromMatchingKey = function (keyToMatch) {
	        var _a = this.options, isMatchingKey = _a.isMatchingKey, maxSize = _a.maxSize;
	        var keys = this.keys;
	        var keysLength = keys.length;
	        if (!keysLength) {
	            return -1;
	        }
	        if (isMatchingKey(keys[0], keyToMatch)) {
	            return 0;
	        }
	        if (maxSize > 1) {
	            for (var index = 1; index < keysLength; index++) {
	                if (isMatchingKey(keys[index], keyToMatch)) {
	                    return index;
	                }
	            }
	        }
	        return -1;
	    };
	    /**
	     * @function _getKeyIndexForMany
	     *
	     * @description
	     * gets the matching key index when multiple keys are used
	     *
	     * @param keyToMatch the key to match
	     * @returns the index of the matching key, or -1
	     */
	    Cache.prototype._getKeyIndexForMany = function (keyToMatch) {
	        var isEqual = this.options.isEqual;
	        var keys = this.keys;
	        var keysLength = keys.length;
	        if (!keysLength) {
	            return -1;
	        }
	        if (keysLength === 1) {
	            return this._getKeyIndexForSingle(keyToMatch);
	        }
	        var keyLength = keyToMatch.length;
	        var existingKey;
	        var argIndex;
	        if (keyLength > 1) {
	            for (var index = 0; index < keysLength; index++) {
	                existingKey = keys[index];
	                if (existingKey.length === keyLength) {
	                    argIndex = 0;
	                    for (; argIndex < keyLength; argIndex++) {
	                        if (!isEqual(existingKey[argIndex], keyToMatch[argIndex])) {
	                            break;
	                        }
	                    }
	                    if (argIndex === keyLength) {
	                        return index;
	                    }
	                }
	            }
	        }
	        else {
	            for (var index = 0; index < keysLength; index++) {
	                existingKey = keys[index];
	                if (existingKey.length === keyLength &&
	                    isEqual(existingKey[0], keyToMatch[0])) {
	                    return index;
	                }
	            }
	        }
	        return -1;
	    };
	    /**
	     * @function _getKeyIndexForSingle
	     *
	     * @description
	     * gets the matching key index when a single key is used
	     *
	     * @param keyToMatch the key to match
	     * @returns the index of the matching key, or -1
	     */
	    Cache.prototype._getKeyIndexForSingle = function (keyToMatch) {
	        var keys = this.keys;
	        if (!keys.length) {
	            return -1;
	        }
	        var existingKey = keys[0];
	        var length = existingKey.length;
	        if (keyToMatch.length !== length) {
	            return -1;
	        }
	        var isEqual = this.options.isEqual;
	        if (length > 1) {
	            for (var index = 0; index < length; index++) {
	                if (!isEqual(existingKey[index], keyToMatch[index])) {
	                    return -1;
	                }
	            }
	            return 0;
	        }
	        return isEqual(existingKey[0], keyToMatch[0]) ? 0 : -1;
	    };
	    /**
	     * @function orderByLru
	     *
	     * @description
	     * order the array based on a Least-Recently-Used basis
	     *
	     * @param key the new key to move to the front
	     * @param value the new value to move to the front
	     * @param startingIndex the index of the item to move to the front
	     */
	    Cache.prototype.orderByLru = function (key, value, startingIndex) {
	        var keys = this.keys;
	        var values = this.values;
	        var currentLength = keys.length;
	        var index = startingIndex;
	        while (index--) {
	            keys[index + 1] = keys[index];
	            values[index + 1] = values[index];
	        }
	        keys[0] = key;
	        values[0] = value;
	        var maxSize = this.options.maxSize;
	        if (currentLength === maxSize && startingIndex === currentLength) {
	            keys.pop();
	            values.pop();
	        }
	        else if (startingIndex >= maxSize) {
	            // eslint-disable-next-line no-multi-assign
	            keys.length = values.length = maxSize;
	        }
	    };
	    /**
	     * @function updateAsyncCache
	     *
	     * @description
	     * update the promise method to auto-remove from cache if rejected, and
	     * if resolved then fire cache hit / changed
	     *
	     * @param memoized the memoized function
	     */
	    Cache.prototype.updateAsyncCache = function (memoized) {
	        var _this = this;
	        var _a = this.options, onCacheChange = _a.onCacheChange, onCacheHit = _a.onCacheHit;
	        var firstKey = this.keys[0];
	        var firstValue = this.values[0];
	        this.values[0] = firstValue.then(function (value) {
	            if (_this.shouldUpdateOnHit) {
	                onCacheHit(_this, _this.options, memoized);
	            }
	            if (_this.shouldUpdateOnChange) {
	                onCacheChange(_this, _this.options, memoized);
	            }
	            return value;
	        }, function (error) {
	            var keyIndex = _this.getKeyIndex(firstKey);
	            if (keyIndex !== -1) {
	                _this.keys.splice(keyIndex, 1);
	                _this.values.splice(keyIndex, 1);
	            }
	            throw error;
	        });
	    };
	    return Cache;
	}());

	// cache
	function createMemoizedFunction(fn, options) {
	    if (options === void 0) { options = {}; }
	    if (isMemoized(fn)) {
	        return createMemoizedFunction(fn.fn, mergeOptions(fn.options, options));
	    }
	    if (typeof fn !== 'function') {
	        throw new TypeError('You must pass a function to `memoize`.');
	    }
	    var _a = options.isEqual, isEqual = _a === void 0 ? isSameValueZero : _a, isMatchingKey = options.isMatchingKey, _b = options.isPromise, isPromise = _b === void 0 ? false : _b, _c = options.maxSize, maxSize = _c === void 0 ? 1 : _c, onCacheAdd = options.onCacheAdd, onCacheChange = options.onCacheChange, onCacheHit = options.onCacheHit, transformKey = options.transformKey;
	    var normalizedOptions = mergeOptions({
	        isEqual: isEqual,
	        isMatchingKey: isMatchingKey,
	        isPromise: isPromise,
	        maxSize: maxSize,
	        onCacheAdd: onCacheAdd,
	        onCacheChange: onCacheChange,
	        onCacheHit: onCacheHit,
	        transformKey: transformKey,
	    }, getCustomOptions(options));
	    var cache = new Cache(normalizedOptions);
	    var keys = cache.keys, values = cache.values, canTransformKey = cache.canTransformKey, shouldCloneArguments = cache.shouldCloneArguments, shouldUpdateOnAdd = cache.shouldUpdateOnAdd, shouldUpdateOnChange = cache.shouldUpdateOnChange, shouldUpdateOnHit = cache.shouldUpdateOnHit;
	    // @ts-ignore
	    var memoized = function memoized() {
	        // @ts-ignore
	        var key = shouldCloneArguments
	            ? cloneArray(arguments)
	            : arguments;
	        if (canTransformKey) {
	            key = transformKey(key);
	        }
	        var keyIndex = keys.length ? cache.getKeyIndex(key) : -1;
	        if (keyIndex !== -1) {
	            if (shouldUpdateOnHit) {
	                onCacheHit(cache, normalizedOptions, memoized);
	            }
	            if (keyIndex) {
	                cache.orderByLru(keys[keyIndex], values[keyIndex], keyIndex);
	                if (shouldUpdateOnChange) {
	                    onCacheChange(cache, normalizedOptions, memoized);
	                }
	            }
	        }
	        else {
	            var newValue = fn.apply(this, arguments);
	            var newKey = shouldCloneArguments
	                ? key
	                : cloneArray(arguments);
	            cache.orderByLru(newKey, newValue, keys.length);
	            if (isPromise) {
	                cache.updateAsyncCache(memoized);
	            }
	            if (shouldUpdateOnAdd) {
	                onCacheAdd(cache, normalizedOptions, memoized);
	            }
	            if (shouldUpdateOnChange) {
	                onCacheChange(cache, normalizedOptions, memoized);
	            }
	        }
	        return values[0];
	    };
	    memoized.cache = cache;
	    memoized.fn = fn;
	    memoized.isMemoized = true;
	    memoized.options = normalizedOptions;
	    return memoized;
	}

	var microMemoize_esm = /*#__PURE__*/Object.freeze({
		__proto__: null,
		'default': createMemoizedFunction
	});

	var require$$3 = /*@__PURE__*/getAugmentedNamespace(microMemoize_esm);

	var util = createCommonjsModule(function (module, exports) {
	var __importDefault = (commonjsGlobal && commonjsGlobal.__importDefault) || function (mod) {
	    return (mod && mod.__esModule) ? mod : { "default": mod };
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.proxy = exports.get = exports.merge = void 0;
	const isPlainObject_1$1 = __importDefault(isPlainObject_1);
	const merge_1$1 = __importDefault(merge_1);
	const get_1$1 = __importDefault(get_1);
	const micro_memoize_1 = __importDefault(require$$3);
	/**
	 * Use lodash merge for objects, return plain value otherwise
	 */
	const merge = (value, incomingValue) => {
	    if (incomingValue === undefined) {
	        return value;
	    }
	    if (isPlainObject_1$1.default(value)) {
	        if (isPlainObject_1$1.default(incomingValue)) {
	            return merge_1$1.default({}, value, incomingValue);
	        }
	        return value;
	    }
	    return incomingValue;
	};
	exports.merge = merge;
	exports.get = get_1$1.default;
	/**
	 * Creates a proxy for the default function exports in transpiled stylesheets
	 *
	 * This is so we can get hashed classes on the export
	 */
	const proxy = (func, context) => {
	    const memo = micro_memoize_1.default(func.bind(context));
	    return new Proxy(memo, {
	        get(target, p) {
	            let prop = p.toString();
	            if (prop === '$IS_PROXY') {
	                return true;
	            }
	            if (prop.startsWith('__')) {
	                prop = prop.slice(2);
	                if (prop in target) {
	                    return target[prop];
	                }
	            }
	            return context.hashClass(prop.toString());
	        }
	    });
	};
	exports.proxy = proxy;
	});

	var lib = createCommonjsModule(function (module, exports) {
	var __createBinding = (commonjsGlobal && commonjsGlobal.__createBinding) || (Object.create ? (function(o, m, k, k2) {
	    if (k2 === undefined) k2 = k;
	    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
	}) : (function(o, m, k, k2) {
	    if (k2 === undefined) k2 = k;
	    o[k2] = m[k];
	}));
	var __exportStar = (commonjsGlobal && commonjsGlobal.__exportStar) || function(m, exports) {
	    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Context = void 0;
	/**
	 * For tree-shaking, this should only export
	 * things needed for the client-side runtime
	 */
	__exportStar(tree, exports);

	Object.defineProperty(exports, "Context", { enumerable: true, get: function () { return context.Context; } });
	__exportStar(renderCss_1, exports);
	__exportStar(util, exports);
	});

	const $CONTEXT = new lib.Context({});
	$CONTEXT.id = '76d9c67f';
	function $DEFAULT ($VARS = {}, $RETURN_NODE) {
	  exports.value = lib.get($VARS, 'value', lib.anon("red"));
	  
	  return {
	    value: exports.value
	  }
	}
	const $DEFAULT_PROXY = lib.proxy($DEFAULT, $CONTEXT);
	$DEFAULT_PROXY(undefined, true);

	exports.default = $DEFAULT_PROXY;

	Object.defineProperty(exports, '__esModule', { value: true });

})));
