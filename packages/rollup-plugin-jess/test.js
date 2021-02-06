(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('os'), require('path'), require('module'), require('fs'), require('util')) :
	typeof define === 'function' && define.amd ? define(['exports', 'os', 'path', 'module', 'fs', 'util'], factory) :
	(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.jess = {}, global.os, global.require$$0$1, global.Module, global.fs, global.util$2));
}(this, (function (exports, os, require$$0$1, Module, fs, util$2) { 'use strict';

	function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

	var os__default = /*#__PURE__*/_interopDefaultLegacy(os);
	var require$$0__default = /*#__PURE__*/_interopDefaultLegacy(require$$0$1);
	var Module__default = /*#__PURE__*/_interopDefaultLegacy(Module);
	var fs__default = /*#__PURE__*/_interopDefaultLegacy(fs);
	var util__default = /*#__PURE__*/_interopDefaultLegacy(util$2);

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

	function commonjsRequire (target) {
		throw new Error('Could not dynamically require "' + target + '". Please configure the dynamicRequireTargets option of @rollup/plugin-commonjs appropriately for this require call to behave properly.');
	}

	const resolveFrom = (fromDir, moduleId, silent) => {
		if (typeof fromDir !== 'string') {
			throw new TypeError(`Expected \`fromDir\` to be of type \`string\`, got \`${typeof fromDir}\``);
		}

		if (typeof moduleId !== 'string') {
			throw new TypeError(`Expected \`moduleId\` to be of type \`string\`, got \`${typeof moduleId}\``);
		}

		try {
			fromDir = fs__default['default'].realpathSync(fromDir);
		} catch (err) {
			if (err.code === 'ENOENT') {
				fromDir = require$$0__default['default'].resolve(fromDir);
			} else if (silent) {
				return null;
			} else {
				throw err;
			}
		}

		const fromFile = require$$0__default['default'].join(fromDir, 'noop.js');

		const resolveFileName = () => Module__default['default']._resolveFilename(moduleId, {
			id: fromFile,
			filename: fromFile,
			paths: Module__default['default']._nodeModulePaths(fromDir)
		});

		if (silent) {
			try {
				return resolveFileName();
			} catch (err) {
				return null;
			}
		}

		return resolveFileName();
	};

	var resolveFrom_1 = (fromDir, moduleId) => resolveFrom(fromDir, moduleId);
	var silent = (fromDir, moduleId) => resolveFrom(fromDir, moduleId, true);
	resolveFrom_1.silent = silent;

	const callsites = () => {
		const _prepareStackTrace = Error.prepareStackTrace;
		Error.prepareStackTrace = (_, stack) => stack;
		const stack = new Error().stack.slice(1);
		Error.prepareStackTrace = _prepareStackTrace;
		return stack;
	};

	var callsites_1 = callsites;
	// TODO: Remove this for the next major release
	var _default = callsites;
	callsites_1.default = _default;

	var parentModule = filepath => {
		const stacks = callsites_1();

		if (!filepath) {
			return stacks[2].getFileName();
		}

		let seenVal = false;

		// Skip the first stack as it's this function
		stacks.shift();

		for (const stack of stacks) {
			const parentFilepath = stack.getFileName();

			if (typeof parentFilepath !== 'string') {
				continue;
			}

			if (parentFilepath === filepath) {
				seenVal = true;
				continue;
			}

			// Skip native modules
			if (parentFilepath === 'module.js') {
				continue;
			}

			if (seenVal && parentFilepath !== filepath) {
				return parentFilepath;
			}
		}
	};

	var importFresh = moduleId => {
		if (typeof moduleId !== 'string') {
			throw new TypeError('Expected a string');
		}

		const parentPath = parentModule(__filename);

		const cwd = parentPath ? require$$0__default['default'].dirname(parentPath) : __dirname;
		const filePath = resolveFrom_1(cwd, moduleId);

		const oldModule = require.cache[filePath];
		// Delete itself from module parent
		if (oldModule && oldModule.parent) {
			let i = oldModule.parent.children.length;

			while (i--) {
				if (oldModule.parent.children[i].id === filePath) {
					oldModule.parent.children.splice(i, 1);
				}
			}
		}

		delete require.cache[filePath]; // Delete module from cache

		const parent = require.cache[parentPath]; // If `filePath` and `parentPath` are the same, cache will already be deleted so we won't get a memory leak in next step

		return parent === undefined ? commonjsRequire(filePath) : parent.require(filePath); // In case cache doesn't have parent, fall back to normal require
	};

	var isArrayish = function isArrayish(obj) {
		if (!obj) {
			return false;
		}

		return obj instanceof Array || Array.isArray(obj) ||
			(obj.length >= 0 && obj.splice instanceof Function);
	};

	var errorEx = function errorEx(name, properties) {
		if (!name || name.constructor !== String) {
			properties = name || {};
			name = Error.name;
		}

		var errorExError = function ErrorEXError(message) {
			if (!this) {
				return new ErrorEXError(message);
			}

			message = message instanceof Error
				? message.message
				: (message || this.message);

			Error.call(this, message);
			Error.captureStackTrace(this, errorExError);

			this.name = name;

			Object.defineProperty(this, 'message', {
				configurable: true,
				enumerable: false,
				get: function () {
					var newMessage = message.split(/\r?\n/g);

					for (var key in properties) {
						if (!properties.hasOwnProperty(key)) {
							continue;
						}

						var modifier = properties[key];

						if ('message' in modifier) {
							newMessage = modifier.message(this[key], newMessage) || newMessage;
							if (!isArrayish(newMessage)) {
								newMessage = [newMessage];
							}
						}
					}

					return newMessage.join('\n');
				},
				set: function (v) {
					message = v;
				}
			});

			var overwrittenStack = null;

			var stackDescriptor = Object.getOwnPropertyDescriptor(this, 'stack');
			var stackGetter = stackDescriptor.get;
			var stackValue = stackDescriptor.value;
			delete stackDescriptor.value;
			delete stackDescriptor.writable;

			stackDescriptor.set = function (newstack) {
				overwrittenStack = newstack;
			};

			stackDescriptor.get = function () {
				var stack = (overwrittenStack || ((stackGetter)
					? stackGetter.call(this)
					: stackValue)).split(/\r?\n+/g);

				// starting in Node 7, the stack builder caches the message.
				// just replace it.
				if (!overwrittenStack) {
					stack[0] = this.name + ': ' + this.message;
				}

				var lineCount = 1;
				for (var key in properties) {
					if (!properties.hasOwnProperty(key)) {
						continue;
					}

					var modifier = properties[key];

					if ('line' in modifier) {
						var line = modifier.line(this[key]);
						if (line) {
							stack.splice(lineCount++, 0, '    ' + line);
						}
					}

					if ('stack' in modifier) {
						modifier.stack(this[key], stack);
					}
				}

				return stack.join('\n');
			};

			Object.defineProperty(this, 'stack', stackDescriptor);
		};

		if (Object.setPrototypeOf) {
			Object.setPrototypeOf(errorExError.prototype, Error.prototype);
			Object.setPrototypeOf(errorExError, Error);
		} else {
			util__default['default'].inherits(errorExError, Error);
		}

		return errorExError;
	};

	errorEx.append = function (str, def) {
		return {
			message: function (v, message) {
				v = v || def;

				if (v) {
					message[0] += ' ' + str.replace('%s', v.toString());
				}

				return message;
			}
		};
	};

	errorEx.line = function (str, def) {
		return {
			line: function (v) {
				v = v || def;

				if (v) {
					return str.replace('%s', v.toString());
				}

				return null;
			}
		};
	};

	var errorEx_1 = errorEx;

	const hexify = char => {
	  const h = char.charCodeAt(0).toString(16).toUpperCase();
	  return '0x' + (h.length % 2 ? '0' : '') + h
	};

	const parseError = (e, txt, context) => {
	  if (!txt) {
	    return {
	      message: e.message + ' while parsing empty string',
	      position: 0,
	    }
	  }
	  const badToken = e.message.match(/^Unexpected token (.) .*position\s+(\d+)/i);
	  const errIdx = badToken ? +badToken[2]
	    : e.message.match(/^Unexpected end of JSON.*/i) ? txt.length - 1
	    : null;

	  const msg = badToken ? e.message.replace(/^Unexpected token ./, `Unexpected token ${
      JSON.stringify(badToken[1])
    } (${hexify(badToken[1])})`)
	    : e.message;

	  if (errIdx !== null && errIdx !== undefined) {
	    const start = errIdx <= context ? 0
	      : errIdx - context;

	    const end = errIdx + context >= txt.length ? txt.length
	      : errIdx + context;

	    const slice = (start === 0 ? '' : '...') +
	      txt.slice(start, end) +
	      (end === txt.length ? '' : '...');

	    const near = txt === slice ? '' : 'near ';

	    return {
	      message: msg + ` while parsing ${near}${JSON.stringify(slice)}`,
	      position: errIdx,
	    }
	  } else {
	    return {
	      message: msg + ` while parsing '${txt.slice(0, context * 2)}'`,
	      position: 0,
	    }
	  }
	};

	class JSONParseError extends SyntaxError {
	  constructor (er, txt, context, caller) {
	    context = context || 20;
	    const metadata = parseError(er, txt, context);
	    super(metadata.message);
	    Object.assign(this, metadata);
	    this.code = 'EJSONPARSE';
	    this.systemError = er;
	    Error.captureStackTrace(this, caller || this.constructor);
	  }
	  get name () { return this.constructor.name }
	  set name (n) {}
	  get [Symbol.toStringTag] () { return this.constructor.name }
	}

	const kIndent = Symbol.for('indent');
	const kNewline = Symbol.for('newline');
	// only respect indentation if we got a line break, otherwise squash it
	// things other than objects and arrays aren't indented, so ignore those
	// Important: in both of these regexps, the $1 capture group is the newline
	// or undefined, and the $2 capture group is the indent, or undefined.
	const formatRE = /^\s*[{\[]((?:\r?\n)+)([\s\t]*)/;
	const emptyRE = /^(?:\{\}|\[\])((?:\r?\n)+)?$/;

	const parseJson = (txt, reviver, context) => {
	  const parseText = stripBOM(txt);
	  context = context || 20;
	  try {
	    // get the indentation so that we can save it back nicely
	    // if the file starts with {" then we have an indent of '', ie, none
	    // otherwise, pick the indentation of the next line after the first \n
	    // If the pattern doesn't match, then it means no indentation.
	    // JSON.stringify ignores symbols, so this is reasonably safe.
	    // if the string is '{}' or '[]', then use the default 2-space indent.
	    const [, newline = '\n', indent = '  '] = parseText.match(emptyRE) ||
	      parseText.match(formatRE) ||
	      [, '', ''];

	    const result = JSON.parse(parseText, reviver);
	    if (result && typeof result === 'object') {
	      result[kNewline] = newline;
	      result[kIndent] = indent;
	    }
	    return result
	  } catch (e) {
	    if (typeof txt !== 'string' && !Buffer.isBuffer(txt)) {
	      const isEmptyArray = Array.isArray(txt) && txt.length === 0;
	      throw Object.assign(new TypeError(
	        `Cannot parse ${isEmptyArray ? 'an empty array' : String(txt)}`
	      ), {
	        code: 'EJSONPARSE',
	        systemError: e,
	      })
	    }

	    throw new JSONParseError(e, parseText, context, parseJson)
	  }
	};

	// Remove byte order marker. This catches EF BB BF (the UTF-8 BOM)
	// because the buffer-to-string conversion in `fs.readFileSync()`
	// translates it to FEFF, the UTF-16 BOM.
	const stripBOM = txt => String(txt).replace(/^\uFEFF/, '');

	var jsonParseEvenBetterErrors = parseJson;
	parseJson.JSONParseError = JSONParseError;

	parseJson.noExceptions = (txt, reviver) => {
	  try {
	    return JSON.parse(stripBOM(txt), reviver)
	  } catch (e) {}
	};

	var LF = '\n';
	var CR = '\r';
	var LinesAndColumns = (function () {
	    function LinesAndColumns(string) {
	        this.string = string;
	        var offsets = [0];
	        for (var offset = 0; offset < string.length;) {
	            switch (string[offset]) {
	                case LF:
	                    offset += LF.length;
	                    offsets.push(offset);
	                    break;
	                case CR:
	                    offset += CR.length;
	                    if (string[offset] === LF) {
	                        offset += LF.length;
	                    }
	                    offsets.push(offset);
	                    break;
	                default:
	                    offset++;
	                    break;
	            }
	        }
	        this.offsets = offsets;
	    }
	    LinesAndColumns.prototype.locationForIndex = function (index) {
	        if (index < 0 || index > this.string.length) {
	            return null;
	        }
	        var line = 0;
	        var offsets = this.offsets;
	        while (offsets[line + 1] <= index) {
	            line++;
	        }
	        var column = index - offsets[line];
	        return { line: line, column: column };
	    };
	    LinesAndColumns.prototype.indexForLocation = function (location) {
	        var line = location.line, column = location.column;
	        if (line < 0 || line >= this.offsets.length) {
	            return null;
	        }
	        if (column < 0 || column > this.lengthOfLine(line)) {
	            return null;
	        }
	        return this.offsets[line] + column;
	    };
	    LinesAndColumns.prototype.lengthOfLine = function (line) {
	        var offset = this.offsets[line];
	        var nextOffset = line === this.offsets.length - 1 ? this.string.length : this.offsets[line + 1];
	        return nextOffset - offset;
	    };
	    return LinesAndColumns;
	}());

	var dist = /*#__PURE__*/Object.freeze({
		__proto__: null,
		'default': LinesAndColumns
	});

	// Copyright 2014, 2015, 2016, 2017, 2018 Simon Lydell
	// License: MIT. (See LICENSE.)



	// This regex comes from regex.coffee, and is inserted here by generate-index.js
	// (run `npm run build`).
	var _default$1 = /((['"])(?:(?!\2|\\).|\\(?:\r\n|[\s\S]))*(\2)?|`(?:[^`\\$]|\\[\s\S]|\$(?!\{)|\$\{(?:[^{}]|\{[^}]*\}?)*\}?)*(`)?)|(\/\/.*)|(\/\*(?:[^*]|\*(?!\/))*(\*\/)?)|(\/(?!\*)(?:\[(?:(?![\]\\]).|\\.)*\]|(?![\/\]\\]).|\\.)+\/(?:(?!\s*(?:\b|[\u0080-\uFFFF$\\'"~({]|[+\-!](?!=)|\.?\d))|[gmiyus]{1,6}\b(?![\u0080-\uFFFF$\\]|\s*(?:[+\-*%&|^<>!=?({]|\/(?![\/*])))))|(0[xX][\da-fA-F]+|0[oO][0-7]+|0[bB][01]+|(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?)|((?!\d)(?:(?!\s)[$\w\u0080-\uFFFF]|\\u[\da-fA-F]{4}|\\u\{[\da-fA-F]+\})+)|(--|\+\+|&&|\|\||=>|\.{3}|(?:[+\-\/%&|^]|\*{1,2}|<{1,2}|>{1,3}|!=?|={1,2})=?|[?~.,:;[\](){}])|(\s+)|(^$|[\s\S])/g;

	var matchToToken = function(match) {
	  var token = {type: "invalid", value: match[0], closed: undefined};
	       if (match[ 1]) token.type = "string" , token.closed = !!(match[3] || match[4]);
	  else if (match[ 5]) token.type = "comment";
	  else if (match[ 6]) token.type = "comment", token.closed = !!match[7];
	  else if (match[ 8]) token.type = "regex";
	  else if (match[ 9]) token.type = "number";
	  else if (match[10]) token.type = "name";
	  else if (match[11]) token.type = "punctuator";
	  else if (match[12]) token.type = "whitespace";
	  return token
	};

	var jsTokens = /*#__PURE__*/Object.defineProperty({
		default: _default$1,
		matchToToken: matchToToken
	}, '__esModule', {value: true});

	var isIdentifierStart_1 = isIdentifierStart;
	var isIdentifierChar_1 = isIdentifierChar;
	var isIdentifierName_1 = isIdentifierName;
	let nonASCIIidentifierStartChars = "\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u052f\u0531-\u0556\u0559\u0560-\u0588\u05d0-\u05ea\u05ef-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u0860-\u086a\u08a0-\u08b4\u08b6-\u08c7\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u09fc\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0af9\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3d\u0c58-\u0c5a\u0c60\u0c61\u0c80\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d04-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d54-\u0d56\u0d5f-\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e86-\u0e8a\u0e8c-\u0ea3\u0ea5\u0ea7-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f8\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1878\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191e\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1c80-\u1c88\u1c90-\u1cba\u1cbd-\u1cbf\u1ce9-\u1cec\u1cee-\u1cf3\u1cf5\u1cf6\u1cfa\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2118-\u211d\u2124\u2126\u2128\u212a-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309b-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312f\u3131-\u318e\u31a0-\u31bf\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9ffc\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua69d\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua7bf\ua7c2-\ua7ca\ua7f5-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua8fd\ua8fe\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\ua9e0-\ua9e4\ua9e6-\ua9ef\ua9fa-\ua9fe\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa7e-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab69\uab70-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc";
	let nonASCIIidentifierChars = "\u200c\u200d\xb7\u0300-\u036f\u0387\u0483-\u0487\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u0669\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u06f0-\u06f9\u0711\u0730-\u074a\u07a6-\u07b0\u07c0-\u07c9\u07eb-\u07f3\u07fd\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u08d3-\u08e1\u08e3-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962\u0963\u0966-\u096f\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09cb-\u09cd\u09d7\u09e2\u09e3\u09e6-\u09ef\u09fe\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a66-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2\u0ae3\u0ae6-\u0aef\u0afa-\u0aff\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b55-\u0b57\u0b62\u0b63\u0b66-\u0b6f\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0be6-\u0bef\u0c00-\u0c04\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0c66-\u0c6f\u0c81-\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0ce6-\u0cef\u0d00-\u0d03\u0d3b\u0d3c\u0d3e-\u0d44\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d62\u0d63\u0d66-\u0d6f\u0d81-\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0de6-\u0def\u0df2\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0e50-\u0e59\u0eb1\u0eb4-\u0ebc\u0ec8-\u0ecd\u0ed0-\u0ed9\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f3e\u0f3f\u0f71-\u0f84\u0f86\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1040-\u1049\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f-\u109d\u135d-\u135f\u1369-\u1371\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b4-\u17d3\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u18a9\u1920-\u192b\u1930-\u193b\u1946-\u194f\u19d0-\u19da\u1a17-\u1a1b\u1a55-\u1a5e\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1ab0-\u1abd\u1abf\u1ac0\u1b00-\u1b04\u1b34-\u1b44\u1b50-\u1b59\u1b6b-\u1b73\u1b80-\u1b82\u1ba1-\u1bad\u1bb0-\u1bb9\u1be6-\u1bf3\u1c24-\u1c37\u1c40-\u1c49\u1c50-\u1c59\u1cd0-\u1cd2\u1cd4-\u1ce8\u1ced\u1cf4\u1cf7-\u1cf9\u1dc0-\u1df9\u1dfb-\u1dff\u203f\u2040\u2054\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua620-\ua629\ua66f\ua674-\ua67d\ua69e\ua69f\ua6f0\ua6f1\ua802\ua806\ua80b\ua823-\ua827\ua82c\ua880\ua881\ua8b4-\ua8c5\ua8d0-\ua8d9\ua8e0-\ua8f1\ua8ff-\ua909\ua926-\ua92d\ua947-\ua953\ua980-\ua983\ua9b3-\ua9c0\ua9d0-\ua9d9\ua9e5\ua9f0-\ua9f9\uaa29-\uaa36\uaa43\uaa4c\uaa4d\uaa50-\uaa59\uaa7b-\uaa7d\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uaaeb-\uaaef\uaaf5\uaaf6\uabe3-\uabea\uabec\uabed\uabf0-\uabf9\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\ufe33\ufe34\ufe4d-\ufe4f\uff10-\uff19\uff3f";
	const nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
	const nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");
	nonASCIIidentifierStartChars = nonASCIIidentifierChars = null;
	const astralIdentifierStartCodes = [0, 11, 2, 25, 2, 18, 2, 1, 2, 14, 3, 13, 35, 122, 70, 52, 268, 28, 4, 48, 48, 31, 14, 29, 6, 37, 11, 29, 3, 35, 5, 7, 2, 4, 43, 157, 19, 35, 5, 35, 5, 39, 9, 51, 157, 310, 10, 21, 11, 7, 153, 5, 3, 0, 2, 43, 2, 1, 4, 0, 3, 22, 11, 22, 10, 30, 66, 18, 2, 1, 11, 21, 11, 25, 71, 55, 7, 1, 65, 0, 16, 3, 2, 2, 2, 28, 43, 28, 4, 28, 36, 7, 2, 27, 28, 53, 11, 21, 11, 18, 14, 17, 111, 72, 56, 50, 14, 50, 14, 35, 349, 41, 7, 1, 79, 28, 11, 0, 9, 21, 107, 20, 28, 22, 13, 52, 76, 44, 33, 24, 27, 35, 30, 0, 3, 0, 9, 34, 4, 0, 13, 47, 15, 3, 22, 0, 2, 0, 36, 17, 2, 24, 85, 6, 2, 0, 2, 3, 2, 14, 2, 9, 8, 46, 39, 7, 3, 1, 3, 21, 2, 6, 2, 1, 2, 4, 4, 0, 19, 0, 13, 4, 159, 52, 19, 3, 21, 2, 31, 47, 21, 1, 2, 0, 185, 46, 42, 3, 37, 47, 21, 0, 60, 42, 14, 0, 72, 26, 230, 43, 117, 63, 32, 7, 3, 0, 3, 7, 2, 1, 2, 23, 16, 0, 2, 0, 95, 7, 3, 38, 17, 0, 2, 0, 29, 0, 11, 39, 8, 0, 22, 0, 12, 45, 20, 0, 35, 56, 264, 8, 2, 36, 18, 0, 50, 29, 113, 6, 2, 1, 2, 37, 22, 0, 26, 5, 2, 1, 2, 31, 15, 0, 328, 18, 190, 0, 80, 921, 103, 110, 18, 195, 2749, 1070, 4050, 582, 8634, 568, 8, 30, 114, 29, 19, 47, 17, 3, 32, 20, 6, 18, 689, 63, 129, 74, 6, 0, 67, 12, 65, 1, 2, 0, 29, 6135, 9, 1237, 43, 8, 8952, 286, 50, 2, 18, 3, 9, 395, 2309, 106, 6, 12, 4, 8, 8, 9, 5991, 84, 2, 70, 2, 1, 3, 0, 3, 1, 3, 3, 2, 11, 2, 0, 2, 6, 2, 64, 2, 3, 3, 7, 2, 6, 2, 27, 2, 3, 2, 4, 2, 0, 4, 6, 2, 339, 3, 24, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 7, 2357, 44, 11, 6, 17, 0, 370, 43, 1301, 196, 60, 67, 8, 0, 1205, 3, 2, 26, 2, 1, 2, 0, 3, 0, 2, 9, 2, 3, 2, 0, 2, 0, 7, 0, 5, 0, 2, 0, 2, 0, 2, 2, 2, 1, 2, 0, 3, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1, 2, 0, 3, 3, 2, 6, 2, 3, 2, 3, 2, 0, 2, 9, 2, 16, 6, 2, 2, 4, 2, 16, 4421, 42717, 35, 4148, 12, 221, 3, 5761, 15, 7472, 3104, 541, 1507, 4938];
	const astralIdentifierCodes = [509, 0, 227, 0, 150, 4, 294, 9, 1368, 2, 2, 1, 6, 3, 41, 2, 5, 0, 166, 1, 574, 3, 9, 9, 370, 1, 154, 10, 176, 2, 54, 14, 32, 9, 16, 3, 46, 10, 54, 9, 7, 2, 37, 13, 2, 9, 6, 1, 45, 0, 13, 2, 49, 13, 9, 3, 2, 11, 83, 11, 7, 0, 161, 11, 6, 9, 7, 3, 56, 1, 2, 6, 3, 1, 3, 2, 10, 0, 11, 1, 3, 6, 4, 4, 193, 17, 10, 9, 5, 0, 82, 19, 13, 9, 214, 6, 3, 8, 28, 1, 83, 16, 16, 9, 82, 12, 9, 9, 84, 14, 5, 9, 243, 14, 166, 9, 71, 5, 2, 1, 3, 3, 2, 0, 2, 1, 13, 9, 120, 6, 3, 6, 4, 0, 29, 9, 41, 6, 2, 3, 9, 0, 10, 10, 47, 15, 406, 7, 2, 7, 17, 9, 57, 21, 2, 13, 123, 5, 4, 0, 2, 1, 2, 6, 2, 0, 9, 9, 49, 4, 2, 1, 2, 4, 9, 9, 330, 3, 19306, 9, 135, 4, 60, 6, 26, 9, 1014, 0, 2, 54, 8, 3, 82, 0, 12, 1, 19628, 1, 5319, 4, 4, 5, 9, 7, 3, 6, 31, 3, 149, 2, 1418, 49, 513, 54, 5, 49, 9, 0, 15, 0, 23, 4, 2, 14, 1361, 6, 2, 16, 3, 6, 2, 1, 2, 4, 262, 6, 10, 9, 419, 13, 1495, 6, 110, 6, 6, 9, 4759, 9, 787719, 239];

	function isInAstralSet(code, set) {
	  let pos = 0x10000;

	  for (let i = 0, length = set.length; i < length; i += 2) {
	    pos += set[i];
	    if (pos > code) return false;
	    pos += set[i + 1];
	    if (pos >= code) return true;
	  }

	  return false;
	}

	function isIdentifierStart(code) {
	  if (code < 65) return code === 36;
	  if (code <= 90) return true;
	  if (code < 97) return code === 95;
	  if (code <= 122) return true;

	  if (code <= 0xffff) {
	    return code >= 0xaa && nonASCIIidentifierStart.test(String.fromCharCode(code));
	  }

	  return isInAstralSet(code, astralIdentifierStartCodes);
	}

	function isIdentifierChar(code) {
	  if (code < 48) return code === 36;
	  if (code < 58) return true;
	  if (code < 65) return false;
	  if (code <= 90) return true;
	  if (code < 97) return code === 95;
	  if (code <= 122) return true;

	  if (code <= 0xffff) {
	    return code >= 0xaa && nonASCIIidentifier.test(String.fromCharCode(code));
	  }

	  return isInAstralSet(code, astralIdentifierStartCodes) || isInAstralSet(code, astralIdentifierCodes);
	}

	function isIdentifierName(name) {
	  let isFirst = true;

	  for (let _i = 0, _Array$from = Array.from(name); _i < _Array$from.length; _i++) {
	    const char = _Array$from[_i];
	    const cp = char.codePointAt(0);

	    if (isFirst) {
	      if (!isIdentifierStart(cp)) {
	        return false;
	      }

	      isFirst = false;
	    } else if (!isIdentifierChar(cp)) {
	      return false;
	    }
	  }

	  return !isFirst;
	}

	var identifier = /*#__PURE__*/Object.defineProperty({
		isIdentifierStart: isIdentifierStart_1,
		isIdentifierChar: isIdentifierChar_1,
		isIdentifierName: isIdentifierName_1
	}, '__esModule', {value: true});

	var isReservedWord_1 = isReservedWord;
	var isStrictReservedWord_1 = isStrictReservedWord;
	var isStrictBindOnlyReservedWord_1 = isStrictBindOnlyReservedWord;
	var isStrictBindReservedWord_1 = isStrictBindReservedWord;
	var isKeyword_1 = isKeyword;
	const reservedWords = {
	  keyword: ["break", "case", "catch", "continue", "debugger", "default", "do", "else", "finally", "for", "function", "if", "return", "switch", "throw", "try", "var", "const", "while", "with", "new", "this", "super", "class", "extends", "export", "import", "null", "true", "false", "in", "instanceof", "typeof", "void", "delete"],
	  strict: ["implements", "interface", "let", "package", "private", "protected", "public", "static", "yield"],
	  strictBind: ["eval", "arguments"]
	};
	const keywords = new Set(reservedWords.keyword);
	const reservedWordsStrictSet = new Set(reservedWords.strict);
	const reservedWordsStrictBindSet = new Set(reservedWords.strictBind);

	function isReservedWord(word, inModule) {
	  return inModule && word === "await" || word === "enum";
	}

	function isStrictReservedWord(word, inModule) {
	  return isReservedWord(word, inModule) || reservedWordsStrictSet.has(word);
	}

	function isStrictBindOnlyReservedWord(word) {
	  return reservedWordsStrictBindSet.has(word);
	}

	function isStrictBindReservedWord(word, inModule) {
	  return isStrictReservedWord(word, inModule) || isStrictBindOnlyReservedWord(word);
	}

	function isKeyword(word) {
	  return keywords.has(word);
	}

	var keyword = /*#__PURE__*/Object.defineProperty({
		isReservedWord: isReservedWord_1,
		isStrictReservedWord: isStrictReservedWord_1,
		isStrictBindOnlyReservedWord: isStrictBindOnlyReservedWord_1,
		isStrictBindReservedWord: isStrictBindReservedWord_1,
		isKeyword: isKeyword_1
	}, '__esModule', {value: true});

	var lib = createCommonjsModule(function (module, exports) {

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	Object.defineProperty(exports, "isIdentifierName", {
	  enumerable: true,
	  get: function () {
	    return identifier.isIdentifierName;
	  }
	});
	Object.defineProperty(exports, "isIdentifierChar", {
	  enumerable: true,
	  get: function () {
	    return identifier.isIdentifierChar;
	  }
	});
	Object.defineProperty(exports, "isIdentifierStart", {
	  enumerable: true,
	  get: function () {
	    return identifier.isIdentifierStart;
	  }
	});
	Object.defineProperty(exports, "isReservedWord", {
	  enumerable: true,
	  get: function () {
	    return keyword.isReservedWord;
	  }
	});
	Object.defineProperty(exports, "isStrictBindOnlyReservedWord", {
	  enumerable: true,
	  get: function () {
	    return keyword.isStrictBindOnlyReservedWord;
	  }
	});
	Object.defineProperty(exports, "isStrictBindReservedWord", {
	  enumerable: true,
	  get: function () {
	    return keyword.isStrictBindReservedWord;
	  }
	});
	Object.defineProperty(exports, "isStrictReservedWord", {
	  enumerable: true,
	  get: function () {
	    return keyword.isStrictReservedWord;
	  }
	});
	Object.defineProperty(exports, "isKeyword", {
	  enumerable: true,
	  get: function () {
	    return keyword.isKeyword;
	  }
	});
	});

	var matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;

	var escapeStringRegexp = function (str) {
		if (typeof str !== 'string') {
			throw new TypeError('Expected a string');
		}

		return str.replace(matchOperatorsRe, '\\$&');
	};

	var colorName = {
		"aliceblue": [240, 248, 255],
		"antiquewhite": [250, 235, 215],
		"aqua": [0, 255, 255],
		"aquamarine": [127, 255, 212],
		"azure": [240, 255, 255],
		"beige": [245, 245, 220],
		"bisque": [255, 228, 196],
		"black": [0, 0, 0],
		"blanchedalmond": [255, 235, 205],
		"blue": [0, 0, 255],
		"blueviolet": [138, 43, 226],
		"brown": [165, 42, 42],
		"burlywood": [222, 184, 135],
		"cadetblue": [95, 158, 160],
		"chartreuse": [127, 255, 0],
		"chocolate": [210, 105, 30],
		"coral": [255, 127, 80],
		"cornflowerblue": [100, 149, 237],
		"cornsilk": [255, 248, 220],
		"crimson": [220, 20, 60],
		"cyan": [0, 255, 255],
		"darkblue": [0, 0, 139],
		"darkcyan": [0, 139, 139],
		"darkgoldenrod": [184, 134, 11],
		"darkgray": [169, 169, 169],
		"darkgreen": [0, 100, 0],
		"darkgrey": [169, 169, 169],
		"darkkhaki": [189, 183, 107],
		"darkmagenta": [139, 0, 139],
		"darkolivegreen": [85, 107, 47],
		"darkorange": [255, 140, 0],
		"darkorchid": [153, 50, 204],
		"darkred": [139, 0, 0],
		"darksalmon": [233, 150, 122],
		"darkseagreen": [143, 188, 143],
		"darkslateblue": [72, 61, 139],
		"darkslategray": [47, 79, 79],
		"darkslategrey": [47, 79, 79],
		"darkturquoise": [0, 206, 209],
		"darkviolet": [148, 0, 211],
		"deeppink": [255, 20, 147],
		"deepskyblue": [0, 191, 255],
		"dimgray": [105, 105, 105],
		"dimgrey": [105, 105, 105],
		"dodgerblue": [30, 144, 255],
		"firebrick": [178, 34, 34],
		"floralwhite": [255, 250, 240],
		"forestgreen": [34, 139, 34],
		"fuchsia": [255, 0, 255],
		"gainsboro": [220, 220, 220],
		"ghostwhite": [248, 248, 255],
		"gold": [255, 215, 0],
		"goldenrod": [218, 165, 32],
		"gray": [128, 128, 128],
		"green": [0, 128, 0],
		"greenyellow": [173, 255, 47],
		"grey": [128, 128, 128],
		"honeydew": [240, 255, 240],
		"hotpink": [255, 105, 180],
		"indianred": [205, 92, 92],
		"indigo": [75, 0, 130],
		"ivory": [255, 255, 240],
		"khaki": [240, 230, 140],
		"lavender": [230, 230, 250],
		"lavenderblush": [255, 240, 245],
		"lawngreen": [124, 252, 0],
		"lemonchiffon": [255, 250, 205],
		"lightblue": [173, 216, 230],
		"lightcoral": [240, 128, 128],
		"lightcyan": [224, 255, 255],
		"lightgoldenrodyellow": [250, 250, 210],
		"lightgray": [211, 211, 211],
		"lightgreen": [144, 238, 144],
		"lightgrey": [211, 211, 211],
		"lightpink": [255, 182, 193],
		"lightsalmon": [255, 160, 122],
		"lightseagreen": [32, 178, 170],
		"lightskyblue": [135, 206, 250],
		"lightslategray": [119, 136, 153],
		"lightslategrey": [119, 136, 153],
		"lightsteelblue": [176, 196, 222],
		"lightyellow": [255, 255, 224],
		"lime": [0, 255, 0],
		"limegreen": [50, 205, 50],
		"linen": [250, 240, 230],
		"magenta": [255, 0, 255],
		"maroon": [128, 0, 0],
		"mediumaquamarine": [102, 205, 170],
		"mediumblue": [0, 0, 205],
		"mediumorchid": [186, 85, 211],
		"mediumpurple": [147, 112, 219],
		"mediumseagreen": [60, 179, 113],
		"mediumslateblue": [123, 104, 238],
		"mediumspringgreen": [0, 250, 154],
		"mediumturquoise": [72, 209, 204],
		"mediumvioletred": [199, 21, 133],
		"midnightblue": [25, 25, 112],
		"mintcream": [245, 255, 250],
		"mistyrose": [255, 228, 225],
		"moccasin": [255, 228, 181],
		"navajowhite": [255, 222, 173],
		"navy": [0, 0, 128],
		"oldlace": [253, 245, 230],
		"olive": [128, 128, 0],
		"olivedrab": [107, 142, 35],
		"orange": [255, 165, 0],
		"orangered": [255, 69, 0],
		"orchid": [218, 112, 214],
		"palegoldenrod": [238, 232, 170],
		"palegreen": [152, 251, 152],
		"paleturquoise": [175, 238, 238],
		"palevioletred": [219, 112, 147],
		"papayawhip": [255, 239, 213],
		"peachpuff": [255, 218, 185],
		"peru": [205, 133, 63],
		"pink": [255, 192, 203],
		"plum": [221, 160, 221],
		"powderblue": [176, 224, 230],
		"purple": [128, 0, 128],
		"rebeccapurple": [102, 51, 153],
		"red": [255, 0, 0],
		"rosybrown": [188, 143, 143],
		"royalblue": [65, 105, 225],
		"saddlebrown": [139, 69, 19],
		"salmon": [250, 128, 114],
		"sandybrown": [244, 164, 96],
		"seagreen": [46, 139, 87],
		"seashell": [255, 245, 238],
		"sienna": [160, 82, 45],
		"silver": [192, 192, 192],
		"skyblue": [135, 206, 235],
		"slateblue": [106, 90, 205],
		"slategray": [112, 128, 144],
		"slategrey": [112, 128, 144],
		"snow": [255, 250, 250],
		"springgreen": [0, 255, 127],
		"steelblue": [70, 130, 180],
		"tan": [210, 180, 140],
		"teal": [0, 128, 128],
		"thistle": [216, 191, 216],
		"tomato": [255, 99, 71],
		"turquoise": [64, 224, 208],
		"violet": [238, 130, 238],
		"wheat": [245, 222, 179],
		"white": [255, 255, 255],
		"whitesmoke": [245, 245, 245],
		"yellow": [255, 255, 0],
		"yellowgreen": [154, 205, 50]
	};

	/* MIT license */

	var conversions = createCommonjsModule(function (module) {
	// NOTE: conversions should only return primitive values (i.e. arrays, or
	//       values that give correct `typeof` results).
	//       do not use box values types (i.e. Number(), String(), etc.)

	var reverseKeywords = {};
	for (var key in colorName) {
		if (colorName.hasOwnProperty(key)) {
			reverseKeywords[colorName[key]] = key;
		}
	}

	var convert = module.exports = {
		rgb: {channels: 3, labels: 'rgb'},
		hsl: {channels: 3, labels: 'hsl'},
		hsv: {channels: 3, labels: 'hsv'},
		hwb: {channels: 3, labels: 'hwb'},
		cmyk: {channels: 4, labels: 'cmyk'},
		xyz: {channels: 3, labels: 'xyz'},
		lab: {channels: 3, labels: 'lab'},
		lch: {channels: 3, labels: 'lch'},
		hex: {channels: 1, labels: ['hex']},
		keyword: {channels: 1, labels: ['keyword']},
		ansi16: {channels: 1, labels: ['ansi16']},
		ansi256: {channels: 1, labels: ['ansi256']},
		hcg: {channels: 3, labels: ['h', 'c', 'g']},
		apple: {channels: 3, labels: ['r16', 'g16', 'b16']},
		gray: {channels: 1, labels: ['gray']}
	};

	// hide .channels and .labels properties
	for (var model in convert) {
		if (convert.hasOwnProperty(model)) {
			if (!('channels' in convert[model])) {
				throw new Error('missing channels property: ' + model);
			}

			if (!('labels' in convert[model])) {
				throw new Error('missing channel labels property: ' + model);
			}

			if (convert[model].labels.length !== convert[model].channels) {
				throw new Error('channel and label counts mismatch: ' + model);
			}

			var channels = convert[model].channels;
			var labels = convert[model].labels;
			delete convert[model].channels;
			delete convert[model].labels;
			Object.defineProperty(convert[model], 'channels', {value: channels});
			Object.defineProperty(convert[model], 'labels', {value: labels});
		}
	}

	convert.rgb.hsl = function (rgb) {
		var r = rgb[0] / 255;
		var g = rgb[1] / 255;
		var b = rgb[2] / 255;
		var min = Math.min(r, g, b);
		var max = Math.max(r, g, b);
		var delta = max - min;
		var h;
		var s;
		var l;

		if (max === min) {
			h = 0;
		} else if (r === max) {
			h = (g - b) / delta;
		} else if (g === max) {
			h = 2 + (b - r) / delta;
		} else if (b === max) {
			h = 4 + (r - g) / delta;
		}

		h = Math.min(h * 60, 360);

		if (h < 0) {
			h += 360;
		}

		l = (min + max) / 2;

		if (max === min) {
			s = 0;
		} else if (l <= 0.5) {
			s = delta / (max + min);
		} else {
			s = delta / (2 - max - min);
		}

		return [h, s * 100, l * 100];
	};

	convert.rgb.hsv = function (rgb) {
		var rdif;
		var gdif;
		var bdif;
		var h;
		var s;

		var r = rgb[0] / 255;
		var g = rgb[1] / 255;
		var b = rgb[2] / 255;
		var v = Math.max(r, g, b);
		var diff = v - Math.min(r, g, b);
		var diffc = function (c) {
			return (v - c) / 6 / diff + 1 / 2;
		};

		if (diff === 0) {
			h = s = 0;
		} else {
			s = diff / v;
			rdif = diffc(r);
			gdif = diffc(g);
			bdif = diffc(b);

			if (r === v) {
				h = bdif - gdif;
			} else if (g === v) {
				h = (1 / 3) + rdif - bdif;
			} else if (b === v) {
				h = (2 / 3) + gdif - rdif;
			}
			if (h < 0) {
				h += 1;
			} else if (h > 1) {
				h -= 1;
			}
		}

		return [
			h * 360,
			s * 100,
			v * 100
		];
	};

	convert.rgb.hwb = function (rgb) {
		var r = rgb[0];
		var g = rgb[1];
		var b = rgb[2];
		var h = convert.rgb.hsl(rgb)[0];
		var w = 1 / 255 * Math.min(r, Math.min(g, b));

		b = 1 - 1 / 255 * Math.max(r, Math.max(g, b));

		return [h, w * 100, b * 100];
	};

	convert.rgb.cmyk = function (rgb) {
		var r = rgb[0] / 255;
		var g = rgb[1] / 255;
		var b = rgb[2] / 255;
		var c;
		var m;
		var y;
		var k;

		k = Math.min(1 - r, 1 - g, 1 - b);
		c = (1 - r - k) / (1 - k) || 0;
		m = (1 - g - k) / (1 - k) || 0;
		y = (1 - b - k) / (1 - k) || 0;

		return [c * 100, m * 100, y * 100, k * 100];
	};

	/**
	 * See https://en.m.wikipedia.org/wiki/Euclidean_distance#Squared_Euclidean_distance
	 * */
	function comparativeDistance(x, y) {
		return (
			Math.pow(x[0] - y[0], 2) +
			Math.pow(x[1] - y[1], 2) +
			Math.pow(x[2] - y[2], 2)
		);
	}

	convert.rgb.keyword = function (rgb) {
		var reversed = reverseKeywords[rgb];
		if (reversed) {
			return reversed;
		}

		var currentClosestDistance = Infinity;
		var currentClosestKeyword;

		for (var keyword in colorName) {
			if (colorName.hasOwnProperty(keyword)) {
				var value = colorName[keyword];

				// Compute comparative distance
				var distance = comparativeDistance(rgb, value);

				// Check if its less, if so set as closest
				if (distance < currentClosestDistance) {
					currentClosestDistance = distance;
					currentClosestKeyword = keyword;
				}
			}
		}

		return currentClosestKeyword;
	};

	convert.keyword.rgb = function (keyword) {
		return colorName[keyword];
	};

	convert.rgb.xyz = function (rgb) {
		var r = rgb[0] / 255;
		var g = rgb[1] / 255;
		var b = rgb[2] / 255;

		// assume sRGB
		r = r > 0.04045 ? Math.pow(((r + 0.055) / 1.055), 2.4) : (r / 12.92);
		g = g > 0.04045 ? Math.pow(((g + 0.055) / 1.055), 2.4) : (g / 12.92);
		b = b > 0.04045 ? Math.pow(((b + 0.055) / 1.055), 2.4) : (b / 12.92);

		var x = (r * 0.4124) + (g * 0.3576) + (b * 0.1805);
		var y = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
		var z = (r * 0.0193) + (g * 0.1192) + (b * 0.9505);

		return [x * 100, y * 100, z * 100];
	};

	convert.rgb.lab = function (rgb) {
		var xyz = convert.rgb.xyz(rgb);
		var x = xyz[0];
		var y = xyz[1];
		var z = xyz[2];
		var l;
		var a;
		var b;

		x /= 95.047;
		y /= 100;
		z /= 108.883;

		x = x > 0.008856 ? Math.pow(x, 1 / 3) : (7.787 * x) + (16 / 116);
		y = y > 0.008856 ? Math.pow(y, 1 / 3) : (7.787 * y) + (16 / 116);
		z = z > 0.008856 ? Math.pow(z, 1 / 3) : (7.787 * z) + (16 / 116);

		l = (116 * y) - 16;
		a = 500 * (x - y);
		b = 200 * (y - z);

		return [l, a, b];
	};

	convert.hsl.rgb = function (hsl) {
		var h = hsl[0] / 360;
		var s = hsl[1] / 100;
		var l = hsl[2] / 100;
		var t1;
		var t2;
		var t3;
		var rgb;
		var val;

		if (s === 0) {
			val = l * 255;
			return [val, val, val];
		}

		if (l < 0.5) {
			t2 = l * (1 + s);
		} else {
			t2 = l + s - l * s;
		}

		t1 = 2 * l - t2;

		rgb = [0, 0, 0];
		for (var i = 0; i < 3; i++) {
			t3 = h + 1 / 3 * -(i - 1);
			if (t3 < 0) {
				t3++;
			}
			if (t3 > 1) {
				t3--;
			}

			if (6 * t3 < 1) {
				val = t1 + (t2 - t1) * 6 * t3;
			} else if (2 * t3 < 1) {
				val = t2;
			} else if (3 * t3 < 2) {
				val = t1 + (t2 - t1) * (2 / 3 - t3) * 6;
			} else {
				val = t1;
			}

			rgb[i] = val * 255;
		}

		return rgb;
	};

	convert.hsl.hsv = function (hsl) {
		var h = hsl[0];
		var s = hsl[1] / 100;
		var l = hsl[2] / 100;
		var smin = s;
		var lmin = Math.max(l, 0.01);
		var sv;
		var v;

		l *= 2;
		s *= (l <= 1) ? l : 2 - l;
		smin *= lmin <= 1 ? lmin : 2 - lmin;
		v = (l + s) / 2;
		sv = l === 0 ? (2 * smin) / (lmin + smin) : (2 * s) / (l + s);

		return [h, sv * 100, v * 100];
	};

	convert.hsv.rgb = function (hsv) {
		var h = hsv[0] / 60;
		var s = hsv[1] / 100;
		var v = hsv[2] / 100;
		var hi = Math.floor(h) % 6;

		var f = h - Math.floor(h);
		var p = 255 * v * (1 - s);
		var q = 255 * v * (1 - (s * f));
		var t = 255 * v * (1 - (s * (1 - f)));
		v *= 255;

		switch (hi) {
			case 0:
				return [v, t, p];
			case 1:
				return [q, v, p];
			case 2:
				return [p, v, t];
			case 3:
				return [p, q, v];
			case 4:
				return [t, p, v];
			case 5:
				return [v, p, q];
		}
	};

	convert.hsv.hsl = function (hsv) {
		var h = hsv[0];
		var s = hsv[1] / 100;
		var v = hsv[2] / 100;
		var vmin = Math.max(v, 0.01);
		var lmin;
		var sl;
		var l;

		l = (2 - s) * v;
		lmin = (2 - s) * vmin;
		sl = s * vmin;
		sl /= (lmin <= 1) ? lmin : 2 - lmin;
		sl = sl || 0;
		l /= 2;

		return [h, sl * 100, l * 100];
	};

	// http://dev.w3.org/csswg/css-color/#hwb-to-rgb
	convert.hwb.rgb = function (hwb) {
		var h = hwb[0] / 360;
		var wh = hwb[1] / 100;
		var bl = hwb[2] / 100;
		var ratio = wh + bl;
		var i;
		var v;
		var f;
		var n;

		// wh + bl cant be > 1
		if (ratio > 1) {
			wh /= ratio;
			bl /= ratio;
		}

		i = Math.floor(6 * h);
		v = 1 - bl;
		f = 6 * h - i;

		if ((i & 0x01) !== 0) {
			f = 1 - f;
		}

		n = wh + f * (v - wh); // linear interpolation

		var r;
		var g;
		var b;
		switch (i) {
			default:
			case 6:
			case 0: r = v; g = n; b = wh; break;
			case 1: r = n; g = v; b = wh; break;
			case 2: r = wh; g = v; b = n; break;
			case 3: r = wh; g = n; b = v; break;
			case 4: r = n; g = wh; b = v; break;
			case 5: r = v; g = wh; b = n; break;
		}

		return [r * 255, g * 255, b * 255];
	};

	convert.cmyk.rgb = function (cmyk) {
		var c = cmyk[0] / 100;
		var m = cmyk[1] / 100;
		var y = cmyk[2] / 100;
		var k = cmyk[3] / 100;
		var r;
		var g;
		var b;

		r = 1 - Math.min(1, c * (1 - k) + k);
		g = 1 - Math.min(1, m * (1 - k) + k);
		b = 1 - Math.min(1, y * (1 - k) + k);

		return [r * 255, g * 255, b * 255];
	};

	convert.xyz.rgb = function (xyz) {
		var x = xyz[0] / 100;
		var y = xyz[1] / 100;
		var z = xyz[2] / 100;
		var r;
		var g;
		var b;

		r = (x * 3.2406) + (y * -1.5372) + (z * -0.4986);
		g = (x * -0.9689) + (y * 1.8758) + (z * 0.0415);
		b = (x * 0.0557) + (y * -0.2040) + (z * 1.0570);

		// assume sRGB
		r = r > 0.0031308
			? ((1.055 * Math.pow(r, 1.0 / 2.4)) - 0.055)
			: r * 12.92;

		g = g > 0.0031308
			? ((1.055 * Math.pow(g, 1.0 / 2.4)) - 0.055)
			: g * 12.92;

		b = b > 0.0031308
			? ((1.055 * Math.pow(b, 1.0 / 2.4)) - 0.055)
			: b * 12.92;

		r = Math.min(Math.max(0, r), 1);
		g = Math.min(Math.max(0, g), 1);
		b = Math.min(Math.max(0, b), 1);

		return [r * 255, g * 255, b * 255];
	};

	convert.xyz.lab = function (xyz) {
		var x = xyz[0];
		var y = xyz[1];
		var z = xyz[2];
		var l;
		var a;
		var b;

		x /= 95.047;
		y /= 100;
		z /= 108.883;

		x = x > 0.008856 ? Math.pow(x, 1 / 3) : (7.787 * x) + (16 / 116);
		y = y > 0.008856 ? Math.pow(y, 1 / 3) : (7.787 * y) + (16 / 116);
		z = z > 0.008856 ? Math.pow(z, 1 / 3) : (7.787 * z) + (16 / 116);

		l = (116 * y) - 16;
		a = 500 * (x - y);
		b = 200 * (y - z);

		return [l, a, b];
	};

	convert.lab.xyz = function (lab) {
		var l = lab[0];
		var a = lab[1];
		var b = lab[2];
		var x;
		var y;
		var z;

		y = (l + 16) / 116;
		x = a / 500 + y;
		z = y - b / 200;

		var y2 = Math.pow(y, 3);
		var x2 = Math.pow(x, 3);
		var z2 = Math.pow(z, 3);
		y = y2 > 0.008856 ? y2 : (y - 16 / 116) / 7.787;
		x = x2 > 0.008856 ? x2 : (x - 16 / 116) / 7.787;
		z = z2 > 0.008856 ? z2 : (z - 16 / 116) / 7.787;

		x *= 95.047;
		y *= 100;
		z *= 108.883;

		return [x, y, z];
	};

	convert.lab.lch = function (lab) {
		var l = lab[0];
		var a = lab[1];
		var b = lab[2];
		var hr;
		var h;
		var c;

		hr = Math.atan2(b, a);
		h = hr * 360 / 2 / Math.PI;

		if (h < 0) {
			h += 360;
		}

		c = Math.sqrt(a * a + b * b);

		return [l, c, h];
	};

	convert.lch.lab = function (lch) {
		var l = lch[0];
		var c = lch[1];
		var h = lch[2];
		var a;
		var b;
		var hr;

		hr = h / 360 * 2 * Math.PI;
		a = c * Math.cos(hr);
		b = c * Math.sin(hr);

		return [l, a, b];
	};

	convert.rgb.ansi16 = function (args) {
		var r = args[0];
		var g = args[1];
		var b = args[2];
		var value = 1 in arguments ? arguments[1] : convert.rgb.hsv(args)[2]; // hsv -> ansi16 optimization

		value = Math.round(value / 50);

		if (value === 0) {
			return 30;
		}

		var ansi = 30
			+ ((Math.round(b / 255) << 2)
			| (Math.round(g / 255) << 1)
			| Math.round(r / 255));

		if (value === 2) {
			ansi += 60;
		}

		return ansi;
	};

	convert.hsv.ansi16 = function (args) {
		// optimization here; we already know the value and don't need to get
		// it converted for us.
		return convert.rgb.ansi16(convert.hsv.rgb(args), args[2]);
	};

	convert.rgb.ansi256 = function (args) {
		var r = args[0];
		var g = args[1];
		var b = args[2];

		// we use the extended greyscale palette here, with the exception of
		// black and white. normal palette only has 4 greyscale shades.
		if (r === g && g === b) {
			if (r < 8) {
				return 16;
			}

			if (r > 248) {
				return 231;
			}

			return Math.round(((r - 8) / 247) * 24) + 232;
		}

		var ansi = 16
			+ (36 * Math.round(r / 255 * 5))
			+ (6 * Math.round(g / 255 * 5))
			+ Math.round(b / 255 * 5);

		return ansi;
	};

	convert.ansi16.rgb = function (args) {
		var color = args % 10;

		// handle greyscale
		if (color === 0 || color === 7) {
			if (args > 50) {
				color += 3.5;
			}

			color = color / 10.5 * 255;

			return [color, color, color];
		}

		var mult = (~~(args > 50) + 1) * 0.5;
		var r = ((color & 1) * mult) * 255;
		var g = (((color >> 1) & 1) * mult) * 255;
		var b = (((color >> 2) & 1) * mult) * 255;

		return [r, g, b];
	};

	convert.ansi256.rgb = function (args) {
		// handle greyscale
		if (args >= 232) {
			var c = (args - 232) * 10 + 8;
			return [c, c, c];
		}

		args -= 16;

		var rem;
		var r = Math.floor(args / 36) / 5 * 255;
		var g = Math.floor((rem = args % 36) / 6) / 5 * 255;
		var b = (rem % 6) / 5 * 255;

		return [r, g, b];
	};

	convert.rgb.hex = function (args) {
		var integer = ((Math.round(args[0]) & 0xFF) << 16)
			+ ((Math.round(args[1]) & 0xFF) << 8)
			+ (Math.round(args[2]) & 0xFF);

		var string = integer.toString(16).toUpperCase();
		return '000000'.substring(string.length) + string;
	};

	convert.hex.rgb = function (args) {
		var match = args.toString(16).match(/[a-f0-9]{6}|[a-f0-9]{3}/i);
		if (!match) {
			return [0, 0, 0];
		}

		var colorString = match[0];

		if (match[0].length === 3) {
			colorString = colorString.split('').map(function (char) {
				return char + char;
			}).join('');
		}

		var integer = parseInt(colorString, 16);
		var r = (integer >> 16) & 0xFF;
		var g = (integer >> 8) & 0xFF;
		var b = integer & 0xFF;

		return [r, g, b];
	};

	convert.rgb.hcg = function (rgb) {
		var r = rgb[0] / 255;
		var g = rgb[1] / 255;
		var b = rgb[2] / 255;
		var max = Math.max(Math.max(r, g), b);
		var min = Math.min(Math.min(r, g), b);
		var chroma = (max - min);
		var grayscale;
		var hue;

		if (chroma < 1) {
			grayscale = min / (1 - chroma);
		} else {
			grayscale = 0;
		}

		if (chroma <= 0) {
			hue = 0;
		} else
		if (max === r) {
			hue = ((g - b) / chroma) % 6;
		} else
		if (max === g) {
			hue = 2 + (b - r) / chroma;
		} else {
			hue = 4 + (r - g) / chroma + 4;
		}

		hue /= 6;
		hue %= 1;

		return [hue * 360, chroma * 100, grayscale * 100];
	};

	convert.hsl.hcg = function (hsl) {
		var s = hsl[1] / 100;
		var l = hsl[2] / 100;
		var c = 1;
		var f = 0;

		if (l < 0.5) {
			c = 2.0 * s * l;
		} else {
			c = 2.0 * s * (1.0 - l);
		}

		if (c < 1.0) {
			f = (l - 0.5 * c) / (1.0 - c);
		}

		return [hsl[0], c * 100, f * 100];
	};

	convert.hsv.hcg = function (hsv) {
		var s = hsv[1] / 100;
		var v = hsv[2] / 100;

		var c = s * v;
		var f = 0;

		if (c < 1.0) {
			f = (v - c) / (1 - c);
		}

		return [hsv[0], c * 100, f * 100];
	};

	convert.hcg.rgb = function (hcg) {
		var h = hcg[0] / 360;
		var c = hcg[1] / 100;
		var g = hcg[2] / 100;

		if (c === 0.0) {
			return [g * 255, g * 255, g * 255];
		}

		var pure = [0, 0, 0];
		var hi = (h % 1) * 6;
		var v = hi % 1;
		var w = 1 - v;
		var mg = 0;

		switch (Math.floor(hi)) {
			case 0:
				pure[0] = 1; pure[1] = v; pure[2] = 0; break;
			case 1:
				pure[0] = w; pure[1] = 1; pure[2] = 0; break;
			case 2:
				pure[0] = 0; pure[1] = 1; pure[2] = v; break;
			case 3:
				pure[0] = 0; pure[1] = w; pure[2] = 1; break;
			case 4:
				pure[0] = v; pure[1] = 0; pure[2] = 1; break;
			default:
				pure[0] = 1; pure[1] = 0; pure[2] = w;
		}

		mg = (1.0 - c) * g;

		return [
			(c * pure[0] + mg) * 255,
			(c * pure[1] + mg) * 255,
			(c * pure[2] + mg) * 255
		];
	};

	convert.hcg.hsv = function (hcg) {
		var c = hcg[1] / 100;
		var g = hcg[2] / 100;

		var v = c + g * (1.0 - c);
		var f = 0;

		if (v > 0.0) {
			f = c / v;
		}

		return [hcg[0], f * 100, v * 100];
	};

	convert.hcg.hsl = function (hcg) {
		var c = hcg[1] / 100;
		var g = hcg[2] / 100;

		var l = g * (1.0 - c) + 0.5 * c;
		var s = 0;

		if (l > 0.0 && l < 0.5) {
			s = c / (2 * l);
		} else
		if (l >= 0.5 && l < 1.0) {
			s = c / (2 * (1 - l));
		}

		return [hcg[0], s * 100, l * 100];
	};

	convert.hcg.hwb = function (hcg) {
		var c = hcg[1] / 100;
		var g = hcg[2] / 100;
		var v = c + g * (1.0 - c);
		return [hcg[0], (v - c) * 100, (1 - v) * 100];
	};

	convert.hwb.hcg = function (hwb) {
		var w = hwb[1] / 100;
		var b = hwb[2] / 100;
		var v = 1 - b;
		var c = v - w;
		var g = 0;

		if (c < 1) {
			g = (v - c) / (1 - c);
		}

		return [hwb[0], c * 100, g * 100];
	};

	convert.apple.rgb = function (apple) {
		return [(apple[0] / 65535) * 255, (apple[1] / 65535) * 255, (apple[2] / 65535) * 255];
	};

	convert.rgb.apple = function (rgb) {
		return [(rgb[0] / 255) * 65535, (rgb[1] / 255) * 65535, (rgb[2] / 255) * 65535];
	};

	convert.gray.rgb = function (args) {
		return [args[0] / 100 * 255, args[0] / 100 * 255, args[0] / 100 * 255];
	};

	convert.gray.hsl = convert.gray.hsv = function (args) {
		return [0, 0, args[0]];
	};

	convert.gray.hwb = function (gray) {
		return [0, 100, gray[0]];
	};

	convert.gray.cmyk = function (gray) {
		return [0, 0, 0, gray[0]];
	};

	convert.gray.lab = function (gray) {
		return [gray[0], 0, 0];
	};

	convert.gray.hex = function (gray) {
		var val = Math.round(gray[0] / 100 * 255) & 0xFF;
		var integer = (val << 16) + (val << 8) + val;

		var string = integer.toString(16).toUpperCase();
		return '000000'.substring(string.length) + string;
	};

	convert.rgb.gray = function (rgb) {
		var val = (rgb[0] + rgb[1] + rgb[2]) / 3;
		return [val / 255 * 100];
	};
	});

	/*
		this function routes a model to all other models.

		all functions that are routed have a property `.conversion` attached
		to the returned synthetic function. This property is an array
		of strings, each with the steps in between the 'from' and 'to'
		color models (inclusive).

		conversions that are not possible simply are not included.
	*/

	function buildGraph() {
		var graph = {};
		// https://jsperf.com/object-keys-vs-for-in-with-closure/3
		var models = Object.keys(conversions);

		for (var len = models.length, i = 0; i < len; i++) {
			graph[models[i]] = {
				// http://jsperf.com/1-vs-infinity
				// micro-opt, but this is simple.
				distance: -1,
				parent: null
			};
		}

		return graph;
	}

	// https://en.wikipedia.org/wiki/Breadth-first_search
	function deriveBFS(fromModel) {
		var graph = buildGraph();
		var queue = [fromModel]; // unshift -> queue -> pop

		graph[fromModel].distance = 0;

		while (queue.length) {
			var current = queue.pop();
			var adjacents = Object.keys(conversions[current]);

			for (var len = adjacents.length, i = 0; i < len; i++) {
				var adjacent = adjacents[i];
				var node = graph[adjacent];

				if (node.distance === -1) {
					node.distance = graph[current].distance + 1;
					node.parent = current;
					queue.unshift(adjacent);
				}
			}
		}

		return graph;
	}

	function link(from, to) {
		return function (args) {
			return to(from(args));
		};
	}

	function wrapConversion(toModel, graph) {
		var path = [graph[toModel].parent, toModel];
		var fn = conversions[graph[toModel].parent][toModel];

		var cur = graph[toModel].parent;
		while (graph[cur].parent) {
			path.unshift(graph[cur].parent);
			fn = link(conversions[graph[cur].parent][cur], fn);
			cur = graph[cur].parent;
		}

		fn.conversion = path;
		return fn;
	}

	var route = function (fromModel) {
		var graph = deriveBFS(fromModel);
		var conversion = {};

		var models = Object.keys(graph);
		for (var len = models.length, i = 0; i < len; i++) {
			var toModel = models[i];
			var node = graph[toModel];

			if (node.parent === null) {
				// no possible conversion, or this node is the source model.
				continue;
			}

			conversion[toModel] = wrapConversion(toModel, graph);
		}

		return conversion;
	};

	var convert = {};

	var models = Object.keys(conversions);

	function wrapRaw(fn) {
		var wrappedFn = function (args) {
			if (args === undefined || args === null) {
				return args;
			}

			if (arguments.length > 1) {
				args = Array.prototype.slice.call(arguments);
			}

			return fn(args);
		};

		// preserve .conversion property if there is one
		if ('conversion' in fn) {
			wrappedFn.conversion = fn.conversion;
		}

		return wrappedFn;
	}

	function wrapRounded(fn) {
		var wrappedFn = function (args) {
			if (args === undefined || args === null) {
				return args;
			}

			if (arguments.length > 1) {
				args = Array.prototype.slice.call(arguments);
			}

			var result = fn(args);

			// we're assuming the result is an array here.
			// see notice in conversions.js; don't use box types
			// in conversion functions.
			if (typeof result === 'object') {
				for (var len = result.length, i = 0; i < len; i++) {
					result[i] = Math.round(result[i]);
				}
			}

			return result;
		};

		// preserve .conversion property if there is one
		if ('conversion' in fn) {
			wrappedFn.conversion = fn.conversion;
		}

		return wrappedFn;
	}

	models.forEach(function (fromModel) {
		convert[fromModel] = {};

		Object.defineProperty(convert[fromModel], 'channels', {value: conversions[fromModel].channels});
		Object.defineProperty(convert[fromModel], 'labels', {value: conversions[fromModel].labels});

		var routes = route(fromModel);
		var routeModels = Object.keys(routes);

		routeModels.forEach(function (toModel) {
			var fn = routes[toModel];

			convert[fromModel][toModel] = wrapRounded(fn);
			convert[fromModel][toModel].raw = wrapRaw(fn);
		});
	});

	var colorConvert = convert;

	var ansiStyles = createCommonjsModule(function (module) {


	const wrapAnsi16 = (fn, offset) => function () {
		const code = fn.apply(colorConvert, arguments);
		return `\u001B[${code + offset}m`;
	};

	const wrapAnsi256 = (fn, offset) => function () {
		const code = fn.apply(colorConvert, arguments);
		return `\u001B[${38 + offset};5;${code}m`;
	};

	const wrapAnsi16m = (fn, offset) => function () {
		const rgb = fn.apply(colorConvert, arguments);
		return `\u001B[${38 + offset};2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
	};

	function assembleStyles() {
		const codes = new Map();
		const styles = {
			modifier: {
				reset: [0, 0],
				// 21 isn't widely supported and 22 does the same thing
				bold: [1, 22],
				dim: [2, 22],
				italic: [3, 23],
				underline: [4, 24],
				inverse: [7, 27],
				hidden: [8, 28],
				strikethrough: [9, 29]
			},
			color: {
				black: [30, 39],
				red: [31, 39],
				green: [32, 39],
				yellow: [33, 39],
				blue: [34, 39],
				magenta: [35, 39],
				cyan: [36, 39],
				white: [37, 39],
				gray: [90, 39],

				// Bright color
				redBright: [91, 39],
				greenBright: [92, 39],
				yellowBright: [93, 39],
				blueBright: [94, 39],
				magentaBright: [95, 39],
				cyanBright: [96, 39],
				whiteBright: [97, 39]
			},
			bgColor: {
				bgBlack: [40, 49],
				bgRed: [41, 49],
				bgGreen: [42, 49],
				bgYellow: [43, 49],
				bgBlue: [44, 49],
				bgMagenta: [45, 49],
				bgCyan: [46, 49],
				bgWhite: [47, 49],

				// Bright color
				bgBlackBright: [100, 49],
				bgRedBright: [101, 49],
				bgGreenBright: [102, 49],
				bgYellowBright: [103, 49],
				bgBlueBright: [104, 49],
				bgMagentaBright: [105, 49],
				bgCyanBright: [106, 49],
				bgWhiteBright: [107, 49]
			}
		};

		// Fix humans
		styles.color.grey = styles.color.gray;

		for (const groupName of Object.keys(styles)) {
			const group = styles[groupName];

			for (const styleName of Object.keys(group)) {
				const style = group[styleName];

				styles[styleName] = {
					open: `\u001B[${style[0]}m`,
					close: `\u001B[${style[1]}m`
				};

				group[styleName] = styles[styleName];

				codes.set(style[0], style[1]);
			}

			Object.defineProperty(styles, groupName, {
				value: group,
				enumerable: false
			});

			Object.defineProperty(styles, 'codes', {
				value: codes,
				enumerable: false
			});
		}

		const ansi2ansi = n => n;
		const rgb2rgb = (r, g, b) => [r, g, b];

		styles.color.close = '\u001B[39m';
		styles.bgColor.close = '\u001B[49m';

		styles.color.ansi = {
			ansi: wrapAnsi16(ansi2ansi, 0)
		};
		styles.color.ansi256 = {
			ansi256: wrapAnsi256(ansi2ansi, 0)
		};
		styles.color.ansi16m = {
			rgb: wrapAnsi16m(rgb2rgb, 0)
		};

		styles.bgColor.ansi = {
			ansi: wrapAnsi16(ansi2ansi, 10)
		};
		styles.bgColor.ansi256 = {
			ansi256: wrapAnsi256(ansi2ansi, 10)
		};
		styles.bgColor.ansi16m = {
			rgb: wrapAnsi16m(rgb2rgb, 10)
		};

		for (let key of Object.keys(colorConvert)) {
			if (typeof colorConvert[key] !== 'object') {
				continue;
			}

			const suite = colorConvert[key];

			if (key === 'ansi16') {
				key = 'ansi';
			}

			if ('ansi16' in suite) {
				styles.color.ansi[key] = wrapAnsi16(suite.ansi16, 0);
				styles.bgColor.ansi[key] = wrapAnsi16(suite.ansi16, 10);
			}

			if ('ansi256' in suite) {
				styles.color.ansi256[key] = wrapAnsi256(suite.ansi256, 0);
				styles.bgColor.ansi256[key] = wrapAnsi256(suite.ansi256, 10);
			}

			if ('rgb' in suite) {
				styles.color.ansi16m[key] = wrapAnsi16m(suite.rgb, 0);
				styles.bgColor.ansi16m[key] = wrapAnsi16m(suite.rgb, 10);
			}
		}

		return styles;
	}

	// Make the export immutable
	Object.defineProperty(module, 'exports', {
		enumerable: true,
		get: assembleStyles
	});
	});

	var hasFlag = (flag, argv) => {
		argv = argv || process.argv;
		const prefix = flag.startsWith('-') ? '' : (flag.length === 1 ? '-' : '--');
		const pos = argv.indexOf(prefix + flag);
		const terminatorPos = argv.indexOf('--');
		return pos !== -1 && (terminatorPos === -1 ? true : pos < terminatorPos);
	};

	const env = process.env;

	let forceColor;
	if (hasFlag('no-color') ||
		hasFlag('no-colors') ||
		hasFlag('color=false')) {
		forceColor = false;
	} else if (hasFlag('color') ||
		hasFlag('colors') ||
		hasFlag('color=true') ||
		hasFlag('color=always')) {
		forceColor = true;
	}
	if ('FORCE_COLOR' in env) {
		forceColor = env.FORCE_COLOR.length === 0 || parseInt(env.FORCE_COLOR, 10) !== 0;
	}

	function translateLevel(level) {
		if (level === 0) {
			return false;
		}

		return {
			level,
			hasBasic: true,
			has256: level >= 2,
			has16m: level >= 3
		};
	}

	function supportsColor(stream) {
		if (forceColor === false) {
			return 0;
		}

		if (hasFlag('color=16m') ||
			hasFlag('color=full') ||
			hasFlag('color=truecolor')) {
			return 3;
		}

		if (hasFlag('color=256')) {
			return 2;
		}

		if (stream && !stream.isTTY && forceColor !== true) {
			return 0;
		}

		const min = forceColor ? 1 : 0;

		if (process.platform === 'win32') {
			// Node.js 7.5.0 is the first version of Node.js to include a patch to
			// libuv that enables 256 color output on Windows. Anything earlier and it
			// won't work. However, here we target Node.js 8 at minimum as it is an LTS
			// release, and Node.js 7 is not. Windows 10 build 10586 is the first Windows
			// release that supports 256 colors. Windows 10 build 14931 is the first release
			// that supports 16m/TrueColor.
			const osRelease = os__default['default'].release().split('.');
			if (
				Number(process.versions.node.split('.')[0]) >= 8 &&
				Number(osRelease[0]) >= 10 &&
				Number(osRelease[2]) >= 10586
			) {
				return Number(osRelease[2]) >= 14931 ? 3 : 2;
			}

			return 1;
		}

		if ('CI' in env) {
			if (['TRAVIS', 'CIRCLECI', 'APPVEYOR', 'GITLAB_CI'].some(sign => sign in env) || env.CI_NAME === 'codeship') {
				return 1;
			}

			return min;
		}

		if ('TEAMCITY_VERSION' in env) {
			return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
		}

		if (env.COLORTERM === 'truecolor') {
			return 3;
		}

		if ('TERM_PROGRAM' in env) {
			const version = parseInt((env.TERM_PROGRAM_VERSION || '').split('.')[0], 10);

			switch (env.TERM_PROGRAM) {
				case 'iTerm.app':
					return version >= 3 ? 3 : 2;
				case 'Apple_Terminal':
					return 2;
				// No default
			}
		}

		if (/-256(color)?$/i.test(env.TERM)) {
			return 2;
		}

		if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
			return 1;
		}

		if ('COLORTERM' in env) {
			return 1;
		}

		if (env.TERM === 'dumb') {
			return min;
		}

		return min;
	}

	function getSupportLevel(stream) {
		const level = supportsColor(stream);
		return translateLevel(level);
	}

	var supportsColor_1 = {
		supportsColor: getSupportLevel,
		stdout: getSupportLevel(process.stdout),
		stderr: getSupportLevel(process.stderr)
	};

	const TEMPLATE_REGEX = /(?:\\(u[a-f\d]{4}|x[a-f\d]{2}|.))|(?:\{(~)?(\w+(?:\([^)]*\))?(?:\.\w+(?:\([^)]*\))?)*)(?:[ \t]|(?=\r?\n)))|(\})|((?:.|[\r\n\f])+?)/gi;
	const STYLE_REGEX = /(?:^|\.)(\w+)(?:\(([^)]*)\))?/g;
	const STRING_REGEX = /^(['"])((?:\\.|(?!\1)[^\\])*)\1$/;
	const ESCAPE_REGEX = /\\(u[a-f\d]{4}|x[a-f\d]{2}|.)|([^\\])/gi;

	const ESCAPES = new Map([
		['n', '\n'],
		['r', '\r'],
		['t', '\t'],
		['b', '\b'],
		['f', '\f'],
		['v', '\v'],
		['0', '\0'],
		['\\', '\\'],
		['e', '\u001B'],
		['a', '\u0007']
	]);

	function unescape(c) {
		if ((c[0] === 'u' && c.length === 5) || (c[0] === 'x' && c.length === 3)) {
			return String.fromCharCode(parseInt(c.slice(1), 16));
		}

		return ESCAPES.get(c) || c;
	}

	function parseArguments(name, args) {
		const results = [];
		const chunks = args.trim().split(/\s*,\s*/g);
		let matches;

		for (const chunk of chunks) {
			if (!isNaN(chunk)) {
				results.push(Number(chunk));
			} else if ((matches = chunk.match(STRING_REGEX))) {
				results.push(matches[2].replace(ESCAPE_REGEX, (m, escape, chr) => escape ? unescape(escape) : chr));
			} else {
				throw new Error(`Invalid Chalk template style argument: ${chunk} (in style '${name}')`);
			}
		}

		return results;
	}

	function parseStyle(style) {
		STYLE_REGEX.lastIndex = 0;

		const results = [];
		let matches;

		while ((matches = STYLE_REGEX.exec(style)) !== null) {
			const name = matches[1];

			if (matches[2]) {
				const args = parseArguments(name, matches[2]);
				results.push([name].concat(args));
			} else {
				results.push([name]);
			}
		}

		return results;
	}

	function buildStyle(chalk, styles) {
		const enabled = {};

		for (const layer of styles) {
			for (const style of layer.styles) {
				enabled[style[0]] = layer.inverse ? null : style.slice(1);
			}
		}

		let current = chalk;
		for (const styleName of Object.keys(enabled)) {
			if (Array.isArray(enabled[styleName])) {
				if (!(styleName in current)) {
					throw new Error(`Unknown Chalk style: ${styleName}`);
				}

				if (enabled[styleName].length > 0) {
					current = current[styleName].apply(current, enabled[styleName]);
				} else {
					current = current[styleName];
				}
			}
		}

		return current;
	}

	var templates = (chalk, tmp) => {
		const styles = [];
		const chunks = [];
		let chunk = [];

		// eslint-disable-next-line max-params
		tmp.replace(TEMPLATE_REGEX, (m, escapeChar, inverse, style, close, chr) => {
			if (escapeChar) {
				chunk.push(unescape(escapeChar));
			} else if (style) {
				const str = chunk.join('');
				chunk = [];
				chunks.push(styles.length === 0 ? str : buildStyle(chalk, styles)(str));
				styles.push({inverse, styles: parseStyle(style)});
			} else if (close) {
				if (styles.length === 0) {
					throw new Error('Found extraneous } in Chalk template literal');
				}

				chunks.push(buildStyle(chalk, styles)(chunk.join('')));
				chunk = [];
				styles.pop();
			} else {
				chunk.push(chr);
			}
		});

		chunks.push(chunk.join(''));

		if (styles.length > 0) {
			const errMsg = `Chalk template literal is missing ${styles.length} closing bracket${styles.length === 1 ? '' : 's'} (\`}\`)`;
			throw new Error(errMsg);
		}

		return chunks.join('');
	};

	var chalk = createCommonjsModule(function (module) {


	const stdoutColor = supportsColor_1.stdout;



	const isSimpleWindowsTerm = process.platform === 'win32' && !(process.env.TERM || '').toLowerCase().startsWith('xterm');

	// `supportsColor.level` → `ansiStyles.color[name]` mapping
	const levelMapping = ['ansi', 'ansi', 'ansi256', 'ansi16m'];

	// `color-convert` models to exclude from the Chalk API due to conflicts and such
	const skipModels = new Set(['gray']);

	const styles = Object.create(null);

	function applyOptions(obj, options) {
		options = options || {};

		// Detect level if not set manually
		const scLevel = stdoutColor ? stdoutColor.level : 0;
		obj.level = options.level === undefined ? scLevel : options.level;
		obj.enabled = 'enabled' in options ? options.enabled : obj.level > 0;
	}

	function Chalk(options) {
		// We check for this.template here since calling `chalk.constructor()`
		// by itself will have a `this` of a previously constructed chalk object
		if (!this || !(this instanceof Chalk) || this.template) {
			const chalk = {};
			applyOptions(chalk, options);

			chalk.template = function () {
				const args = [].slice.call(arguments);
				return chalkTag.apply(null, [chalk.template].concat(args));
			};

			Object.setPrototypeOf(chalk, Chalk.prototype);
			Object.setPrototypeOf(chalk.template, chalk);

			chalk.template.constructor = Chalk;

			return chalk.template;
		}

		applyOptions(this, options);
	}

	// Use bright blue on Windows as the normal blue color is illegible
	if (isSimpleWindowsTerm) {
		ansiStyles.blue.open = '\u001B[94m';
	}

	for (const key of Object.keys(ansiStyles)) {
		ansiStyles[key].closeRe = new RegExp(escapeStringRegexp(ansiStyles[key].close), 'g');

		styles[key] = {
			get() {
				const codes = ansiStyles[key];
				return build.call(this, this._styles ? this._styles.concat(codes) : [codes], this._empty, key);
			}
		};
	}

	styles.visible = {
		get() {
			return build.call(this, this._styles || [], true, 'visible');
		}
	};

	ansiStyles.color.closeRe = new RegExp(escapeStringRegexp(ansiStyles.color.close), 'g');
	for (const model of Object.keys(ansiStyles.color.ansi)) {
		if (skipModels.has(model)) {
			continue;
		}

		styles[model] = {
			get() {
				const level = this.level;
				return function () {
					const open = ansiStyles.color[levelMapping[level]][model].apply(null, arguments);
					const codes = {
						open,
						close: ansiStyles.color.close,
						closeRe: ansiStyles.color.closeRe
					};
					return build.call(this, this._styles ? this._styles.concat(codes) : [codes], this._empty, model);
				};
			}
		};
	}

	ansiStyles.bgColor.closeRe = new RegExp(escapeStringRegexp(ansiStyles.bgColor.close), 'g');
	for (const model of Object.keys(ansiStyles.bgColor.ansi)) {
		if (skipModels.has(model)) {
			continue;
		}

		const bgModel = 'bg' + model[0].toUpperCase() + model.slice(1);
		styles[bgModel] = {
			get() {
				const level = this.level;
				return function () {
					const open = ansiStyles.bgColor[levelMapping[level]][model].apply(null, arguments);
					const codes = {
						open,
						close: ansiStyles.bgColor.close,
						closeRe: ansiStyles.bgColor.closeRe
					};
					return build.call(this, this._styles ? this._styles.concat(codes) : [codes], this._empty, model);
				};
			}
		};
	}

	const proto = Object.defineProperties(() => {}, styles);

	function build(_styles, _empty, key) {
		const builder = function () {
			return applyStyle.apply(builder, arguments);
		};

		builder._styles = _styles;
		builder._empty = _empty;

		const self = this;

		Object.defineProperty(builder, 'level', {
			enumerable: true,
			get() {
				return self.level;
			},
			set(level) {
				self.level = level;
			}
		});

		Object.defineProperty(builder, 'enabled', {
			enumerable: true,
			get() {
				return self.enabled;
			},
			set(enabled) {
				self.enabled = enabled;
			}
		});

		// See below for fix regarding invisible grey/dim combination on Windows
		builder.hasGrey = this.hasGrey || key === 'gray' || key === 'grey';

		// `__proto__` is used because we must return a function, but there is
		// no way to create a function with a different prototype
		builder.__proto__ = proto; // eslint-disable-line no-proto

		return builder;
	}

	function applyStyle() {
		// Support varags, but simply cast to string in case there's only one arg
		const args = arguments;
		const argsLen = args.length;
		let str = String(arguments[0]);

		if (argsLen === 0) {
			return '';
		}

		if (argsLen > 1) {
			// Don't slice `arguments`, it prevents V8 optimizations
			for (let a = 1; a < argsLen; a++) {
				str += ' ' + args[a];
			}
		}

		if (!this.enabled || this.level <= 0 || !str) {
			return this._empty ? '' : str;
		}

		// Turns out that on Windows dimmed gray text becomes invisible in cmd.exe,
		// see https://github.com/chalk/chalk/issues/58
		// If we're on Windows and we're dealing with a gray color, temporarily make 'dim' a noop.
		const originalDim = ansiStyles.dim.open;
		if (isSimpleWindowsTerm && this.hasGrey) {
			ansiStyles.dim.open = '';
		}

		for (const code of this._styles.slice().reverse()) {
			// Replace any instances already present with a re-opening code
			// otherwise only the part of the string until said closing code
			// will be colored, and the rest will simply be 'plain'.
			str = code.open + str.replace(code.closeRe, code.open) + code.close;

			// Close the styling before a linebreak and reopen
			// after next line to fix a bleed issue on macOS
			// https://github.com/chalk/chalk/pull/92
			str = str.replace(/\r?\n/g, `${code.close}$&${code.open}`);
		}

		// Reset the original `dim` if we changed it to work around the Windows dimmed gray issue
		ansiStyles.dim.open = originalDim;

		return str;
	}

	function chalkTag(chalk, strings) {
		if (!Array.isArray(strings)) {
			// If chalk() was called by itself or with a string,
			// return the string itself as a string.
			return [].slice.call(arguments, 1).join(' ');
		}

		const args = [].slice.call(arguments, 2);
		const parts = [strings.raw[0]];

		for (let i = 1; i < strings.length; i++) {
			parts.push(String(args[i - 1]).replace(/[{}\\]/g, '\\$&'));
			parts.push(String(strings.raw[i]));
		}

		return templates(chalk, parts.join(''));
	}

	Object.defineProperties(Chalk.prototype, styles);

	module.exports = Chalk(); // eslint-disable-line new-cap
	module.exports.supportsColor = stdoutColor;
	module.exports.default = module.exports; // For TypeScript
	});

	var shouldHighlight_1 = shouldHighlight;
	var getChalk_1 = getChalk;
	var _default$2 = highlight;

	var _jsTokens = _interopRequireWildcard(jsTokens);



	var _chalk = _interopRequireDefault(chalk);

	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

	function _getRequireWildcardCache() { if (typeof WeakMap !== "function") return null; var cache = new WeakMap(); _getRequireWildcardCache = function () { return cache; }; return cache; }

	function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

	function getDefs(chalk) {
	  return {
	    keyword: chalk.cyan,
	    capitalized: chalk.yellow,
	    jsx_tag: chalk.yellow,
	    punctuator: chalk.yellow,
	    number: chalk.magenta,
	    string: chalk.green,
	    regex: chalk.magenta,
	    comment: chalk.grey,
	    invalid: chalk.white.bgRed.bold
	  };
	}

	const NEWLINE = /\r\n|[\n\r\u2028\u2029]/;
	const JSX_TAG = /^[a-z][\w-]*$/i;
	const BRACKET = /^[()[\]{}]$/;

	function getTokenType(match) {
	  const [offset, text] = match.slice(-2);
	  const token = (0, _jsTokens.matchToToken)(match);

	  if (token.type === "name") {
	    if ((0, lib.isKeyword)(token.value) || (0, lib.isReservedWord)(token.value)) {
	      return "keyword";
	    }

	    if (JSX_TAG.test(token.value) && (text[offset - 1] === "<" || text.substr(offset - 2, 2) == "</")) {
	      return "jsx_tag";
	    }

	    if (token.value[0] !== token.value[0].toLowerCase()) {
	      return "capitalized";
	    }
	  }

	  if (token.type === "punctuator" && BRACKET.test(token.value)) {
	    return "bracket";
	  }

	  if (token.type === "invalid" && (token.value === "@" || token.value === "#")) {
	    return "punctuator";
	  }

	  return token.type;
	}

	function highlightTokens(defs, text) {
	  return text.replace(_jsTokens.default, function (...args) {
	    const type = getTokenType(args);
	    const colorize = defs[type];

	    if (colorize) {
	      return args[0].split(NEWLINE).map(str => colorize(str)).join("\n");
	    } else {
	      return args[0];
	    }
	  });
	}

	function shouldHighlight(options) {
	  return _chalk.default.supportsColor || options.forceColor;
	}

	function getChalk(options) {
	  let chalk = _chalk.default;

	  if (options.forceColor) {
	    chalk = new _chalk.default.constructor({
	      enabled: true,
	      level: 1
	    });
	  }

	  return chalk;
	}

	function highlight(code, options = {}) {
	  if (shouldHighlight(options)) {
	    const chalk = getChalk(options);
	    const defs = getDefs(chalk);
	    return highlightTokens(defs, code);
	  } else {
	    return code;
	  }
	}

	var lib$1 = /*#__PURE__*/Object.defineProperty({
		shouldHighlight: shouldHighlight_1,
		getChalk: getChalk_1,
		default: _default$2
	}, '__esModule', {value: true});

	var codeFrameColumns_1 = codeFrameColumns;
	var default_1 = _default$3;

	var _highlight = _interopRequireWildcard$1(lib$1);

	function _getRequireWildcardCache$1() { if (typeof WeakMap !== "function") return null; var cache = new WeakMap(); _getRequireWildcardCache$1 = function () { return cache; }; return cache; }

	function _interopRequireWildcard$1(obj) { if (obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache$1(); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

	let deprecationWarningShown = false;

	function getDefs$1(chalk) {
	  return {
	    gutter: chalk.grey,
	    marker: chalk.red.bold,
	    message: chalk.red.bold
	  };
	}

	const NEWLINE$1 = /\r\n|[\n\r\u2028\u2029]/;

	function getMarkerLines(loc, source, opts) {
	  const startLoc = Object.assign({
	    column: 0,
	    line: -1
	  }, loc.start);
	  const endLoc = Object.assign({}, startLoc, loc.end);
	  const {
	    linesAbove = 2,
	    linesBelow = 3
	  } = opts || {};
	  const startLine = startLoc.line;
	  const startColumn = startLoc.column;
	  const endLine = endLoc.line;
	  const endColumn = endLoc.column;
	  let start = Math.max(startLine - (linesAbove + 1), 0);
	  let end = Math.min(source.length, endLine + linesBelow);

	  if (startLine === -1) {
	    start = 0;
	  }

	  if (endLine === -1) {
	    end = source.length;
	  }

	  const lineDiff = endLine - startLine;
	  const markerLines = {};

	  if (lineDiff) {
	    for (let i = 0; i <= lineDiff; i++) {
	      const lineNumber = i + startLine;

	      if (!startColumn) {
	        markerLines[lineNumber] = true;
	      } else if (i === 0) {
	        const sourceLength = source[lineNumber - 1].length;
	        markerLines[lineNumber] = [startColumn, sourceLength - startColumn + 1];
	      } else if (i === lineDiff) {
	        markerLines[lineNumber] = [0, endColumn];
	      } else {
	        const sourceLength = source[lineNumber - i].length;
	        markerLines[lineNumber] = [0, sourceLength];
	      }
	    }
	  } else {
	    if (startColumn === endColumn) {
	      if (startColumn) {
	        markerLines[startLine] = [startColumn, 0];
	      } else {
	        markerLines[startLine] = true;
	      }
	    } else {
	      markerLines[startLine] = [startColumn, endColumn - startColumn];
	    }
	  }

	  return {
	    start,
	    end,
	    markerLines
	  };
	}

	function codeFrameColumns(rawLines, loc, opts = {}) {
	  const highlighted = (opts.highlightCode || opts.forceColor) && (0, _highlight.shouldHighlight)(opts);
	  const chalk = (0, _highlight.getChalk)(opts);
	  const defs = getDefs$1(chalk);

	  const maybeHighlight = (chalkFn, string) => {
	    return highlighted ? chalkFn(string) : string;
	  };

	  const lines = rawLines.split(NEWLINE$1);
	  const {
	    start,
	    end,
	    markerLines
	  } = getMarkerLines(loc, lines, opts);
	  const hasColumns = loc.start && typeof loc.start.column === "number";
	  const numberMaxWidth = String(end).length;
	  const highlightedLines = highlighted ? (0, _highlight.default)(rawLines, opts) : rawLines;
	  let frame = highlightedLines.split(NEWLINE$1).slice(start, end).map((line, index) => {
	    const number = start + 1 + index;
	    const paddedNumber = ` ${number}`.slice(-numberMaxWidth);
	    const gutter = ` ${paddedNumber} | `;
	    const hasMarker = markerLines[number];
	    const lastMarkerLine = !markerLines[number + 1];

	    if (hasMarker) {
	      let markerLine = "";

	      if (Array.isArray(hasMarker)) {
	        const markerSpacing = line.slice(0, Math.max(hasMarker[0] - 1, 0)).replace(/[^\t]/g, " ");
	        const numberOfMarkers = hasMarker[1] || 1;
	        markerLine = ["\n ", maybeHighlight(defs.gutter, gutter.replace(/\d/g, " ")), markerSpacing, maybeHighlight(defs.marker, "^").repeat(numberOfMarkers)].join("");

	        if (lastMarkerLine && opts.message) {
	          markerLine += " " + maybeHighlight(defs.message, opts.message);
	        }
	      }

	      return [maybeHighlight(defs.marker, ">"), maybeHighlight(defs.gutter, gutter), line, markerLine].join("");
	    } else {
	      return ` ${maybeHighlight(defs.gutter, gutter)}${line}`;
	    }
	  }).join("\n");

	  if (opts.message && !hasColumns) {
	    frame = `${" ".repeat(numberMaxWidth + 1)}${opts.message}\n${frame}`;
	  }

	  if (highlighted) {
	    return chalk.reset(frame);
	  } else {
	    return frame;
	  }
	}

	function _default$3(rawLines, lineNumber, colNumber, opts = {}) {
	  if (!deprecationWarningShown) {
	    deprecationWarningShown = true;
	    const message = "Passing lineNumber and colNumber is deprecated to @babel/code-frame. Please use `codeFrameColumns`.";

	    if (process.emitWarning) {
	      process.emitWarning(message, "DeprecationWarning");
	    } else {
	      const deprecationError = new Error(message);
	      deprecationError.name = "DeprecationWarning";
	      console.warn(new Error(message));
	    }
	  }

	  colNumber = Math.max(colNumber, 0);
	  const location = {
	    start: {
	      column: colNumber,
	      line: lineNumber
	    }
	  };
	  return codeFrameColumns(rawLines, location, opts);
	}

	var lib$2 = /*#__PURE__*/Object.defineProperty({
		codeFrameColumns: codeFrameColumns_1,
		default: default_1
	}, '__esModule', {value: true});

	var require$$0 = /*@__PURE__*/getAugmentedNamespace(dist);

	const {default: LinesAndColumns$1} = require$$0;
	const {codeFrameColumns: codeFrameColumns$1} = lib$2;

	const JSONError = errorEx_1('JSONError', {
		fileName: errorEx_1.append('in %s'),
		codeFrame: errorEx_1.append('\n\n%s\n')
	});

	var parseJson$1 = (string, reviver, filename) => {
		if (typeof reviver === 'string') {
			filename = reviver;
			reviver = null;
		}

		try {
			try {
				return JSON.parse(string, reviver);
			} catch (error) {
				jsonParseEvenBetterErrors(string, reviver);
				throw error;
			}
		} catch (error) {
			error.message = error.message.replace(/\n/g, '');
			const indexMatch = error.message.match(/in JSON at position (\d+) while parsing/);

			const jsonError = new JSONError(error);
			if (filename) {
				jsonError.fileName = filename;
			}

			if (indexMatch && indexMatch.length > 0) {
				const lines = new LinesAndColumns$1(string);
				const index = Number(indexMatch[1]);
				const location = lines.locationForIndex(index);

				const codeFrame = codeFrameColumns$1(
					string,
					{start: {line: location.line + 1, column: location.column + 1}},
					{highlightCode: true}
				);

				jsonError.codeFrame = codeFrame;
			}

			throw jsonError;
		}
	};

	const Char = {
	  ANCHOR: '&',
	  COMMENT: '#',
	  TAG: '!',
	  DIRECTIVES_END: '-',
	  DOCUMENT_END: '.'
	};
	const Type = {
	  ALIAS: 'ALIAS',
	  BLANK_LINE: 'BLANK_LINE',
	  BLOCK_FOLDED: 'BLOCK_FOLDED',
	  BLOCK_LITERAL: 'BLOCK_LITERAL',
	  COMMENT: 'COMMENT',
	  DIRECTIVE: 'DIRECTIVE',
	  DOCUMENT: 'DOCUMENT',
	  FLOW_MAP: 'FLOW_MAP',
	  FLOW_SEQ: 'FLOW_SEQ',
	  MAP: 'MAP',
	  MAP_KEY: 'MAP_KEY',
	  MAP_VALUE: 'MAP_VALUE',
	  PLAIN: 'PLAIN',
	  QUOTE_DOUBLE: 'QUOTE_DOUBLE',
	  QUOTE_SINGLE: 'QUOTE_SINGLE',
	  SEQ: 'SEQ',
	  SEQ_ITEM: 'SEQ_ITEM'
	};
	const defaultTagPrefix = 'tag:yaml.org,2002:';
	const defaultTags = {
	  MAP: 'tag:yaml.org,2002:map',
	  SEQ: 'tag:yaml.org,2002:seq',
	  STR: 'tag:yaml.org,2002:str'
	};

	function findLineStarts(src) {
	  const ls = [0];
	  let offset = src.indexOf('\n');

	  while (offset !== -1) {
	    offset += 1;
	    ls.push(offset);
	    offset = src.indexOf('\n', offset);
	  }

	  return ls;
	}

	function getSrcInfo(cst) {
	  let lineStarts, src;

	  if (typeof cst === 'string') {
	    lineStarts = findLineStarts(cst);
	    src = cst;
	  } else {
	    if (Array.isArray(cst)) cst = cst[0];

	    if (cst && cst.context) {
	      if (!cst.lineStarts) cst.lineStarts = findLineStarts(cst.context.src);
	      lineStarts = cst.lineStarts;
	      src = cst.context.src;
	    }
	  }

	  return {
	    lineStarts,
	    src
	  };
	}
	/**
	 * @typedef {Object} LinePos - One-indexed position in the source
	 * @property {number} line
	 * @property {number} col
	 */

	/**
	 * Determine the line/col position matching a character offset.
	 *
	 * Accepts a source string or a CST document as the second parameter. With
	 * the latter, starting indices for lines are cached in the document as
	 * `lineStarts: number[]`.
	 *
	 * Returns a one-indexed `{ line, col }` location if found, or
	 * `undefined` otherwise.
	 *
	 * @param {number} offset
	 * @param {string|Document|Document[]} cst
	 * @returns {?LinePos}
	 */


	function getLinePos(offset, cst) {
	  if (typeof offset !== 'number' || offset < 0) return null;
	  const {
	    lineStarts,
	    src
	  } = getSrcInfo(cst);
	  if (!lineStarts || !src || offset > src.length) return null;

	  for (let i = 0; i < lineStarts.length; ++i) {
	    const start = lineStarts[i];

	    if (offset < start) {
	      return {
	        line: i,
	        col: offset - lineStarts[i - 1] + 1
	      };
	    }

	    if (offset === start) return {
	      line: i + 1,
	      col: 1
	    };
	  }

	  const line = lineStarts.length;
	  return {
	    line,
	    col: offset - lineStarts[line - 1] + 1
	  };
	}
	/**
	 * Get a specified line from the source.
	 *
	 * Accepts a source string or a CST document as the second parameter. With
	 * the latter, starting indices for lines are cached in the document as
	 * `lineStarts: number[]`.
	 *
	 * Returns the line as a string if found, or `null` otherwise.
	 *
	 * @param {number} line One-indexed line number
	 * @param {string|Document|Document[]} cst
	 * @returns {?string}
	 */

	function getLine(line, cst) {
	  const {
	    lineStarts,
	    src
	  } = getSrcInfo(cst);
	  if (!lineStarts || !(line >= 1) || line > lineStarts.length) return null;
	  const start = lineStarts[line - 1];
	  let end = lineStarts[line]; // undefined for last line; that's ok for slice()

	  while (end && end > start && src[end - 1] === '\n') --end;

	  return src.slice(start, end);
	}
	/**
	 * Pretty-print the starting line from the source indicated by the range `pos`
	 *
	 * Trims output to `maxWidth` chars while keeping the starting column visible,
	 * using `…` at either end to indicate dropped characters.
	 *
	 * Returns a two-line string (or `null`) with `\n` as separator; the second line
	 * will hold appropriately indented `^` marks indicating the column range.
	 *
	 * @param {Object} pos
	 * @param {LinePos} pos.start
	 * @param {LinePos} [pos.end]
	 * @param {string|Document|Document[]*} cst
	 * @param {number} [maxWidth=80]
	 * @returns {?string}
	 */

	function getPrettyContext({
	  start,
	  end
	}, cst, maxWidth = 80) {
	  let src = getLine(start.line, cst);
	  if (!src) return null;
	  let {
	    col
	  } = start;

	  if (src.length > maxWidth) {
	    if (col <= maxWidth - 10) {
	      src = src.substr(0, maxWidth - 1) + '…';
	    } else {
	      const halfWidth = Math.round(maxWidth / 2);
	      if (src.length > col + halfWidth) src = src.substr(0, col + halfWidth - 1) + '…';
	      col -= src.length - maxWidth;
	      src = '…' + src.substr(1 - maxWidth);
	    }
	  }

	  let errLen = 1;
	  let errEnd = '';

	  if (end) {
	    if (end.line === start.line && col + (end.col - start.col) <= maxWidth + 1) {
	      errLen = end.col - start.col;
	    } else {
	      errLen = Math.min(src.length + 1, maxWidth) - col;
	      errEnd = '…';
	    }
	  }

	  const offset = col > 1 ? ' '.repeat(col - 1) : '';
	  const err = '^'.repeat(errLen);
	  return `${src}\n${offset}${err}${errEnd}`;
	}

	class Range {
	  static copy(orig) {
	    return new Range(orig.start, orig.end);
	  }

	  constructor(start, end) {
	    this.start = start;
	    this.end = end || start;
	  }

	  isEmpty() {
	    return typeof this.start !== 'number' || !this.end || this.end <= this.start;
	  }
	  /**
	   * Set `origStart` and `origEnd` to point to the original source range for
	   * this node, which may differ due to dropped CR characters.
	   *
	   * @param {number[]} cr - Positions of dropped CR characters
	   * @param {number} offset - Starting index of `cr` from the last call
	   * @returns {number} - The next offset, matching the one found for `origStart`
	   */


	  setOrigRange(cr, offset) {
	    const {
	      start,
	      end
	    } = this;

	    if (cr.length === 0 || end <= cr[0]) {
	      this.origStart = start;
	      this.origEnd = end;
	      return offset;
	    }

	    let i = offset;

	    while (i < cr.length) {
	      if (cr[i] > start) break;else ++i;
	    }

	    this.origStart = start + i;
	    const nextOffset = i;

	    while (i < cr.length) {
	      // if end was at \n, it should now be at \r
	      if (cr[i] >= end) break;else ++i;
	    }

	    this.origEnd = end + i;
	    return nextOffset;
	  }

	}

	/** Root class of all nodes */

	class Node {
	  static addStringTerminator(src, offset, str) {
	    if (str[str.length - 1] === '\n') return str;
	    const next = Node.endOfWhiteSpace(src, offset);
	    return next >= src.length || src[next] === '\n' ? str + '\n' : str;
	  } // ^(---|...)


	  static atDocumentBoundary(src, offset, sep) {
	    const ch0 = src[offset];
	    if (!ch0) return true;
	    const prev = src[offset - 1];
	    if (prev && prev !== '\n') return false;

	    if (sep) {
	      if (ch0 !== sep) return false;
	    } else {
	      if (ch0 !== Char.DIRECTIVES_END && ch0 !== Char.DOCUMENT_END) return false;
	    }

	    const ch1 = src[offset + 1];
	    const ch2 = src[offset + 2];
	    if (ch1 !== ch0 || ch2 !== ch0) return false;
	    const ch3 = src[offset + 3];
	    return !ch3 || ch3 === '\n' || ch3 === '\t' || ch3 === ' ';
	  }

	  static endOfIdentifier(src, offset) {
	    let ch = src[offset];
	    const isVerbatim = ch === '<';
	    const notOk = isVerbatim ? ['\n', '\t', ' ', '>'] : ['\n', '\t', ' ', '[', ']', '{', '}', ','];

	    while (ch && notOk.indexOf(ch) === -1) ch = src[offset += 1];

	    if (isVerbatim && ch === '>') offset += 1;
	    return offset;
	  }

	  static endOfIndent(src, offset) {
	    let ch = src[offset];

	    while (ch === ' ') ch = src[offset += 1];

	    return offset;
	  }

	  static endOfLine(src, offset) {
	    let ch = src[offset];

	    while (ch && ch !== '\n') ch = src[offset += 1];

	    return offset;
	  }

	  static endOfWhiteSpace(src, offset) {
	    let ch = src[offset];

	    while (ch === '\t' || ch === ' ') ch = src[offset += 1];

	    return offset;
	  }

	  static startOfLine(src, offset) {
	    let ch = src[offset - 1];
	    if (ch === '\n') return offset;

	    while (ch && ch !== '\n') ch = src[offset -= 1];

	    return offset + 1;
	  }
	  /**
	   * End of indentation, or null if the line's indent level is not more
	   * than `indent`
	   *
	   * @param {string} src
	   * @param {number} indent
	   * @param {number} lineStart
	   * @returns {?number}
	   */


	  static endOfBlockIndent(src, indent, lineStart) {
	    const inEnd = Node.endOfIndent(src, lineStart);

	    if (inEnd > lineStart + indent) {
	      return inEnd;
	    } else {
	      const wsEnd = Node.endOfWhiteSpace(src, inEnd);
	      const ch = src[wsEnd];
	      if (!ch || ch === '\n') return wsEnd;
	    }

	    return null;
	  }

	  static atBlank(src, offset, endAsBlank) {
	    const ch = src[offset];
	    return ch === '\n' || ch === '\t' || ch === ' ' || endAsBlank && !ch;
	  }

	  static nextNodeIsIndented(ch, indentDiff, indicatorAsIndent) {
	    if (!ch || indentDiff < 0) return false;
	    if (indentDiff > 0) return true;
	    return indicatorAsIndent && ch === '-';
	  } // should be at line or string end, or at next non-whitespace char


	  static normalizeOffset(src, offset) {
	    const ch = src[offset];
	    return !ch ? offset : ch !== '\n' && src[offset - 1] === '\n' ? offset - 1 : Node.endOfWhiteSpace(src, offset);
	  } // fold single newline into space, multiple newlines to N - 1 newlines
	  // presumes src[offset] === '\n'


	  static foldNewline(src, offset, indent) {
	    let inCount = 0;
	    let error = false;
	    let fold = '';
	    let ch = src[offset + 1];

	    while (ch === ' ' || ch === '\t' || ch === '\n') {
	      switch (ch) {
	        case '\n':
	          inCount = 0;
	          offset += 1;
	          fold += '\n';
	          break;

	        case '\t':
	          if (inCount <= indent) error = true;
	          offset = Node.endOfWhiteSpace(src, offset + 2) - 1;
	          break;

	        case ' ':
	          inCount += 1;
	          offset += 1;
	          break;
	      }

	      ch = src[offset + 1];
	    }

	    if (!fold) fold = ' ';
	    if (ch && inCount <= indent) error = true;
	    return {
	      fold,
	      offset,
	      error
	    };
	  }

	  constructor(type, props, context) {
	    Object.defineProperty(this, 'context', {
	      value: context || null,
	      writable: true
	    });
	    this.error = null;
	    this.range = null;
	    this.valueRange = null;
	    this.props = props || [];
	    this.type = type;
	    this.value = null;
	  }

	  getPropValue(idx, key, skipKey) {
	    if (!this.context) return null;
	    const {
	      src
	    } = this.context;
	    const prop = this.props[idx];
	    return prop && src[prop.start] === key ? src.slice(prop.start + (skipKey ? 1 : 0), prop.end) : null;
	  }

	  get anchor() {
	    for (let i = 0; i < this.props.length; ++i) {
	      const anchor = this.getPropValue(i, Char.ANCHOR, true);
	      if (anchor != null) return anchor;
	    }

	    return null;
	  }

	  get comment() {
	    const comments = [];

	    for (let i = 0; i < this.props.length; ++i) {
	      const comment = this.getPropValue(i, Char.COMMENT, true);
	      if (comment != null) comments.push(comment);
	    }

	    return comments.length > 0 ? comments.join('\n') : null;
	  }

	  commentHasRequiredWhitespace(start) {
	    const {
	      src
	    } = this.context;
	    if (this.header && start === this.header.end) return false;
	    if (!this.valueRange) return false;
	    const {
	      end
	    } = this.valueRange;
	    return start !== end || Node.atBlank(src, end - 1);
	  }

	  get hasComment() {
	    if (this.context) {
	      const {
	        src
	      } = this.context;

	      for (let i = 0; i < this.props.length; ++i) {
	        if (src[this.props[i].start] === Char.COMMENT) return true;
	      }
	    }

	    return false;
	  }

	  get hasProps() {
	    if (this.context) {
	      const {
	        src
	      } = this.context;

	      for (let i = 0; i < this.props.length; ++i) {
	        if (src[this.props[i].start] !== Char.COMMENT) return true;
	      }
	    }

	    return false;
	  }

	  get includesTrailingLines() {
	    return false;
	  }

	  get jsonLike() {
	    const jsonLikeTypes = [Type.FLOW_MAP, Type.FLOW_SEQ, Type.QUOTE_DOUBLE, Type.QUOTE_SINGLE];
	    return jsonLikeTypes.indexOf(this.type) !== -1;
	  }

	  get rangeAsLinePos() {
	    if (!this.range || !this.context) return undefined;
	    const start = getLinePos(this.range.start, this.context.root);
	    if (!start) return undefined;
	    const end = getLinePos(this.range.end, this.context.root);
	    return {
	      start,
	      end
	    };
	  }

	  get rawValue() {
	    if (!this.valueRange || !this.context) return null;
	    const {
	      start,
	      end
	    } = this.valueRange;
	    return this.context.src.slice(start, end);
	  }

	  get tag() {
	    for (let i = 0; i < this.props.length; ++i) {
	      const tag = this.getPropValue(i, Char.TAG, false);

	      if (tag != null) {
	        if (tag[1] === '<') {
	          return {
	            verbatim: tag.slice(2, -1)
	          };
	        } else {
	          // eslint-disable-next-line no-unused-vars
	          const [_, handle, suffix] = tag.match(/^(.*!)([^!]*)$/);
	          return {
	            handle,
	            suffix
	          };
	        }
	      }
	    }

	    return null;
	  }

	  get valueRangeContainsNewline() {
	    if (!this.valueRange || !this.context) return false;
	    const {
	      start,
	      end
	    } = this.valueRange;
	    const {
	      src
	    } = this.context;

	    for (let i = start; i < end; ++i) {
	      if (src[i] === '\n') return true;
	    }

	    return false;
	  }

	  parseComment(start) {
	    const {
	      src
	    } = this.context;

	    if (src[start] === Char.COMMENT) {
	      const end = Node.endOfLine(src, start + 1);
	      const commentRange = new Range(start, end);
	      this.props.push(commentRange);
	      return end;
	    }

	    return start;
	  }
	  /**
	   * Populates the `origStart` and `origEnd` values of all ranges for this
	   * node. Extended by child classes to handle descendant nodes.
	   *
	   * @param {number[]} cr - Positions of dropped CR characters
	   * @param {number} offset - Starting index of `cr` from the last call
	   * @returns {number} - The next offset, matching the one found for `origStart`
	   */


	  setOrigRanges(cr, offset) {
	    if (this.range) offset = this.range.setOrigRange(cr, offset);
	    if (this.valueRange) this.valueRange.setOrigRange(cr, offset);
	    this.props.forEach(prop => prop.setOrigRange(cr, offset));
	    return offset;
	  }

	  toString() {
	    const {
	      context: {
	        src
	      },
	      range,
	      value
	    } = this;
	    if (value != null) return value;
	    const str = src.slice(range.start, range.end);
	    return Node.addStringTerminator(src, range.end, str);
	  }

	}

	class YAMLError extends Error {
	  constructor(name, source, message) {
	    if (!message || !(source instanceof Node)) throw new Error(`Invalid arguments for new ${name}`);
	    super();
	    this.name = name;
	    this.message = message;
	    this.source = source;
	  }

	  makePretty() {
	    if (!this.source) return;
	    this.nodeType = this.source.type;
	    const cst = this.source.context && this.source.context.root;

	    if (typeof this.offset === 'number') {
	      this.range = new Range(this.offset, this.offset + 1);
	      const start = cst && getLinePos(this.offset, cst);

	      if (start) {
	        const end = {
	          line: start.line,
	          col: start.col + 1
	        };
	        this.linePos = {
	          start,
	          end
	        };
	      }

	      delete this.offset;
	    } else {
	      this.range = this.source.range;
	      this.linePos = this.source.rangeAsLinePos;
	    }

	    if (this.linePos) {
	      const {
	        line,
	        col
	      } = this.linePos.start;
	      this.message += ` at line ${line}, column ${col}`;
	      const ctx = cst && getPrettyContext(this.linePos, cst);
	      if (ctx) this.message += `:\n\n${ctx}\n`;
	    }

	    delete this.source;
	  }

	}
	class YAMLReferenceError extends YAMLError {
	  constructor(source, message) {
	    super('YAMLReferenceError', source, message);
	  }

	}
	class YAMLSemanticError extends YAMLError {
	  constructor(source, message) {
	    super('YAMLSemanticError', source, message);
	  }

	}
	class YAMLSyntaxError extends YAMLError {
	  constructor(source, message) {
	    super('YAMLSyntaxError', source, message);
	  }

	}
	class YAMLWarning extends YAMLError {
	  constructor(source, message) {
	    super('YAMLWarning', source, message);
	  }

	}

	function _defineProperty(obj, key, value) {
	  if (key in obj) {
	    Object.defineProperty(obj, key, {
	      value: value,
	      enumerable: true,
	      configurable: true,
	      writable: true
	    });
	  } else {
	    obj[key] = value;
	  }

	  return obj;
	}

	class PlainValue extends Node {
	  static endOfLine(src, start, inFlow) {
	    let ch = src[start];
	    let offset = start;

	    while (ch && ch !== '\n') {
	      if (inFlow && (ch === '[' || ch === ']' || ch === '{' || ch === '}' || ch === ',')) break;
	      const next = src[offset + 1];
	      if (ch === ':' && (!next || next === '\n' || next === '\t' || next === ' ' || inFlow && next === ',')) break;
	      if ((ch === ' ' || ch === '\t') && next === '#') break;
	      offset += 1;
	      ch = next;
	    }

	    return offset;
	  }

	  get strValue() {
	    if (!this.valueRange || !this.context) return null;
	    let {
	      start,
	      end
	    } = this.valueRange;
	    const {
	      src
	    } = this.context;
	    let ch = src[end - 1];

	    while (start < end && (ch === '\n' || ch === '\t' || ch === ' ')) ch = src[--end - 1];

	    let str = '';

	    for (let i = start; i < end; ++i) {
	      const ch = src[i];

	      if (ch === '\n') {
	        const {
	          fold,
	          offset
	        } = Node.foldNewline(src, i, -1);
	        str += fold;
	        i = offset;
	      } else if (ch === ' ' || ch === '\t') {
	        // trim trailing whitespace
	        const wsStart = i;
	        let next = src[i + 1];

	        while (i < end && (next === ' ' || next === '\t')) {
	          i += 1;
	          next = src[i + 1];
	        }

	        if (next !== '\n') str += i > wsStart ? src.slice(wsStart, i + 1) : ch;
	      } else {
	        str += ch;
	      }
	    }

	    const ch0 = src[start];

	    switch (ch0) {
	      case '\t':
	        {
	          const msg = 'Plain value cannot start with a tab character';
	          const errors = [new YAMLSemanticError(this, msg)];
	          return {
	            errors,
	            str
	          };
	        }

	      case '@':
	      case '`':
	        {
	          const msg = `Plain value cannot start with reserved character ${ch0}`;
	          const errors = [new YAMLSemanticError(this, msg)];
	          return {
	            errors,
	            str
	          };
	        }

	      default:
	        return str;
	    }
	  }

	  parseBlockValue(start) {
	    const {
	      indent,
	      inFlow,
	      src
	    } = this.context;
	    let offset = start;
	    let valueEnd = start;

	    for (let ch = src[offset]; ch === '\n'; ch = src[offset]) {
	      if (Node.atDocumentBoundary(src, offset + 1)) break;
	      const end = Node.endOfBlockIndent(src, indent, offset + 1);
	      if (end === null || src[end] === '#') break;

	      if (src[end] === '\n') {
	        offset = end;
	      } else {
	        valueEnd = PlainValue.endOfLine(src, end, inFlow);
	        offset = valueEnd;
	      }
	    }

	    if (this.valueRange.isEmpty()) this.valueRange.start = start;
	    this.valueRange.end = valueEnd;
	    return valueEnd;
	  }
	  /**
	   * Parses a plain value from the source
	   *
	   * Accepted forms are:
	   * ```
	   * #comment
	   *
	   * first line
	   *
	   * first line #comment
	   *
	   * first line
	   * block
	   * lines
	   *
	   * #comment
	   * block
	   * lines
	   * ```
	   * where block lines are empty or have an indent level greater than `indent`.
	   *
	   * @param {ParseContext} context
	   * @param {number} start - Index of first character
	   * @returns {number} - Index of the character after this scalar, may be `\n`
	   */


	  parse(context, start) {
	    this.context = context;
	    const {
	      inFlow,
	      src
	    } = context;
	    let offset = start;
	    const ch = src[offset];

	    if (ch && ch !== '#' && ch !== '\n') {
	      offset = PlainValue.endOfLine(src, start, inFlow);
	    }

	    this.valueRange = new Range(start, offset);
	    offset = Node.endOfWhiteSpace(src, offset);
	    offset = this.parseComment(offset);

	    if (!this.hasComment || this.valueRange.isEmpty()) {
	      offset = this.parseBlockValue(offset);
	    }

	    return offset;
	  }

	}

	var Char_1 = Char;
	var Node_1 = Node;
	var PlainValue_1 = PlainValue;
	var Range_1 = Range;
	var Type_1 = Type;
	var YAMLError_1 = YAMLError;
	var YAMLReferenceError_1 = YAMLReferenceError;
	var YAMLSemanticError_1 = YAMLSemanticError;
	var YAMLSyntaxError_1 = YAMLSyntaxError;
	var YAMLWarning_1 = YAMLWarning;
	var _defineProperty_1 = _defineProperty;
	var defaultTagPrefix_1 = defaultTagPrefix;
	var defaultTags_1 = defaultTags;

	var PlainValueEc8e588e = {
		Char: Char_1,
		Node: Node_1,
		PlainValue: PlainValue_1,
		Range: Range_1,
		Type: Type_1,
		YAMLError: YAMLError_1,
		YAMLReferenceError: YAMLReferenceError_1,
		YAMLSemanticError: YAMLSemanticError_1,
		YAMLSyntaxError: YAMLSyntaxError_1,
		YAMLWarning: YAMLWarning_1,
		_defineProperty: _defineProperty_1,
		defaultTagPrefix: defaultTagPrefix_1,
		defaultTags: defaultTags_1
	};

	class BlankLine extends PlainValueEc8e588e.Node {
	  constructor() {
	    super(PlainValueEc8e588e.Type.BLANK_LINE);
	  }
	  /* istanbul ignore next */


	  get includesTrailingLines() {
	    // This is never called from anywhere, but if it were,
	    // this is the value it should return.
	    return true;
	  }
	  /**
	   * Parses a blank line from the source
	   *
	   * @param {ParseContext} context
	   * @param {number} start - Index of first \n character
	   * @returns {number} - Index of the character after this
	   */


	  parse(context, start) {
	    this.context = context;
	    this.range = new PlainValueEc8e588e.Range(start, start + 1);
	    return start + 1;
	  }

	}

	class CollectionItem extends PlainValueEc8e588e.Node {
	  constructor(type, props) {
	    super(type, props);
	    this.node = null;
	  }

	  get includesTrailingLines() {
	    return !!this.node && this.node.includesTrailingLines;
	  }
	  /**
	   * @param {ParseContext} context
	   * @param {number} start - Index of first character
	   * @returns {number} - Index of the character after this
	   */


	  parse(context, start) {
	    this.context = context;
	    const {
	      parseNode,
	      src
	    } = context;
	    let {
	      atLineStart,
	      lineStart
	    } = context;
	    if (!atLineStart && this.type === PlainValueEc8e588e.Type.SEQ_ITEM) this.error = new PlainValueEc8e588e.YAMLSemanticError(this, 'Sequence items must not have preceding content on the same line');
	    const indent = atLineStart ? start - lineStart : context.indent;
	    let offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, start + 1);
	    let ch = src[offset];
	    const inlineComment = ch === '#';
	    const comments = [];
	    let blankLine = null;

	    while (ch === '\n' || ch === '#') {
	      if (ch === '#') {
	        const end = PlainValueEc8e588e.Node.endOfLine(src, offset + 1);
	        comments.push(new PlainValueEc8e588e.Range(offset, end));
	        offset = end;
	      } else {
	        atLineStart = true;
	        lineStart = offset + 1;
	        const wsEnd = PlainValueEc8e588e.Node.endOfWhiteSpace(src, lineStart);

	        if (src[wsEnd] === '\n' && comments.length === 0) {
	          blankLine = new BlankLine();
	          lineStart = blankLine.parse({
	            src
	          }, lineStart);
	        }

	        offset = PlainValueEc8e588e.Node.endOfIndent(src, lineStart);
	      }

	      ch = src[offset];
	    }

	    if (PlainValueEc8e588e.Node.nextNodeIsIndented(ch, offset - (lineStart + indent), this.type !== PlainValueEc8e588e.Type.SEQ_ITEM)) {
	      this.node = parseNode({
	        atLineStart,
	        inCollection: false,
	        indent,
	        lineStart,
	        parent: this
	      }, offset);
	    } else if (ch && lineStart > start + 1) {
	      offset = lineStart - 1;
	    }

	    if (this.node) {
	      if (blankLine) {
	        // Only blank lines preceding non-empty nodes are captured. Note that
	        // this means that collection item range start indices do not always
	        // increase monotonically. -- eemeli/yaml#126
	        const items = context.parent.items || context.parent.contents;
	        if (items) items.push(blankLine);
	      }

	      if (comments.length) Array.prototype.push.apply(this.props, comments);
	      offset = this.node.range.end;
	    } else {
	      if (inlineComment) {
	        const c = comments[0];
	        this.props.push(c);
	        offset = c.end;
	      } else {
	        offset = PlainValueEc8e588e.Node.endOfLine(src, start + 1);
	      }
	    }

	    const end = this.node ? this.node.valueRange.end : offset;
	    this.valueRange = new PlainValueEc8e588e.Range(start, end);
	    return offset;
	  }

	  setOrigRanges(cr, offset) {
	    offset = super.setOrigRanges(cr, offset);
	    return this.node ? this.node.setOrigRanges(cr, offset) : offset;
	  }

	  toString() {
	    const {
	      context: {
	        src
	      },
	      node,
	      range,
	      value
	    } = this;
	    if (value != null) return value;
	    const str = node ? src.slice(range.start, node.range.start) + String(node) : src.slice(range.start, range.end);
	    return PlainValueEc8e588e.Node.addStringTerminator(src, range.end, str);
	  }

	}

	class Comment extends PlainValueEc8e588e.Node {
	  constructor() {
	    super(PlainValueEc8e588e.Type.COMMENT);
	  }
	  /**
	   * Parses a comment line from the source
	   *
	   * @param {ParseContext} context
	   * @param {number} start - Index of first character
	   * @returns {number} - Index of the character after this scalar
	   */


	  parse(context, start) {
	    this.context = context;
	    const offset = this.parseComment(start);
	    this.range = new PlainValueEc8e588e.Range(start, offset);
	    return offset;
	  }

	}

	function grabCollectionEndComments(node) {
	  let cnode = node;

	  while (cnode instanceof CollectionItem) cnode = cnode.node;

	  if (!(cnode instanceof Collection)) return null;
	  const len = cnode.items.length;
	  let ci = -1;

	  for (let i = len - 1; i >= 0; --i) {
	    const n = cnode.items[i];

	    if (n.type === PlainValueEc8e588e.Type.COMMENT) {
	      // Keep sufficiently indented comments with preceding node
	      const {
	        indent,
	        lineStart
	      } = n.context;
	      if (indent > 0 && n.range.start >= lineStart + indent) break;
	      ci = i;
	    } else if (n.type === PlainValueEc8e588e.Type.BLANK_LINE) ci = i;else break;
	  }

	  if (ci === -1) return null;
	  const ca = cnode.items.splice(ci, len - ci);
	  const prevEnd = ca[0].range.start;

	  while (true) {
	    cnode.range.end = prevEnd;
	    if (cnode.valueRange && cnode.valueRange.end > prevEnd) cnode.valueRange.end = prevEnd;
	    if (cnode === node) break;
	    cnode = cnode.context.parent;
	  }

	  return ca;
	}
	class Collection extends PlainValueEc8e588e.Node {
	  static nextContentHasIndent(src, offset, indent) {
	    const lineStart = PlainValueEc8e588e.Node.endOfLine(src, offset) + 1;
	    offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, lineStart);
	    const ch = src[offset];
	    if (!ch) return false;
	    if (offset >= lineStart + indent) return true;
	    if (ch !== '#' && ch !== '\n') return false;
	    return Collection.nextContentHasIndent(src, offset, indent);
	  }

	  constructor(firstItem) {
	    super(firstItem.type === PlainValueEc8e588e.Type.SEQ_ITEM ? PlainValueEc8e588e.Type.SEQ : PlainValueEc8e588e.Type.MAP);

	    for (let i = firstItem.props.length - 1; i >= 0; --i) {
	      if (firstItem.props[i].start < firstItem.context.lineStart) {
	        // props on previous line are assumed by the collection
	        this.props = firstItem.props.slice(0, i + 1);
	        firstItem.props = firstItem.props.slice(i + 1);
	        const itemRange = firstItem.props[0] || firstItem.valueRange;
	        firstItem.range.start = itemRange.start;
	        break;
	      }
	    }

	    this.items = [firstItem];
	    const ec = grabCollectionEndComments(firstItem);
	    if (ec) Array.prototype.push.apply(this.items, ec);
	  }

	  get includesTrailingLines() {
	    return this.items.length > 0;
	  }
	  /**
	   * @param {ParseContext} context
	   * @param {number} start - Index of first character
	   * @returns {number} - Index of the character after this
	   */


	  parse(context, start) {
	    this.context = context;
	    const {
	      parseNode,
	      src
	    } = context; // It's easier to recalculate lineStart here rather than tracking down the
	    // last context from which to read it -- eemeli/yaml#2

	    let lineStart = PlainValueEc8e588e.Node.startOfLine(src, start);
	    const firstItem = this.items[0]; // First-item context needs to be correct for later comment handling
	    // -- eemeli/yaml#17

	    firstItem.context.parent = this;
	    this.valueRange = PlainValueEc8e588e.Range.copy(firstItem.valueRange);
	    const indent = firstItem.range.start - firstItem.context.lineStart;
	    let offset = start;
	    offset = PlainValueEc8e588e.Node.normalizeOffset(src, offset);
	    let ch = src[offset];
	    let atLineStart = PlainValueEc8e588e.Node.endOfWhiteSpace(src, lineStart) === offset;
	    let prevIncludesTrailingLines = false;

	    while (ch) {
	      while (ch === '\n' || ch === '#') {
	        if (atLineStart && ch === '\n' && !prevIncludesTrailingLines) {
	          const blankLine = new BlankLine();
	          offset = blankLine.parse({
	            src
	          }, offset);
	          this.valueRange.end = offset;

	          if (offset >= src.length) {
	            ch = null;
	            break;
	          }

	          this.items.push(blankLine);
	          offset -= 1; // blankLine.parse() consumes terminal newline
	        } else if (ch === '#') {
	          if (offset < lineStart + indent && !Collection.nextContentHasIndent(src, offset, indent)) {
	            return offset;
	          }

	          const comment = new Comment();
	          offset = comment.parse({
	            indent,
	            lineStart,
	            src
	          }, offset);
	          this.items.push(comment);
	          this.valueRange.end = offset;

	          if (offset >= src.length) {
	            ch = null;
	            break;
	          }
	        }

	        lineStart = offset + 1;
	        offset = PlainValueEc8e588e.Node.endOfIndent(src, lineStart);

	        if (PlainValueEc8e588e.Node.atBlank(src, offset)) {
	          const wsEnd = PlainValueEc8e588e.Node.endOfWhiteSpace(src, offset);
	          const next = src[wsEnd];

	          if (!next || next === '\n' || next === '#') {
	            offset = wsEnd;
	          }
	        }

	        ch = src[offset];
	        atLineStart = true;
	      }

	      if (!ch) {
	        break;
	      }

	      if (offset !== lineStart + indent && (atLineStart || ch !== ':')) {
	        if (offset < lineStart + indent) {
	          if (lineStart > start) offset = lineStart;
	          break;
	        } else if (!this.error) {
	          const msg = 'All collection items must start at the same column';
	          this.error = new PlainValueEc8e588e.YAMLSyntaxError(this, msg);
	        }
	      }

	      if (firstItem.type === PlainValueEc8e588e.Type.SEQ_ITEM) {
	        if (ch !== '-') {
	          if (lineStart > start) offset = lineStart;
	          break;
	        }
	      } else if (ch === '-' && !this.error) {
	        // map key may start with -, as long as it's followed by a non-whitespace char
	        const next = src[offset + 1];

	        if (!next || next === '\n' || next === '\t' || next === ' ') {
	          const msg = 'A collection cannot be both a mapping and a sequence';
	          this.error = new PlainValueEc8e588e.YAMLSyntaxError(this, msg);
	        }
	      }

	      const node = parseNode({
	        atLineStart,
	        inCollection: true,
	        indent,
	        lineStart,
	        parent: this
	      }, offset);
	      if (!node) return offset; // at next document start

	      this.items.push(node);
	      this.valueRange.end = node.valueRange.end;
	      offset = PlainValueEc8e588e.Node.normalizeOffset(src, node.range.end);
	      ch = src[offset];
	      atLineStart = false;
	      prevIncludesTrailingLines = node.includesTrailingLines; // Need to reset lineStart and atLineStart here if preceding node's range
	      // has advanced to check the current line's indentation level
	      // -- eemeli/yaml#10 & eemeli/yaml#38

	      if (ch) {
	        let ls = offset - 1;
	        let prev = src[ls];

	        while (prev === ' ' || prev === '\t') prev = src[--ls];

	        if (prev === '\n') {
	          lineStart = ls + 1;
	          atLineStart = true;
	        }
	      }

	      const ec = grabCollectionEndComments(node);
	      if (ec) Array.prototype.push.apply(this.items, ec);
	    }

	    return offset;
	  }

	  setOrigRanges(cr, offset) {
	    offset = super.setOrigRanges(cr, offset);
	    this.items.forEach(node => {
	      offset = node.setOrigRanges(cr, offset);
	    });
	    return offset;
	  }

	  toString() {
	    const {
	      context: {
	        src
	      },
	      items,
	      range,
	      value
	    } = this;
	    if (value != null) return value;
	    let str = src.slice(range.start, items[0].range.start) + String(items[0]);

	    for (let i = 1; i < items.length; ++i) {
	      const item = items[i];
	      const {
	        atLineStart,
	        indent
	      } = item.context;
	      if (atLineStart) for (let i = 0; i < indent; ++i) str += ' ';
	      str += String(item);
	    }

	    return PlainValueEc8e588e.Node.addStringTerminator(src, range.end, str);
	  }

	}

	class Directive extends PlainValueEc8e588e.Node {
	  constructor() {
	    super(PlainValueEc8e588e.Type.DIRECTIVE);
	    this.name = null;
	  }

	  get parameters() {
	    const raw = this.rawValue;
	    return raw ? raw.trim().split(/[ \t]+/) : [];
	  }

	  parseName(start) {
	    const {
	      src
	    } = this.context;
	    let offset = start;
	    let ch = src[offset];

	    while (ch && ch !== '\n' && ch !== '\t' && ch !== ' ') ch = src[offset += 1];

	    this.name = src.slice(start, offset);
	    return offset;
	  }

	  parseParameters(start) {
	    const {
	      src
	    } = this.context;
	    let offset = start;
	    let ch = src[offset];

	    while (ch && ch !== '\n' && ch !== '#') ch = src[offset += 1];

	    this.valueRange = new PlainValueEc8e588e.Range(start, offset);
	    return offset;
	  }

	  parse(context, start) {
	    this.context = context;
	    let offset = this.parseName(start + 1);
	    offset = this.parseParameters(offset);
	    offset = this.parseComment(offset);
	    this.range = new PlainValueEc8e588e.Range(start, offset);
	    return offset;
	  }

	}

	class Document extends PlainValueEc8e588e.Node {
	  static startCommentOrEndBlankLine(src, start) {
	    const offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, start);
	    const ch = src[offset];
	    return ch === '#' || ch === '\n' ? offset : start;
	  }

	  constructor() {
	    super(PlainValueEc8e588e.Type.DOCUMENT);
	    this.directives = null;
	    this.contents = null;
	    this.directivesEndMarker = null;
	    this.documentEndMarker = null;
	  }

	  parseDirectives(start) {
	    const {
	      src
	    } = this.context;
	    this.directives = [];
	    let atLineStart = true;
	    let hasDirectives = false;
	    let offset = start;

	    while (!PlainValueEc8e588e.Node.atDocumentBoundary(src, offset, PlainValueEc8e588e.Char.DIRECTIVES_END)) {
	      offset = Document.startCommentOrEndBlankLine(src, offset);

	      switch (src[offset]) {
	        case '\n':
	          if (atLineStart) {
	            const blankLine = new BlankLine();
	            offset = blankLine.parse({
	              src
	            }, offset);

	            if (offset < src.length) {
	              this.directives.push(blankLine);
	            }
	          } else {
	            offset += 1;
	            atLineStart = true;
	          }

	          break;

	        case '#':
	          {
	            const comment = new Comment();
	            offset = comment.parse({
	              src
	            }, offset);
	            this.directives.push(comment);
	            atLineStart = false;
	          }
	          break;

	        case '%':
	          {
	            const directive = new Directive();
	            offset = directive.parse({
	              parent: this,
	              src
	            }, offset);
	            this.directives.push(directive);
	            hasDirectives = true;
	            atLineStart = false;
	          }
	          break;

	        default:
	          if (hasDirectives) {
	            this.error = new PlainValueEc8e588e.YAMLSemanticError(this, 'Missing directives-end indicator line');
	          } else if (this.directives.length > 0) {
	            this.contents = this.directives;
	            this.directives = [];
	          }

	          return offset;
	      }
	    }

	    if (src[offset]) {
	      this.directivesEndMarker = new PlainValueEc8e588e.Range(offset, offset + 3);
	      return offset + 3;
	    }

	    if (hasDirectives) {
	      this.error = new PlainValueEc8e588e.YAMLSemanticError(this, 'Missing directives-end indicator line');
	    } else if (this.directives.length > 0) {
	      this.contents = this.directives;
	      this.directives = [];
	    }

	    return offset;
	  }

	  parseContents(start) {
	    const {
	      parseNode,
	      src
	    } = this.context;
	    if (!this.contents) this.contents = [];
	    let lineStart = start;

	    while (src[lineStart - 1] === '-') lineStart -= 1;

	    let offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, start);
	    let atLineStart = lineStart === start;
	    this.valueRange = new PlainValueEc8e588e.Range(offset);

	    while (!PlainValueEc8e588e.Node.atDocumentBoundary(src, offset, PlainValueEc8e588e.Char.DOCUMENT_END)) {
	      switch (src[offset]) {
	        case '\n':
	          if (atLineStart) {
	            const blankLine = new BlankLine();
	            offset = blankLine.parse({
	              src
	            }, offset);

	            if (offset < src.length) {
	              this.contents.push(blankLine);
	            }
	          } else {
	            offset += 1;
	            atLineStart = true;
	          }

	          lineStart = offset;
	          break;

	        case '#':
	          {
	            const comment = new Comment();
	            offset = comment.parse({
	              src
	            }, offset);
	            this.contents.push(comment);
	            atLineStart = false;
	          }
	          break;

	        default:
	          {
	            const iEnd = PlainValueEc8e588e.Node.endOfIndent(src, offset);
	            const context = {
	              atLineStart,
	              indent: -1,
	              inFlow: false,
	              inCollection: false,
	              lineStart,
	              parent: this
	            };
	            const node = parseNode(context, iEnd);
	            if (!node) return this.valueRange.end = iEnd; // at next document start

	            this.contents.push(node);
	            offset = node.range.end;
	            atLineStart = false;
	            const ec = grabCollectionEndComments(node);
	            if (ec) Array.prototype.push.apply(this.contents, ec);
	          }
	      }

	      offset = Document.startCommentOrEndBlankLine(src, offset);
	    }

	    this.valueRange.end = offset;

	    if (src[offset]) {
	      this.documentEndMarker = new PlainValueEc8e588e.Range(offset, offset + 3);
	      offset += 3;

	      if (src[offset]) {
	        offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, offset);

	        if (src[offset] === '#') {
	          const comment = new Comment();
	          offset = comment.parse({
	            src
	          }, offset);
	          this.contents.push(comment);
	        }

	        switch (src[offset]) {
	          case '\n':
	            offset += 1;
	            break;

	          case undefined:
	            break;

	          default:
	            this.error = new PlainValueEc8e588e.YAMLSyntaxError(this, 'Document end marker line cannot have a non-comment suffix');
	        }
	      }
	    }

	    return offset;
	  }
	  /**
	   * @param {ParseContext} context
	   * @param {number} start - Index of first character
	   * @returns {number} - Index of the character after this
	   */


	  parse(context, start) {
	    context.root = this;
	    this.context = context;
	    const {
	      src
	    } = context;
	    let offset = src.charCodeAt(start) === 0xfeff ? start + 1 : start; // skip BOM

	    offset = this.parseDirectives(offset);
	    offset = this.parseContents(offset);
	    return offset;
	  }

	  setOrigRanges(cr, offset) {
	    offset = super.setOrigRanges(cr, offset);
	    this.directives.forEach(node => {
	      offset = node.setOrigRanges(cr, offset);
	    });
	    if (this.directivesEndMarker) offset = this.directivesEndMarker.setOrigRange(cr, offset);
	    this.contents.forEach(node => {
	      offset = node.setOrigRanges(cr, offset);
	    });
	    if (this.documentEndMarker) offset = this.documentEndMarker.setOrigRange(cr, offset);
	    return offset;
	  }

	  toString() {
	    const {
	      contents,
	      directives,
	      value
	    } = this;
	    if (value != null) return value;
	    let str = directives.join('');

	    if (contents.length > 0) {
	      if (directives.length > 0 || contents[0].type === PlainValueEc8e588e.Type.COMMENT) str += '---\n';
	      str += contents.join('');
	    }

	    if (str[str.length - 1] !== '\n') str += '\n';
	    return str;
	  }

	}

	class Alias extends PlainValueEc8e588e.Node {
	  /**
	   * Parses an *alias from the source
	   *
	   * @param {ParseContext} context
	   * @param {number} start - Index of first character
	   * @returns {number} - Index of the character after this scalar
	   */
	  parse(context, start) {
	    this.context = context;
	    const {
	      src
	    } = context;
	    let offset = PlainValueEc8e588e.Node.endOfIdentifier(src, start + 1);
	    this.valueRange = new PlainValueEc8e588e.Range(start + 1, offset);
	    offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, offset);
	    offset = this.parseComment(offset);
	    return offset;
	  }

	}

	const Chomp = {
	  CLIP: 'CLIP',
	  KEEP: 'KEEP',
	  STRIP: 'STRIP'
	};
	class BlockValue extends PlainValueEc8e588e.Node {
	  constructor(type, props) {
	    super(type, props);
	    this.blockIndent = null;
	    this.chomping = Chomp.CLIP;
	    this.header = null;
	  }

	  get includesTrailingLines() {
	    return this.chomping === Chomp.KEEP;
	  }

	  get strValue() {
	    if (!this.valueRange || !this.context) return null;
	    let {
	      start,
	      end
	    } = this.valueRange;
	    const {
	      indent,
	      src
	    } = this.context;
	    if (this.valueRange.isEmpty()) return '';
	    let lastNewLine = null;
	    let ch = src[end - 1];

	    while (ch === '\n' || ch === '\t' || ch === ' ') {
	      end -= 1;

	      if (end <= start) {
	        if (this.chomping === Chomp.KEEP) break;else return ''; // probably never happens
	      }

	      if (ch === '\n') lastNewLine = end;
	      ch = src[end - 1];
	    }

	    let keepStart = end + 1;

	    if (lastNewLine) {
	      if (this.chomping === Chomp.KEEP) {
	        keepStart = lastNewLine;
	        end = this.valueRange.end;
	      } else {
	        end = lastNewLine;
	      }
	    }

	    const bi = indent + this.blockIndent;
	    const folded = this.type === PlainValueEc8e588e.Type.BLOCK_FOLDED;
	    let atStart = true;
	    let str = '';
	    let sep = '';
	    let prevMoreIndented = false;

	    for (let i = start; i < end; ++i) {
	      for (let j = 0; j < bi; ++j) {
	        if (src[i] !== ' ') break;
	        i += 1;
	      }

	      const ch = src[i];

	      if (ch === '\n') {
	        if (sep === '\n') str += '\n';else sep = '\n';
	      } else {
	        const lineEnd = PlainValueEc8e588e.Node.endOfLine(src, i);
	        const line = src.slice(i, lineEnd);
	        i = lineEnd;

	        if (folded && (ch === ' ' || ch === '\t') && i < keepStart) {
	          if (sep === ' ') sep = '\n';else if (!prevMoreIndented && !atStart && sep === '\n') sep = '\n\n';
	          str += sep + line; //+ ((lineEnd < end && src[lineEnd]) || '')

	          sep = lineEnd < end && src[lineEnd] || '';
	          prevMoreIndented = true;
	        } else {
	          str += sep + line;
	          sep = folded && i < keepStart ? ' ' : '\n';
	          prevMoreIndented = false;
	        }

	        if (atStart && line !== '') atStart = false;
	      }
	    }

	    return this.chomping === Chomp.STRIP ? str : str + '\n';
	  }

	  parseBlockHeader(start) {
	    const {
	      src
	    } = this.context;
	    let offset = start + 1;
	    let bi = '';

	    while (true) {
	      const ch = src[offset];

	      switch (ch) {
	        case '-':
	          this.chomping = Chomp.STRIP;
	          break;

	        case '+':
	          this.chomping = Chomp.KEEP;
	          break;

	        case '0':
	        case '1':
	        case '2':
	        case '3':
	        case '4':
	        case '5':
	        case '6':
	        case '7':
	        case '8':
	        case '9':
	          bi += ch;
	          break;

	        default:
	          this.blockIndent = Number(bi) || null;
	          this.header = new PlainValueEc8e588e.Range(start, offset);
	          return offset;
	      }

	      offset += 1;
	    }
	  }

	  parseBlockValue(start) {
	    const {
	      indent,
	      src
	    } = this.context;
	    const explicit = !!this.blockIndent;
	    let offset = start;
	    let valueEnd = start;
	    let minBlockIndent = 1;

	    for (let ch = src[offset]; ch === '\n'; ch = src[offset]) {
	      offset += 1;
	      if (PlainValueEc8e588e.Node.atDocumentBoundary(src, offset)) break;
	      const end = PlainValueEc8e588e.Node.endOfBlockIndent(src, indent, offset); // should not include tab?

	      if (end === null) break;
	      const ch = src[end];
	      const lineIndent = end - (offset + indent);

	      if (!this.blockIndent) {
	        // no explicit block indent, none yet detected
	        if (src[end] !== '\n') {
	          // first line with non-whitespace content
	          if (lineIndent < minBlockIndent) {
	            const msg = 'Block scalars with more-indented leading empty lines must use an explicit indentation indicator';
	            this.error = new PlainValueEc8e588e.YAMLSemanticError(this, msg);
	          }

	          this.blockIndent = lineIndent;
	        } else if (lineIndent > minBlockIndent) {
	          // empty line with more whitespace
	          minBlockIndent = lineIndent;
	        }
	      } else if (ch && ch !== '\n' && lineIndent < this.blockIndent) {
	        if (src[end] === '#') break;

	        if (!this.error) {
	          const src = explicit ? 'explicit indentation indicator' : 'first line';
	          const msg = `Block scalars must not be less indented than their ${src}`;
	          this.error = new PlainValueEc8e588e.YAMLSemanticError(this, msg);
	        }
	      }

	      if (src[end] === '\n') {
	        offset = end;
	      } else {
	        offset = valueEnd = PlainValueEc8e588e.Node.endOfLine(src, end);
	      }
	    }

	    if (this.chomping !== Chomp.KEEP) {
	      offset = src[valueEnd] ? valueEnd + 1 : valueEnd;
	    }

	    this.valueRange = new PlainValueEc8e588e.Range(start + 1, offset);
	    return offset;
	  }
	  /**
	   * Parses a block value from the source
	   *
	   * Accepted forms are:
	   * ```
	   * BS
	   * block
	   * lines
	   *
	   * BS #comment
	   * block
	   * lines
	   * ```
	   * where the block style BS matches the regexp `[|>][-+1-9]*` and block lines
	   * are empty or have an indent level greater than `indent`.
	   *
	   * @param {ParseContext} context
	   * @param {number} start - Index of first character
	   * @returns {number} - Index of the character after this block
	   */


	  parse(context, start) {
	    this.context = context;
	    const {
	      src
	    } = context;
	    let offset = this.parseBlockHeader(start);
	    offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, offset);
	    offset = this.parseComment(offset);
	    offset = this.parseBlockValue(offset);
	    return offset;
	  }

	  setOrigRanges(cr, offset) {
	    offset = super.setOrigRanges(cr, offset);
	    return this.header ? this.header.setOrigRange(cr, offset) : offset;
	  }

	}

	class FlowCollection extends PlainValueEc8e588e.Node {
	  constructor(type, props) {
	    super(type, props);
	    this.items = null;
	  }

	  prevNodeIsJsonLike(idx = this.items.length) {
	    const node = this.items[idx - 1];
	    return !!node && (node.jsonLike || node.type === PlainValueEc8e588e.Type.COMMENT && this.prevNodeIsJsonLike(idx - 1));
	  }
	  /**
	   * @param {ParseContext} context
	   * @param {number} start - Index of first character
	   * @returns {number} - Index of the character after this
	   */


	  parse(context, start) {
	    this.context = context;
	    const {
	      parseNode,
	      src
	    } = context;
	    let {
	      indent,
	      lineStart
	    } = context;
	    let char = src[start]; // { or [

	    this.items = [{
	      char,
	      offset: start
	    }];
	    let offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, start + 1);
	    char = src[offset];

	    while (char && char !== ']' && char !== '}') {
	      switch (char) {
	        case '\n':
	          {
	            lineStart = offset + 1;
	            const wsEnd = PlainValueEc8e588e.Node.endOfWhiteSpace(src, lineStart);

	            if (src[wsEnd] === '\n') {
	              const blankLine = new BlankLine();
	              lineStart = blankLine.parse({
	                src
	              }, lineStart);
	              this.items.push(blankLine);
	            }

	            offset = PlainValueEc8e588e.Node.endOfIndent(src, lineStart);

	            if (offset <= lineStart + indent) {
	              char = src[offset];

	              if (offset < lineStart + indent || char !== ']' && char !== '}') {
	                const msg = 'Insufficient indentation in flow collection';
	                this.error = new PlainValueEc8e588e.YAMLSemanticError(this, msg);
	              }
	            }
	          }
	          break;

	        case ',':
	          {
	            this.items.push({
	              char,
	              offset
	            });
	            offset += 1;
	          }
	          break;

	        case '#':
	          {
	            const comment = new Comment();
	            offset = comment.parse({
	              src
	            }, offset);
	            this.items.push(comment);
	          }
	          break;

	        case '?':
	        case ':':
	          {
	            const next = src[offset + 1];

	            if (next === '\n' || next === '\t' || next === ' ' || next === ',' || // in-flow : after JSON-like key does not need to be followed by whitespace
	            char === ':' && this.prevNodeIsJsonLike()) {
	              this.items.push({
	                char,
	                offset
	              });
	              offset += 1;
	              break;
	            }
	          }
	        // fallthrough

	        default:
	          {
	            const node = parseNode({
	              atLineStart: false,
	              inCollection: false,
	              inFlow: true,
	              indent: -1,
	              lineStart,
	              parent: this
	            }, offset);

	            if (!node) {
	              // at next document start
	              this.valueRange = new PlainValueEc8e588e.Range(start, offset);
	              return offset;
	            }

	            this.items.push(node);
	            offset = PlainValueEc8e588e.Node.normalizeOffset(src, node.range.end);
	          }
	      }

	      offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, offset);
	      char = src[offset];
	    }

	    this.valueRange = new PlainValueEc8e588e.Range(start, offset + 1);

	    if (char) {
	      this.items.push({
	        char,
	        offset
	      });
	      offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, offset + 1);
	      offset = this.parseComment(offset);
	    }

	    return offset;
	  }

	  setOrigRanges(cr, offset) {
	    offset = super.setOrigRanges(cr, offset);
	    this.items.forEach(node => {
	      if (node instanceof PlainValueEc8e588e.Node) {
	        offset = node.setOrigRanges(cr, offset);
	      } else if (cr.length === 0) {
	        node.origOffset = node.offset;
	      } else {
	        let i = offset;

	        while (i < cr.length) {
	          if (cr[i] > node.offset) break;else ++i;
	        }

	        node.origOffset = node.offset + i;
	        offset = i;
	      }
	    });
	    return offset;
	  }

	  toString() {
	    const {
	      context: {
	        src
	      },
	      items,
	      range,
	      value
	    } = this;
	    if (value != null) return value;
	    const nodes = items.filter(item => item instanceof PlainValueEc8e588e.Node);
	    let str = '';
	    let prevEnd = range.start;
	    nodes.forEach(node => {
	      const prefix = src.slice(prevEnd, node.range.start);
	      prevEnd = node.range.end;
	      str += prefix + String(node);

	      if (str[str.length - 1] === '\n' && src[prevEnd - 1] !== '\n' && src[prevEnd] === '\n') {
	        // Comment range does not include the terminal newline, but its
	        // stringified value does. Without this fix, newlines at comment ends
	        // get duplicated.
	        prevEnd += 1;
	      }
	    });
	    str += src.slice(prevEnd, range.end);
	    return PlainValueEc8e588e.Node.addStringTerminator(src, range.end, str);
	  }

	}

	class QuoteDouble extends PlainValueEc8e588e.Node {
	  static endOfQuote(src, offset) {
	    let ch = src[offset];

	    while (ch && ch !== '"') {
	      offset += ch === '\\' ? 2 : 1;
	      ch = src[offset];
	    }

	    return offset + 1;
	  }
	  /**
	   * @returns {string | { str: string, errors: YAMLSyntaxError[] }}
	   */


	  get strValue() {
	    if (!this.valueRange || !this.context) return null;
	    const errors = [];
	    const {
	      start,
	      end
	    } = this.valueRange;
	    const {
	      indent,
	      src
	    } = this.context;
	    if (src[end - 1] !== '"') errors.push(new PlainValueEc8e588e.YAMLSyntaxError(this, 'Missing closing "quote')); // Using String#replace is too painful with escaped newlines preceded by
	    // escaped backslashes; also, this should be faster.

	    let str = '';

	    for (let i = start + 1; i < end - 1; ++i) {
	      const ch = src[i];

	      if (ch === '\n') {
	        if (PlainValueEc8e588e.Node.atDocumentBoundary(src, i + 1)) errors.push(new PlainValueEc8e588e.YAMLSemanticError(this, 'Document boundary indicators are not allowed within string values'));
	        const {
	          fold,
	          offset,
	          error
	        } = PlainValueEc8e588e.Node.foldNewline(src, i, indent);
	        str += fold;
	        i = offset;
	        if (error) errors.push(new PlainValueEc8e588e.YAMLSemanticError(this, 'Multi-line double-quoted string needs to be sufficiently indented'));
	      } else if (ch === '\\') {
	        i += 1;

	        switch (src[i]) {
	          case '0':
	            str += '\0';
	            break;
	          // null character

	          case 'a':
	            str += '\x07';
	            break;
	          // bell character

	          case 'b':
	            str += '\b';
	            break;
	          // backspace

	          case 'e':
	            str += '\x1b';
	            break;
	          // escape character

	          case 'f':
	            str += '\f';
	            break;
	          // form feed

	          case 'n':
	            str += '\n';
	            break;
	          // line feed

	          case 'r':
	            str += '\r';
	            break;
	          // carriage return

	          case 't':
	            str += '\t';
	            break;
	          // horizontal tab

	          case 'v':
	            str += '\v';
	            break;
	          // vertical tab

	          case 'N':
	            str += '\u0085';
	            break;
	          // Unicode next line

	          case '_':
	            str += '\u00a0';
	            break;
	          // Unicode non-breaking space

	          case 'L':
	            str += '\u2028';
	            break;
	          // Unicode line separator

	          case 'P':
	            str += '\u2029';
	            break;
	          // Unicode paragraph separator

	          case ' ':
	            str += ' ';
	            break;

	          case '"':
	            str += '"';
	            break;

	          case '/':
	            str += '/';
	            break;

	          case '\\':
	            str += '\\';
	            break;

	          case '\t':
	            str += '\t';
	            break;

	          case 'x':
	            str += this.parseCharCode(i + 1, 2, errors);
	            i += 2;
	            break;

	          case 'u':
	            str += this.parseCharCode(i + 1, 4, errors);
	            i += 4;
	            break;

	          case 'U':
	            str += this.parseCharCode(i + 1, 8, errors);
	            i += 8;
	            break;

	          case '\n':
	            // skip escaped newlines, but still trim the following line
	            while (src[i + 1] === ' ' || src[i + 1] === '\t') i += 1;

	            break;

	          default:
	            errors.push(new PlainValueEc8e588e.YAMLSyntaxError(this, `Invalid escape sequence ${src.substr(i - 1, 2)}`));
	            str += '\\' + src[i];
	        }
	      } else if (ch === ' ' || ch === '\t') {
	        // trim trailing whitespace
	        const wsStart = i;
	        let next = src[i + 1];

	        while (next === ' ' || next === '\t') {
	          i += 1;
	          next = src[i + 1];
	        }

	        if (next !== '\n') str += i > wsStart ? src.slice(wsStart, i + 1) : ch;
	      } else {
	        str += ch;
	      }
	    }

	    return errors.length > 0 ? {
	      errors,
	      str
	    } : str;
	  }

	  parseCharCode(offset, length, errors) {
	    const {
	      src
	    } = this.context;
	    const cc = src.substr(offset, length);
	    const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
	    const code = ok ? parseInt(cc, 16) : NaN;

	    if (isNaN(code)) {
	      errors.push(new PlainValueEc8e588e.YAMLSyntaxError(this, `Invalid escape sequence ${src.substr(offset - 2, length + 2)}`));
	      return src.substr(offset - 2, length + 2);
	    }

	    return String.fromCodePoint(code);
	  }
	  /**
	   * Parses a "double quoted" value from the source
	   *
	   * @param {ParseContext} context
	   * @param {number} start - Index of first character
	   * @returns {number} - Index of the character after this scalar
	   */


	  parse(context, start) {
	    this.context = context;
	    const {
	      src
	    } = context;
	    let offset = QuoteDouble.endOfQuote(src, start + 1);
	    this.valueRange = new PlainValueEc8e588e.Range(start, offset);
	    offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, offset);
	    offset = this.parseComment(offset);
	    return offset;
	  }

	}

	class QuoteSingle extends PlainValueEc8e588e.Node {
	  static endOfQuote(src, offset) {
	    let ch = src[offset];

	    while (ch) {
	      if (ch === "'") {
	        if (src[offset + 1] !== "'") break;
	        ch = src[offset += 2];
	      } else {
	        ch = src[offset += 1];
	      }
	    }

	    return offset + 1;
	  }
	  /**
	   * @returns {string | { str: string, errors: YAMLSyntaxError[] }}
	   */


	  get strValue() {
	    if (!this.valueRange || !this.context) return null;
	    const errors = [];
	    const {
	      start,
	      end
	    } = this.valueRange;
	    const {
	      indent,
	      src
	    } = this.context;
	    if (src[end - 1] !== "'") errors.push(new PlainValueEc8e588e.YAMLSyntaxError(this, "Missing closing 'quote"));
	    let str = '';

	    for (let i = start + 1; i < end - 1; ++i) {
	      const ch = src[i];

	      if (ch === '\n') {
	        if (PlainValueEc8e588e.Node.atDocumentBoundary(src, i + 1)) errors.push(new PlainValueEc8e588e.YAMLSemanticError(this, 'Document boundary indicators are not allowed within string values'));
	        const {
	          fold,
	          offset,
	          error
	        } = PlainValueEc8e588e.Node.foldNewline(src, i, indent);
	        str += fold;
	        i = offset;
	        if (error) errors.push(new PlainValueEc8e588e.YAMLSemanticError(this, 'Multi-line single-quoted string needs to be sufficiently indented'));
	      } else if (ch === "'") {
	        str += ch;
	        i += 1;
	        if (src[i] !== "'") errors.push(new PlainValueEc8e588e.YAMLSyntaxError(this, 'Unescaped single quote? This should not happen.'));
	      } else if (ch === ' ' || ch === '\t') {
	        // trim trailing whitespace
	        const wsStart = i;
	        let next = src[i + 1];

	        while (next === ' ' || next === '\t') {
	          i += 1;
	          next = src[i + 1];
	        }

	        if (next !== '\n') str += i > wsStart ? src.slice(wsStart, i + 1) : ch;
	      } else {
	        str += ch;
	      }
	    }

	    return errors.length > 0 ? {
	      errors,
	      str
	    } : str;
	  }
	  /**
	   * Parses a 'single quoted' value from the source
	   *
	   * @param {ParseContext} context
	   * @param {number} start - Index of first character
	   * @returns {number} - Index of the character after this scalar
	   */


	  parse(context, start) {
	    this.context = context;
	    const {
	      src
	    } = context;
	    let offset = QuoteSingle.endOfQuote(src, start + 1);
	    this.valueRange = new PlainValueEc8e588e.Range(start, offset);
	    offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, offset);
	    offset = this.parseComment(offset);
	    return offset;
	  }

	}

	function createNewNode(type, props) {
	  switch (type) {
	    case PlainValueEc8e588e.Type.ALIAS:
	      return new Alias(type, props);

	    case PlainValueEc8e588e.Type.BLOCK_FOLDED:
	    case PlainValueEc8e588e.Type.BLOCK_LITERAL:
	      return new BlockValue(type, props);

	    case PlainValueEc8e588e.Type.FLOW_MAP:
	    case PlainValueEc8e588e.Type.FLOW_SEQ:
	      return new FlowCollection(type, props);

	    case PlainValueEc8e588e.Type.MAP_KEY:
	    case PlainValueEc8e588e.Type.MAP_VALUE:
	    case PlainValueEc8e588e.Type.SEQ_ITEM:
	      return new CollectionItem(type, props);

	    case PlainValueEc8e588e.Type.COMMENT:
	    case PlainValueEc8e588e.Type.PLAIN:
	      return new PlainValueEc8e588e.PlainValue(type, props);

	    case PlainValueEc8e588e.Type.QUOTE_DOUBLE:
	      return new QuoteDouble(type, props);

	    case PlainValueEc8e588e.Type.QUOTE_SINGLE:
	      return new QuoteSingle(type, props);

	    /* istanbul ignore next */

	    default:
	      return null;
	    // should never happen
	  }
	}
	/**
	 * @param {boolean} atLineStart - Node starts at beginning of line
	 * @param {boolean} inFlow - true if currently in a flow context
	 * @param {boolean} inCollection - true if currently in a collection context
	 * @param {number} indent - Current level of indentation
	 * @param {number} lineStart - Start of the current line
	 * @param {Node} parent - The parent of the node
	 * @param {string} src - Source of the YAML document
	 */


	class ParseContext {
	  static parseType(src, offset, inFlow) {
	    switch (src[offset]) {
	      case '*':
	        return PlainValueEc8e588e.Type.ALIAS;

	      case '>':
	        return PlainValueEc8e588e.Type.BLOCK_FOLDED;

	      case '|':
	        return PlainValueEc8e588e.Type.BLOCK_LITERAL;

	      case '{':
	        return PlainValueEc8e588e.Type.FLOW_MAP;

	      case '[':
	        return PlainValueEc8e588e.Type.FLOW_SEQ;

	      case '?':
	        return !inFlow && PlainValueEc8e588e.Node.atBlank(src, offset + 1, true) ? PlainValueEc8e588e.Type.MAP_KEY : PlainValueEc8e588e.Type.PLAIN;

	      case ':':
	        return !inFlow && PlainValueEc8e588e.Node.atBlank(src, offset + 1, true) ? PlainValueEc8e588e.Type.MAP_VALUE : PlainValueEc8e588e.Type.PLAIN;

	      case '-':
	        return !inFlow && PlainValueEc8e588e.Node.atBlank(src, offset + 1, true) ? PlainValueEc8e588e.Type.SEQ_ITEM : PlainValueEc8e588e.Type.PLAIN;

	      case '"':
	        return PlainValueEc8e588e.Type.QUOTE_DOUBLE;

	      case "'":
	        return PlainValueEc8e588e.Type.QUOTE_SINGLE;

	      default:
	        return PlainValueEc8e588e.Type.PLAIN;
	    }
	  }

	  constructor(orig = {}, {
	    atLineStart,
	    inCollection,
	    inFlow,
	    indent,
	    lineStart,
	    parent
	  } = {}) {
	    PlainValueEc8e588e._defineProperty(this, "parseNode", (overlay, start) => {
	      if (PlainValueEc8e588e.Node.atDocumentBoundary(this.src, start)) return null;
	      const context = new ParseContext(this, overlay);
	      const {
	        props,
	        type,
	        valueStart
	      } = context.parseProps(start);
	      const node = createNewNode(type, props);
	      let offset = node.parse(context, valueStart);
	      node.range = new PlainValueEc8e588e.Range(start, offset);
	      /* istanbul ignore if */

	      if (offset <= start) {
	        // This should never happen, but if it does, let's make sure to at least
	        // step one character forward to avoid a busy loop.
	        node.error = new Error(`Node#parse consumed no characters`);
	        node.error.parseEnd = offset;
	        node.error.source = node;
	        node.range.end = start + 1;
	      }

	      if (context.nodeStartsCollection(node)) {
	        if (!node.error && !context.atLineStart && context.parent.type === PlainValueEc8e588e.Type.DOCUMENT) {
	          node.error = new PlainValueEc8e588e.YAMLSyntaxError(node, 'Block collection must not have preceding content here (e.g. directives-end indicator)');
	        }

	        const collection = new Collection(node);
	        offset = collection.parse(new ParseContext(context), offset);
	        collection.range = new PlainValueEc8e588e.Range(start, offset);
	        return collection;
	      }

	      return node;
	    });

	    this.atLineStart = atLineStart != null ? atLineStart : orig.atLineStart || false;
	    this.inCollection = inCollection != null ? inCollection : orig.inCollection || false;
	    this.inFlow = inFlow != null ? inFlow : orig.inFlow || false;
	    this.indent = indent != null ? indent : orig.indent;
	    this.lineStart = lineStart != null ? lineStart : orig.lineStart;
	    this.parent = parent != null ? parent : orig.parent || {};
	    this.root = orig.root;
	    this.src = orig.src;
	  }

	  nodeStartsCollection(node) {
	    const {
	      inCollection,
	      inFlow,
	      src
	    } = this;
	    if (inCollection || inFlow) return false;
	    if (node instanceof CollectionItem) return true; // check for implicit key

	    let offset = node.range.end;
	    if (src[offset] === '\n' || src[offset - 1] === '\n') return false;
	    offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, offset);
	    return src[offset] === ':';
	  } // Anchor and tag are before type, which determines the node implementation
	  // class; hence this intermediate step.


	  parseProps(offset) {
	    const {
	      inFlow,
	      parent,
	      src
	    } = this;
	    const props = [];
	    let lineHasProps = false;
	    offset = this.atLineStart ? PlainValueEc8e588e.Node.endOfIndent(src, offset) : PlainValueEc8e588e.Node.endOfWhiteSpace(src, offset);
	    let ch = src[offset];

	    while (ch === PlainValueEc8e588e.Char.ANCHOR || ch === PlainValueEc8e588e.Char.COMMENT || ch === PlainValueEc8e588e.Char.TAG || ch === '\n') {
	      if (ch === '\n') {
	        const lineStart = offset + 1;
	        const inEnd = PlainValueEc8e588e.Node.endOfIndent(src, lineStart);
	        const indentDiff = inEnd - (lineStart + this.indent);
	        const noIndicatorAsIndent = parent.type === PlainValueEc8e588e.Type.SEQ_ITEM && parent.context.atLineStart;
	        if (!PlainValueEc8e588e.Node.nextNodeIsIndented(src[inEnd], indentDiff, !noIndicatorAsIndent)) break;
	        this.atLineStart = true;
	        this.lineStart = lineStart;
	        lineHasProps = false;
	        offset = inEnd;
	      } else if (ch === PlainValueEc8e588e.Char.COMMENT) {
	        const end = PlainValueEc8e588e.Node.endOfLine(src, offset + 1);
	        props.push(new PlainValueEc8e588e.Range(offset, end));
	        offset = end;
	      } else {
	        let end = PlainValueEc8e588e.Node.endOfIdentifier(src, offset + 1);

	        if (ch === PlainValueEc8e588e.Char.TAG && src[end] === ',' && /^[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+,\d\d\d\d(-\d\d){0,2}\/\S/.test(src.slice(offset + 1, end + 13))) {
	          // Let's presume we're dealing with a YAML 1.0 domain tag here, rather
	          // than an empty but 'foo.bar' private-tagged node in a flow collection
	          // followed without whitespace by a plain string starting with a year
	          // or date divided by something.
	          end = PlainValueEc8e588e.Node.endOfIdentifier(src, end + 5);
	        }

	        props.push(new PlainValueEc8e588e.Range(offset, end));
	        lineHasProps = true;
	        offset = PlainValueEc8e588e.Node.endOfWhiteSpace(src, end);
	      }

	      ch = src[offset];
	    } // '- &a : b' has an anchor on an empty node


	    if (lineHasProps && ch === ':' && PlainValueEc8e588e.Node.atBlank(src, offset + 1, true)) offset -= 1;
	    const type = ParseContext.parseType(src, offset, inFlow);
	    return {
	      props,
	      type,
	      valueStart: offset
	    };
	  }
	  /**
	   * Parses a node from the source
	   * @param {ParseContext} overlay
	   * @param {number} start - Index of first non-whitespace character for the node
	   * @returns {?Node} - null if at a document boundary
	   */


	}

	// Published as 'yaml/parse-cst'
	function parse(src) {
	  const cr = [];

	  if (src.indexOf('\r') !== -1) {
	    src = src.replace(/\r\n?/g, (match, offset) => {
	      if (match.length > 1) cr.push(offset);
	      return '\n';
	    });
	  }

	  const documents = [];
	  let offset = 0;

	  do {
	    const doc = new Document();
	    const context = new ParseContext({
	      src
	    });
	    offset = doc.parse(context, offset);
	    documents.push(doc);
	  } while (offset < src.length);

	  documents.setOrigRanges = () => {
	    if (cr.length === 0) return false;

	    for (let i = 1; i < cr.length; ++i) cr[i] -= i;

	    let crOffset = 0;

	    for (let i = 0; i < documents.length; ++i) {
	      crOffset = documents[i].setOrigRanges(cr, crOffset);
	    }

	    cr.splice(0, cr.length);
	    return true;
	  };

	  documents.toString = () => documents.join('...\n');

	  return documents;
	}

	var parse_1 = parse;

	var parseCst = {
		parse: parse_1
	};

	function addCommentBefore(str, indent, comment) {
	  if (!comment) return str;
	  const cc = comment.replace(/[\s\S]^/gm, `$&${indent}#`);
	  return `#${cc}\n${indent}${str}`;
	}
	function addComment(str, indent, comment) {
	  return !comment ? str : comment.indexOf('\n') === -1 ? `${str} #${comment}` : `${str}\n` + comment.replace(/^/gm, `${indent || ''}#`);
	}

	class Node$1 {}

	function toJSON(value, arg, ctx) {
	  if (Array.isArray(value)) return value.map((v, i) => toJSON(v, String(i), ctx));

	  if (value && typeof value.toJSON === 'function') {
	    const anchor = ctx && ctx.anchors && ctx.anchors.get(value);
	    if (anchor) ctx.onCreate = res => {
	      anchor.res = res;
	      delete ctx.onCreate;
	    };
	    const res = value.toJSON(arg, ctx);
	    if (anchor && ctx.onCreate) ctx.onCreate(res);
	    return res;
	  }

	  if ((!ctx || !ctx.keep) && typeof value === 'bigint') return Number(value);
	  return value;
	}

	class Scalar extends Node$1 {
	  constructor(value) {
	    super();
	    this.value = value;
	  }

	  toJSON(arg, ctx) {
	    return ctx && ctx.keep ? this.value : toJSON(this.value, arg, ctx);
	  }

	  toString() {
	    return String(this.value);
	  }

	}

	function collectionFromPath(schema, path, value) {
	  let v = value;

	  for (let i = path.length - 1; i >= 0; --i) {
	    const k = path[i];
	    const o = Number.isInteger(k) && k >= 0 ? [] : {};
	    o[k] = v;
	    v = o;
	  }

	  return schema.createNode(v, false);
	} // null, undefined, or an empty non-string iterable (e.g. [])


	const isEmptyPath = path => path == null || typeof path === 'object' && path[Symbol.iterator]().next().done;
	class Collection$1 extends Node$1 {
	  constructor(schema) {
	    super();

	    PlainValueEc8e588e._defineProperty(this, "items", []);

	    this.schema = schema;
	  }

	  addIn(path, value) {
	    if (isEmptyPath(path)) this.add(value);else {
	      const [key, ...rest] = path;
	      const node = this.get(key, true);
	      if (node instanceof Collection$1) node.addIn(rest, value);else if (node === undefined && this.schema) this.set(key, collectionFromPath(this.schema, rest, value));else throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
	    }
	  }

	  deleteIn([key, ...rest]) {
	    if (rest.length === 0) return this.delete(key);
	    const node = this.get(key, true);
	    if (node instanceof Collection$1) return node.deleteIn(rest);else throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
	  }

	  getIn([key, ...rest], keepScalar) {
	    const node = this.get(key, true);
	    if (rest.length === 0) return !keepScalar && node instanceof Scalar ? node.value : node;else return node instanceof Collection$1 ? node.getIn(rest, keepScalar) : undefined;
	  }

	  hasAllNullValues() {
	    return this.items.every(node => {
	      if (!node || node.type !== 'PAIR') return false;
	      const n = node.value;
	      return n == null || n instanceof Scalar && n.value == null && !n.commentBefore && !n.comment && !n.tag;
	    });
	  }

	  hasIn([key, ...rest]) {
	    if (rest.length === 0) return this.has(key);
	    const node = this.get(key, true);
	    return node instanceof Collection$1 ? node.hasIn(rest) : false;
	  }

	  setIn([key, ...rest], value) {
	    if (rest.length === 0) {
	      this.set(key, value);
	    } else {
	      const node = this.get(key, true);
	      if (node instanceof Collection$1) node.setIn(rest, value);else if (node === undefined && this.schema) this.set(key, collectionFromPath(this.schema, rest, value));else throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
	    }
	  } // overridden in implementations

	  /* istanbul ignore next */


	  toJSON() {
	    return null;
	  }

	  toString(ctx, {
	    blockItem,
	    flowChars,
	    isMap,
	    itemIndent
	  }, onComment, onChompKeep) {
	    const {
	      indent,
	      indentStep,
	      stringify
	    } = ctx;
	    const inFlow = this.type === PlainValueEc8e588e.Type.FLOW_MAP || this.type === PlainValueEc8e588e.Type.FLOW_SEQ || ctx.inFlow;
	    if (inFlow) itemIndent += indentStep;
	    const allNullValues = isMap && this.hasAllNullValues();
	    ctx = Object.assign({}, ctx, {
	      allNullValues,
	      indent: itemIndent,
	      inFlow,
	      type: null
	    });
	    let chompKeep = false;
	    let hasItemWithNewLine = false;
	    const nodes = this.items.reduce((nodes, item, i) => {
	      let comment;

	      if (item) {
	        if (!chompKeep && item.spaceBefore) nodes.push({
	          type: 'comment',
	          str: ''
	        });
	        if (item.commentBefore) item.commentBefore.match(/^.*$/gm).forEach(line => {
	          nodes.push({
	            type: 'comment',
	            str: `#${line}`
	          });
	        });
	        if (item.comment) comment = item.comment;
	        if (inFlow && (!chompKeep && item.spaceBefore || item.commentBefore || item.comment || item.key && (item.key.commentBefore || item.key.comment) || item.value && (item.value.commentBefore || item.value.comment))) hasItemWithNewLine = true;
	      }

	      chompKeep = false;
	      let str = stringify(item, ctx, () => comment = null, () => chompKeep = true);
	      if (inFlow && !hasItemWithNewLine && str.includes('\n')) hasItemWithNewLine = true;
	      if (inFlow && i < this.items.length - 1) str += ',';
	      str = addComment(str, itemIndent, comment);
	      if (chompKeep && (comment || inFlow)) chompKeep = false;
	      nodes.push({
	        type: 'item',
	        str
	      });
	      return nodes;
	    }, []);
	    let str;

	    if (nodes.length === 0) {
	      str = flowChars.start + flowChars.end;
	    } else if (inFlow) {
	      const {
	        start,
	        end
	      } = flowChars;
	      const strings = nodes.map(n => n.str);

	      if (hasItemWithNewLine || strings.reduce((sum, str) => sum + str.length + 2, 2) > Collection$1.maxFlowStringSingleLineLength) {
	        str = start;

	        for (const s of strings) {
	          str += s ? `\n${indentStep}${indent}${s}` : '\n';
	        }

	        str += `\n${indent}${end}`;
	      } else {
	        str = `${start} ${strings.join(' ')} ${end}`;
	      }
	    } else {
	      const strings = nodes.map(blockItem);
	      str = strings.shift();

	      for (const s of strings) str += s ? `\n${indent}${s}` : '\n';
	    }

	    if (this.comment) {
	      str += '\n' + this.comment.replace(/^/gm, `${indent}#`);
	      if (onComment) onComment();
	    } else if (chompKeep && onChompKeep) onChompKeep();

	    return str;
	  }

	}

	PlainValueEc8e588e._defineProperty(Collection$1, "maxFlowStringSingleLineLength", 60);

	function asItemIndex(key) {
	  let idx = key instanceof Scalar ? key.value : key;
	  if (idx && typeof idx === 'string') idx = Number(idx);
	  return Number.isInteger(idx) && idx >= 0 ? idx : null;
	}

	class YAMLSeq extends Collection$1 {
	  add(value) {
	    this.items.push(value);
	  }

	  delete(key) {
	    const idx = asItemIndex(key);
	    if (typeof idx !== 'number') return false;
	    const del = this.items.splice(idx, 1);
	    return del.length > 0;
	  }

	  get(key, keepScalar) {
	    const idx = asItemIndex(key);
	    if (typeof idx !== 'number') return undefined;
	    const it = this.items[idx];
	    return !keepScalar && it instanceof Scalar ? it.value : it;
	  }

	  has(key) {
	    const idx = asItemIndex(key);
	    return typeof idx === 'number' && idx < this.items.length;
	  }

	  set(key, value) {
	    const idx = asItemIndex(key);
	    if (typeof idx !== 'number') throw new Error(`Expected a valid index, not ${key}.`);
	    this.items[idx] = value;
	  }

	  toJSON(_, ctx) {
	    const seq = [];
	    if (ctx && ctx.onCreate) ctx.onCreate(seq);
	    let i = 0;

	    for (const item of this.items) seq.push(toJSON(item, String(i++), ctx));

	    return seq;
	  }

	  toString(ctx, onComment, onChompKeep) {
	    if (!ctx) return JSON.stringify(this);
	    return super.toString(ctx, {
	      blockItem: n => n.type === 'comment' ? n.str : `- ${n.str}`,
	      flowChars: {
	        start: '[',
	        end: ']'
	      },
	      isMap: false,
	      itemIndent: (ctx.indent || '') + '  '
	    }, onComment, onChompKeep);
	  }

	}

	const stringifyKey = (key, jsKey, ctx) => {
	  if (jsKey === null) return '';
	  if (typeof jsKey !== 'object') return String(jsKey);
	  if (key instanceof Node$1 && ctx && ctx.doc) return key.toString({
	    anchors: {},
	    doc: ctx.doc,
	    indent: '',
	    indentStep: ctx.indentStep,
	    inFlow: true,
	    inStringifyKey: true,
	    stringify: ctx.stringify
	  });
	  return JSON.stringify(jsKey);
	};

	class Pair extends Node$1 {
	  constructor(key, value = null) {
	    super();
	    this.key = key;
	    this.value = value;
	    this.type = Pair.Type.PAIR;
	  }

	  get commentBefore() {
	    return this.key instanceof Node$1 ? this.key.commentBefore : undefined;
	  }

	  set commentBefore(cb) {
	    if (this.key == null) this.key = new Scalar(null);
	    if (this.key instanceof Node$1) this.key.commentBefore = cb;else {
	      const msg = 'Pair.commentBefore is an alias for Pair.key.commentBefore. To set it, the key must be a Node.';
	      throw new Error(msg);
	    }
	  }

	  addToJSMap(ctx, map) {
	    const key = toJSON(this.key, '', ctx);

	    if (map instanceof Map) {
	      const value = toJSON(this.value, key, ctx);
	      map.set(key, value);
	    } else if (map instanceof Set) {
	      map.add(key);
	    } else {
	      const stringKey = stringifyKey(this.key, key, ctx);
	      map[stringKey] = toJSON(this.value, stringKey, ctx);
	    }

	    return map;
	  }

	  toJSON(_, ctx) {
	    const pair = ctx && ctx.mapAsMap ? new Map() : {};
	    return this.addToJSMap(ctx, pair);
	  }

	  toString(ctx, onComment, onChompKeep) {
	    if (!ctx || !ctx.doc) return JSON.stringify(this);
	    const {
	      indent: indentSize,
	      indentSeq,
	      simpleKeys
	    } = ctx.doc.options;
	    let {
	      key,
	      value
	    } = this;
	    let keyComment = key instanceof Node$1 && key.comment;

	    if (simpleKeys) {
	      if (keyComment) {
	        throw new Error('With simple keys, key nodes cannot have comments');
	      }

	      if (key instanceof Collection$1) {
	        const msg = 'With simple keys, collection cannot be used as a key value';
	        throw new Error(msg);
	      }
	    }

	    const explicitKey = !simpleKeys && (!key || keyComment || key instanceof Collection$1 || key.type === PlainValueEc8e588e.Type.BLOCK_FOLDED || key.type === PlainValueEc8e588e.Type.BLOCK_LITERAL);
	    const {
	      doc,
	      indent,
	      indentStep,
	      stringify
	    } = ctx;
	    ctx = Object.assign({}, ctx, {
	      implicitKey: !explicitKey,
	      indent: indent + indentStep
	    });
	    let chompKeep = false;
	    let str = stringify(key, ctx, () => keyComment = null, () => chompKeep = true);
	    str = addComment(str, ctx.indent, keyComment);

	    if (ctx.allNullValues && !simpleKeys) {
	      if (this.comment) {
	        str = addComment(str, ctx.indent, this.comment);
	        if (onComment) onComment();
	      } else if (chompKeep && !keyComment && onChompKeep) onChompKeep();

	      return ctx.inFlow ? str : `? ${str}`;
	    }

	    str = explicitKey ? `? ${str}\n${indent}:` : `${str}:`;

	    if (this.comment) {
	      // expected (but not strictly required) to be a single-line comment
	      str = addComment(str, ctx.indent, this.comment);
	      if (onComment) onComment();
	    }

	    let vcb = '';
	    let valueComment = null;

	    if (value instanceof Node$1) {
	      if (value.spaceBefore) vcb = '\n';

	      if (value.commentBefore) {
	        const cs = value.commentBefore.replace(/^/gm, `${ctx.indent}#`);
	        vcb += `\n${cs}`;
	      }

	      valueComment = value.comment;
	    } else if (value && typeof value === 'object') {
	      value = doc.schema.createNode(value, true);
	    }

	    ctx.implicitKey = false;
	    if (!explicitKey && !this.comment && value instanceof Scalar) ctx.indentAtStart = str.length + 1;
	    chompKeep = false;

	    if (!indentSeq && indentSize >= 2 && !ctx.inFlow && !explicitKey && value instanceof YAMLSeq && value.type !== PlainValueEc8e588e.Type.FLOW_SEQ && !value.tag && !doc.anchors.getName(value)) {
	      // If indentSeq === false, consider '- ' as part of indentation where possible
	      ctx.indent = ctx.indent.substr(2);
	    }

	    const valueStr = stringify(value, ctx, () => valueComment = null, () => chompKeep = true);
	    let ws = ' ';

	    if (vcb || this.comment) {
	      ws = `${vcb}\n${ctx.indent}`;
	    } else if (!explicitKey && value instanceof Collection$1) {
	      const flow = valueStr[0] === '[' || valueStr[0] === '{';
	      if (!flow || valueStr.includes('\n')) ws = `\n${ctx.indent}`;
	    }

	    if (chompKeep && !valueComment && onChompKeep) onChompKeep();
	    return addComment(str + ws + valueStr, ctx.indent, valueComment);
	  }

	}

	PlainValueEc8e588e._defineProperty(Pair, "Type", {
	  PAIR: 'PAIR',
	  MERGE_PAIR: 'MERGE_PAIR'
	});

	const getAliasCount = (node, anchors) => {
	  if (node instanceof Alias$1) {
	    const anchor = anchors.get(node.source);
	    return anchor.count * anchor.aliasCount;
	  } else if (node instanceof Collection$1) {
	    let count = 0;

	    for (const item of node.items) {
	      const c = getAliasCount(item, anchors);
	      if (c > count) count = c;
	    }

	    return count;
	  } else if (node instanceof Pair) {
	    const kc = getAliasCount(node.key, anchors);
	    const vc = getAliasCount(node.value, anchors);
	    return Math.max(kc, vc);
	  }

	  return 1;
	};

	class Alias$1 extends Node$1 {
	  static stringify({
	    range,
	    source
	  }, {
	    anchors,
	    doc,
	    implicitKey,
	    inStringifyKey
	  }) {
	    let anchor = Object.keys(anchors).find(a => anchors[a] === source);
	    if (!anchor && inStringifyKey) anchor = doc.anchors.getName(source) || doc.anchors.newName();
	    if (anchor) return `*${anchor}${implicitKey ? ' ' : ''}`;
	    const msg = doc.anchors.getName(source) ? 'Alias node must be after source node' : 'Source node not found for alias node';
	    throw new Error(`${msg} [${range}]`);
	  }

	  constructor(source) {
	    super();
	    this.source = source;
	    this.type = PlainValueEc8e588e.Type.ALIAS;
	  }

	  set tag(t) {
	    throw new Error('Alias nodes cannot have tags');
	  }

	  toJSON(arg, ctx) {
	    if (!ctx) return toJSON(this.source, arg, ctx);
	    const {
	      anchors,
	      maxAliasCount
	    } = ctx;
	    const anchor = anchors.get(this.source);
	    /* istanbul ignore if */

	    if (!anchor || anchor.res === undefined) {
	      const msg = 'This should not happen: Alias anchor was not resolved?';
	      if (this.cstNode) throw new PlainValueEc8e588e.YAMLReferenceError(this.cstNode, msg);else throw new ReferenceError(msg);
	    }

	    if (maxAliasCount >= 0) {
	      anchor.count += 1;
	      if (anchor.aliasCount === 0) anchor.aliasCount = getAliasCount(this.source, anchors);

	      if (anchor.count * anchor.aliasCount > maxAliasCount) {
	        const msg = 'Excessive alias count indicates a resource exhaustion attack';
	        if (this.cstNode) throw new PlainValueEc8e588e.YAMLReferenceError(this.cstNode, msg);else throw new ReferenceError(msg);
	      }
	    }

	    return anchor.res;
	  } // Only called when stringifying an alias mapping key while constructing
	  // Object output.


	  toString(ctx) {
	    return Alias$1.stringify(this, ctx);
	  }

	}

	PlainValueEc8e588e._defineProperty(Alias$1, "default", true);

	function findPair(items, key) {
	  const k = key instanceof Scalar ? key.value : key;

	  for (const it of items) {
	    if (it instanceof Pair) {
	      if (it.key === key || it.key === k) return it;
	      if (it.key && it.key.value === k) return it;
	    }
	  }

	  return undefined;
	}
	class YAMLMap extends Collection$1 {
	  add(pair, overwrite) {
	    if (!pair) pair = new Pair(pair);else if (!(pair instanceof Pair)) pair = new Pair(pair.key || pair, pair.value);
	    const prev = findPair(this.items, pair.key);
	    const sortEntries = this.schema && this.schema.sortMapEntries;

	    if (prev) {
	      if (overwrite) prev.value = pair.value;else throw new Error(`Key ${pair.key} already set`);
	    } else if (sortEntries) {
	      const i = this.items.findIndex(item => sortEntries(pair, item) < 0);
	      if (i === -1) this.items.push(pair);else this.items.splice(i, 0, pair);
	    } else {
	      this.items.push(pair);
	    }
	  }

	  delete(key) {
	    const it = findPair(this.items, key);
	    if (!it) return false;
	    const del = this.items.splice(this.items.indexOf(it), 1);
	    return del.length > 0;
	  }

	  get(key, keepScalar) {
	    const it = findPair(this.items, key);
	    const node = it && it.value;
	    return !keepScalar && node instanceof Scalar ? node.value : node;
	  }

	  has(key) {
	    return !!findPair(this.items, key);
	  }

	  set(key, value) {
	    this.add(new Pair(key, value), true);
	  }
	  /**
	   * @param {*} arg ignored
	   * @param {*} ctx Conversion context, originally set in Document#toJSON()
	   * @param {Class} Type If set, forces the returned collection type
	   * @returns {*} Instance of Type, Map, or Object
	   */


	  toJSON(_, ctx, Type) {
	    const map = Type ? new Type() : ctx && ctx.mapAsMap ? new Map() : {};
	    if (ctx && ctx.onCreate) ctx.onCreate(map);

	    for (const item of this.items) item.addToJSMap(ctx, map);

	    return map;
	  }

	  toString(ctx, onComment, onChompKeep) {
	    if (!ctx) return JSON.stringify(this);

	    for (const item of this.items) {
	      if (!(item instanceof Pair)) throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
	    }

	    return super.toString(ctx, {
	      blockItem: n => n.str,
	      flowChars: {
	        start: '{',
	        end: '}'
	      },
	      isMap: true,
	      itemIndent: ctx.indent || ''
	    }, onComment, onChompKeep);
	  }

	}

	const MERGE_KEY = '<<';
	class Merge extends Pair {
	  constructor(pair) {
	    if (pair instanceof Pair) {
	      let seq = pair.value;

	      if (!(seq instanceof YAMLSeq)) {
	        seq = new YAMLSeq();
	        seq.items.push(pair.value);
	        seq.range = pair.value.range;
	      }

	      super(pair.key, seq);
	      this.range = pair.range;
	    } else {
	      super(new Scalar(MERGE_KEY), new YAMLSeq());
	    }

	    this.type = Pair.Type.MERGE_PAIR;
	  } // If the value associated with a merge key is a single mapping node, each of
	  // its key/value pairs is inserted into the current mapping, unless the key
	  // already exists in it. If the value associated with the merge key is a
	  // sequence, then this sequence is expected to contain mapping nodes and each
	  // of these nodes is merged in turn according to its order in the sequence.
	  // Keys in mapping nodes earlier in the sequence override keys specified in
	  // later mapping nodes. -- http://yaml.org/type/merge.html


	  addToJSMap(ctx, map) {
	    for (const {
	      source
	    } of this.value.items) {
	      if (!(source instanceof YAMLMap)) throw new Error('Merge sources must be maps');
	      const srcMap = source.toJSON(null, ctx, Map);

	      for (const [key, value] of srcMap) {
	        if (map instanceof Map) {
	          if (!map.has(key)) map.set(key, value);
	        } else if (map instanceof Set) {
	          map.add(key);
	        } else {
	          if (!Object.prototype.hasOwnProperty.call(map, key)) map[key] = value;
	        }
	      }
	    }

	    return map;
	  }

	  toString(ctx, onComment) {
	    const seq = this.value;
	    if (seq.items.length > 1) return super.toString(ctx, onComment);
	    this.value = seq.items[0];
	    const str = super.toString(ctx, onComment);
	    this.value = seq;
	    return str;
	  }

	}

	const binaryOptions = {
	  defaultType: PlainValueEc8e588e.Type.BLOCK_LITERAL,
	  lineWidth: 76
	};
	const boolOptions = {
	  trueStr: 'true',
	  falseStr: 'false'
	};
	const intOptions = {
	  asBigInt: false
	};
	const nullOptions = {
	  nullStr: 'null'
	};
	const strOptions = {
	  defaultType: PlainValueEc8e588e.Type.PLAIN,
	  doubleQuoted: {
	    jsonEncoding: false,
	    minMultiLineLength: 40
	  },
	  fold: {
	    lineWidth: 80,
	    minContentWidth: 20
	  }
	};

	function resolveScalar(str, tags, scalarFallback) {
	  for (const {
	    format,
	    test,
	    resolve
	  } of tags) {
	    if (test) {
	      const match = str.match(test);

	      if (match) {
	        let res = resolve.apply(null, match);
	        if (!(res instanceof Scalar)) res = new Scalar(res);
	        if (format) res.format = format;
	        return res;
	      }
	    }
	  }

	  if (scalarFallback) str = scalarFallback(str);
	  return new Scalar(str);
	}

	const FOLD_FLOW = 'flow';
	const FOLD_BLOCK = 'block';
	const FOLD_QUOTED = 'quoted'; // presumes i+1 is at the start of a line
	// returns index of last newline in more-indented block

	const consumeMoreIndentedLines = (text, i) => {
	  let ch = text[i + 1];

	  while (ch === ' ' || ch === '\t') {
	    do {
	      ch = text[i += 1];
	    } while (ch && ch !== '\n');

	    ch = text[i + 1];
	  }

	  return i;
	};
	/**
	 * Tries to keep input at up to `lineWidth` characters, splitting only on spaces
	 * not followed by newlines or spaces unless `mode` is `'quoted'`. Lines are
	 * terminated with `\n` and started with `indent`.
	 *
	 * @param {string} text
	 * @param {string} indent
	 * @param {string} [mode='flow'] `'block'` prevents more-indented lines
	 *   from being folded; `'quoted'` allows for `\` escapes, including escaped
	 *   newlines
	 * @param {Object} options
	 * @param {number} [options.indentAtStart] Accounts for leading contents on
	 *   the first line, defaulting to `indent.length`
	 * @param {number} [options.lineWidth=80]
	 * @param {number} [options.minContentWidth=20] Allow highly indented lines to
	 *   stretch the line width
	 * @param {function} options.onFold Called once if the text is folded
	 * @param {function} options.onFold Called once if any line of text exceeds
	 *   lineWidth characters
	 */


	function foldFlowLines(text, indent, mode, {
	  indentAtStart,
	  lineWidth = 80,
	  minContentWidth = 20,
	  onFold,
	  onOverflow
	}) {
	  if (!lineWidth || lineWidth < 0) return text;
	  const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
	  if (text.length <= endStep) return text;
	  const folds = [];
	  const escapedFolds = {};
	  let end = lineWidth - (typeof indentAtStart === 'number' ? indentAtStart : indent.length);
	  let split = undefined;
	  let prev = undefined;
	  let overflow = false;
	  let i = -1;

	  if (mode === FOLD_BLOCK) {
	    i = consumeMoreIndentedLines(text, i);
	    if (i !== -1) end = i + endStep;
	  }

	  for (let ch; ch = text[i += 1];) {
	    if (mode === FOLD_QUOTED && ch === '\\') {
	      switch (text[i + 1]) {
	        case 'x':
	          i += 3;
	          break;

	        case 'u':
	          i += 5;
	          break;

	        case 'U':
	          i += 9;
	          break;

	        default:
	          i += 1;
	      }
	    }

	    if (ch === '\n') {
	      if (mode === FOLD_BLOCK) i = consumeMoreIndentedLines(text, i);
	      end = i + endStep;
	      split = undefined;
	    } else {
	      if (ch === ' ' && prev && prev !== ' ' && prev !== '\n' && prev !== '\t') {
	        // space surrounded by non-space can be replaced with newline + indent
	        const next = text[i + 1];
	        if (next && next !== ' ' && next !== '\n' && next !== '\t') split = i;
	      }

	      if (i >= end) {
	        if (split) {
	          folds.push(split);
	          end = split + endStep;
	          split = undefined;
	        } else if (mode === FOLD_QUOTED) {
	          // white-space collected at end may stretch past lineWidth
	          while (prev === ' ' || prev === '\t') {
	            prev = ch;
	            ch = text[i += 1];
	            overflow = true;
	          } // i - 2 accounts for not-dropped last char + newline-escaping \


	          folds.push(i - 2);
	          escapedFolds[i - 2] = true;
	          end = i - 2 + endStep;
	          split = undefined;
	        } else {
	          overflow = true;
	        }
	      }
	    }

	    prev = ch;
	  }

	  if (overflow && onOverflow) onOverflow();
	  if (folds.length === 0) return text;
	  if (onFold) onFold();
	  let res = text.slice(0, folds[0]);

	  for (let i = 0; i < folds.length; ++i) {
	    const fold = folds[i];
	    const end = folds[i + 1] || text.length;
	    if (mode === FOLD_QUOTED && escapedFolds[fold]) res += `${text[fold]}\\`;
	    res += `\n${indent}${text.slice(fold + 1, end)}`;
	  }

	  return res;
	}

	const getFoldOptions = ({
	  indentAtStart
	}) => indentAtStart ? Object.assign({
	  indentAtStart
	}, strOptions.fold) : strOptions.fold; // Also checks for lines starting with %, as parsing the output as YAML 1.1 will
	// presume that's starting a new document.


	const containsDocumentMarker = str => /^(%|---|\.\.\.)/m.test(str);

	function lineLengthOverLimit(str, limit) {
	  const strLen = str.length;
	  if (strLen <= limit) return false;

	  for (let i = 0, start = 0; i < strLen; ++i) {
	    if (str[i] === '\n') {
	      if (i - start > limit) return true;
	      start = i + 1;
	      if (strLen - start <= limit) return false;
	    }
	  }

	  return true;
	}

	function doubleQuotedString(value, ctx) {
	  const {
	    implicitKey
	  } = ctx;
	  const {
	    jsonEncoding,
	    minMultiLineLength
	  } = strOptions.doubleQuoted;
	  const json = JSON.stringify(value);
	  if (jsonEncoding) return json;
	  const indent = ctx.indent || (containsDocumentMarker(value) ? '  ' : '');
	  let str = '';
	  let start = 0;

	  for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
	    if (ch === ' ' && json[i + 1] === '\\' && json[i + 2] === 'n') {
	      // space before newline needs to be escaped to not be folded
	      str += json.slice(start, i) + '\\ ';
	      i += 1;
	      start = i;
	      ch = '\\';
	    }

	    if (ch === '\\') switch (json[i + 1]) {
	      case 'u':
	        {
	          str += json.slice(start, i);
	          const code = json.substr(i + 2, 4);

	          switch (code) {
	            case '0000':
	              str += '\\0';
	              break;

	            case '0007':
	              str += '\\a';
	              break;

	            case '000b':
	              str += '\\v';
	              break;

	            case '001b':
	              str += '\\e';
	              break;

	            case '0085':
	              str += '\\N';
	              break;

	            case '00a0':
	              str += '\\_';
	              break;

	            case '2028':
	              str += '\\L';
	              break;

	            case '2029':
	              str += '\\P';
	              break;

	            default:
	              if (code.substr(0, 2) === '00') str += '\\x' + code.substr(2);else str += json.substr(i, 6);
	          }

	          i += 5;
	          start = i + 1;
	        }
	        break;

	      case 'n':
	        if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
	          i += 1;
	        } else {
	          // folding will eat first newline
	          str += json.slice(start, i) + '\n\n';

	          while (json[i + 2] === '\\' && json[i + 3] === 'n' && json[i + 4] !== '"') {
	            str += '\n';
	            i += 2;
	          }

	          str += indent; // space after newline needs to be escaped to not be folded

	          if (json[i + 2] === ' ') str += '\\';
	          i += 1;
	          start = i + 1;
	        }

	        break;

	      default:
	        i += 1;
	    }
	  }

	  str = start ? str + json.slice(start) : json;
	  return implicitKey ? str : foldFlowLines(str, indent, FOLD_QUOTED, getFoldOptions(ctx));
	}

	function singleQuotedString(value, ctx) {
	  if (ctx.implicitKey) {
	    if (/\n/.test(value)) return doubleQuotedString(value, ctx);
	  } else {
	    // single quoted string can't have leading or trailing whitespace around newline
	    if (/[ \t]\n|\n[ \t]/.test(value)) return doubleQuotedString(value, ctx);
	  }

	  const indent = ctx.indent || (containsDocumentMarker(value) ? '  ' : '');
	  const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&\n${indent}`) + "'";
	  return ctx.implicitKey ? res : foldFlowLines(res, indent, FOLD_FLOW, getFoldOptions(ctx));
	}

	function blockString({
	  comment,
	  type,
	  value
	}, ctx, onComment, onChompKeep) {
	  // 1. Block can't end in whitespace unless the last line is non-empty.
	  // 2. Strings consisting of only whitespace are best rendered explicitly.
	  if (/\n[\t ]+$/.test(value) || /^\s*$/.test(value)) {
	    return doubleQuotedString(value, ctx);
	  }

	  const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? '  ' : '');
	  const indentSize = indent ? '2' : '1'; // root is at -1

	  const literal = type === PlainValueEc8e588e.Type.BLOCK_FOLDED ? false : type === PlainValueEc8e588e.Type.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, strOptions.fold.lineWidth - indent.length);
	  let header = literal ? '|' : '>';
	  if (!value) return header + '\n';
	  let wsStart = '';
	  let wsEnd = '';
	  value = value.replace(/[\n\t ]*$/, ws => {
	    const n = ws.indexOf('\n');

	    if (n === -1) {
	      header += '-'; // strip
	    } else if (value === ws || n !== ws.length - 1) {
	      header += '+'; // keep

	      if (onChompKeep) onChompKeep();
	    }

	    wsEnd = ws.replace(/\n$/, '');
	    return '';
	  }).replace(/^[\n ]*/, ws => {
	    if (ws.indexOf(' ') !== -1) header += indentSize;
	    const m = ws.match(/ +$/);

	    if (m) {
	      wsStart = ws.slice(0, -m[0].length);
	      return m[0];
	    } else {
	      wsStart = ws;
	      return '';
	    }
	  });
	  if (wsEnd) wsEnd = wsEnd.replace(/\n+(?!\n|$)/g, `$&${indent}`);
	  if (wsStart) wsStart = wsStart.replace(/\n+/g, `$&${indent}`);

	  if (comment) {
	    header += ' #' + comment.replace(/ ?[\r\n]+/g, ' ');
	    if (onComment) onComment();
	  }

	  if (!value) return `${header}${indentSize}\n${indent}${wsEnd}`;

	  if (literal) {
	    value = value.replace(/\n+/g, `$&${indent}`);
	    return `${header}\n${indent}${wsStart}${value}${wsEnd}`;
	  }

	  value = value.replace(/\n+/g, '\n$&').replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, '$1$2') // more-indented lines aren't folded
	  //         ^ ind.line  ^ empty     ^ capture next empty lines only at end of indent
	  .replace(/\n+/g, `$&${indent}`);
	  const body = foldFlowLines(`${wsStart}${value}${wsEnd}`, indent, FOLD_BLOCK, strOptions.fold);
	  return `${header}\n${indent}${body}`;
	}

	function plainString(item, ctx, onComment, onChompKeep) {
	  const {
	    comment,
	    type,
	    value
	  } = item;
	  const {
	    actualString,
	    implicitKey,
	    indent,
	    inFlow
	  } = ctx;

	  if (implicitKey && /[\n[\]{},]/.test(value) || inFlow && /[[\]{},]/.test(value)) {
	    return doubleQuotedString(value, ctx);
	  }

	  if (!value || /^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
	    // not allowed:
	    // - empty string, '-' or '?'
	    // - start with an indicator character (except [?:-]) or /[?-] /
	    // - '\n ', ': ' or ' \n' anywhere
	    // - '#' not preceded by a non-space char
	    // - end with ' ' or ':'
	    return implicitKey || inFlow || value.indexOf('\n') === -1 ? value.indexOf('"') !== -1 && value.indexOf("'") === -1 ? singleQuotedString(value, ctx) : doubleQuotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
	  }

	  if (!implicitKey && !inFlow && type !== PlainValueEc8e588e.Type.PLAIN && value.indexOf('\n') !== -1) {
	    // Where allowed & type not set explicitly, prefer block style for multiline strings
	    return blockString(item, ctx, onComment, onChompKeep);
	  }

	  if (indent === '' && containsDocumentMarker(value)) {
	    ctx.forceBlockIndent = true;
	    return blockString(item, ctx, onComment, onChompKeep);
	  }

	  const str = value.replace(/\n+/g, `$&\n${indent}`); // Verify that output will be parsed as a string, as e.g. plain numbers and
	  // booleans get parsed with those types in v1.2 (e.g. '42', 'true' & '0.9e-3'),
	  // and others in v1.1.

	  if (actualString) {
	    const {
	      tags
	    } = ctx.doc.schema;
	    const resolved = resolveScalar(str, tags, tags.scalarFallback).value;
	    if (typeof resolved !== 'string') return doubleQuotedString(value, ctx);
	  }

	  const body = implicitKey ? str : foldFlowLines(str, indent, FOLD_FLOW, getFoldOptions(ctx));

	  if (comment && !inFlow && (body.indexOf('\n') !== -1 || comment.indexOf('\n') !== -1)) {
	    if (onComment) onComment();
	    return addCommentBefore(body, indent, comment);
	  }

	  return body;
	}

	function stringifyString(item, ctx, onComment, onChompKeep) {
	  const {
	    defaultType
	  } = strOptions;
	  const {
	    implicitKey,
	    inFlow
	  } = ctx;
	  let {
	    type,
	    value
	  } = item;

	  if (typeof value !== 'string') {
	    value = String(value);
	    item = Object.assign({}, item, {
	      value
	    });
	  }

	  const _stringify = _type => {
	    switch (_type) {
	      case PlainValueEc8e588e.Type.BLOCK_FOLDED:
	      case PlainValueEc8e588e.Type.BLOCK_LITERAL:
	        return blockString(item, ctx, onComment, onChompKeep);

	      case PlainValueEc8e588e.Type.QUOTE_DOUBLE:
	        return doubleQuotedString(value, ctx);

	      case PlainValueEc8e588e.Type.QUOTE_SINGLE:
	        return singleQuotedString(value, ctx);

	      case PlainValueEc8e588e.Type.PLAIN:
	        return plainString(item, ctx, onComment, onChompKeep);

	      default:
	        return null;
	    }
	  };

	  if (type !== PlainValueEc8e588e.Type.QUOTE_DOUBLE && /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(value)) {
	    // force double quotes on control characters
	    type = PlainValueEc8e588e.Type.QUOTE_DOUBLE;
	  } else if ((implicitKey || inFlow) && (type === PlainValueEc8e588e.Type.BLOCK_FOLDED || type === PlainValueEc8e588e.Type.BLOCK_LITERAL)) {
	    // should not happen; blocks are not valid inside flow containers
	    type = PlainValueEc8e588e.Type.QUOTE_DOUBLE;
	  }

	  let res = _stringify(type);

	  if (res === null) {
	    res = _stringify(defaultType);
	    if (res === null) throw new Error(`Unsupported default string type ${defaultType}`);
	  }

	  return res;
	}

	function stringifyNumber({
	  format,
	  minFractionDigits,
	  tag,
	  value
	}) {
	  if (typeof value === 'bigint') return String(value);
	  if (!isFinite(value)) return isNaN(value) ? '.nan' : value < 0 ? '-.inf' : '.inf';
	  let n = JSON.stringify(value);

	  if (!format && minFractionDigits && (!tag || tag === 'tag:yaml.org,2002:float') && /^\d/.test(n)) {
	    let i = n.indexOf('.');

	    if (i < 0) {
	      i = n.length;
	      n += '.';
	    }

	    let d = minFractionDigits - (n.length - i - 1);

	    while (d-- > 0) n += '0';
	  }

	  return n;
	}

	function checkFlowCollectionEnd(errors, cst) {
	  let char, name;

	  switch (cst.type) {
	    case PlainValueEc8e588e.Type.FLOW_MAP:
	      char = '}';
	      name = 'flow map';
	      break;

	    case PlainValueEc8e588e.Type.FLOW_SEQ:
	      char = ']';
	      name = 'flow sequence';
	      break;

	    default:
	      errors.push(new PlainValueEc8e588e.YAMLSemanticError(cst, 'Not a flow collection!?'));
	      return;
	  }

	  let lastItem;

	  for (let i = cst.items.length - 1; i >= 0; --i) {
	    const item = cst.items[i];

	    if (!item || item.type !== PlainValueEc8e588e.Type.COMMENT) {
	      lastItem = item;
	      break;
	    }
	  }

	  if (lastItem && lastItem.char !== char) {
	    const msg = `Expected ${name} to end with ${char}`;
	    let err;

	    if (typeof lastItem.offset === 'number') {
	      err = new PlainValueEc8e588e.YAMLSemanticError(cst, msg);
	      err.offset = lastItem.offset + 1;
	    } else {
	      err = new PlainValueEc8e588e.YAMLSemanticError(lastItem, msg);
	      if (lastItem.range && lastItem.range.end) err.offset = lastItem.range.end - lastItem.range.start;
	    }

	    errors.push(err);
	  }
	}
	function checkFlowCommentSpace(errors, comment) {
	  const prev = comment.context.src[comment.range.start - 1];

	  if (prev !== '\n' && prev !== '\t' && prev !== ' ') {
	    const msg = 'Comments must be separated from other tokens by white space characters';
	    errors.push(new PlainValueEc8e588e.YAMLSemanticError(comment, msg));
	  }
	}
	function getLongKeyError(source, key) {
	  const sk = String(key);
	  const k = sk.substr(0, 8) + '...' + sk.substr(-8);
	  return new PlainValueEc8e588e.YAMLSemanticError(source, `The "${k}" key is too long`);
	}
	function resolveComments(collection, comments) {
	  for (const {
	    afterKey,
	    before,
	    comment
	  } of comments) {
	    let item = collection.items[before];

	    if (!item) {
	      if (comment !== undefined) {
	        if (collection.comment) collection.comment += '\n' + comment;else collection.comment = comment;
	      }
	    } else {
	      if (afterKey && item.value) item = item.value;

	      if (comment === undefined) {
	        if (afterKey || !item.commentBefore) item.spaceBefore = true;
	      } else {
	        if (item.commentBefore) item.commentBefore += '\n' + comment;else item.commentBefore = comment;
	      }
	    }
	  }
	}

	// on error, will return { str: string, errors: Error[] }
	function resolveString(doc, node) {
	  const res = node.strValue;
	  if (!res) return '';
	  if (typeof res === 'string') return res;
	  res.errors.forEach(error => {
	    if (!error.source) error.source = node;
	    doc.errors.push(error);
	  });
	  return res.str;
	}

	function resolveTagHandle(doc, node) {
	  const {
	    handle,
	    suffix
	  } = node.tag;
	  let prefix = doc.tagPrefixes.find(p => p.handle === handle);

	  if (!prefix) {
	    const dtp = doc.getDefaults().tagPrefixes;
	    if (dtp) prefix = dtp.find(p => p.handle === handle);
	    if (!prefix) throw new PlainValueEc8e588e.YAMLSemanticError(node, `The ${handle} tag handle is non-default and was not declared.`);
	  }

	  if (!suffix) throw new PlainValueEc8e588e.YAMLSemanticError(node, `The ${handle} tag has no suffix.`);

	  if (handle === '!' && (doc.version || doc.options.version) === '1.0') {
	    if (suffix[0] === '^') {
	      doc.warnings.push(new PlainValueEc8e588e.YAMLWarning(node, 'YAML 1.0 ^ tag expansion is not supported'));
	      return suffix;
	    }

	    if (/[:/]/.test(suffix)) {
	      // word/foo -> tag:word.yaml.org,2002:foo
	      const vocab = suffix.match(/^([a-z0-9-]+)\/(.*)/i);
	      return vocab ? `tag:${vocab[1]}.yaml.org,2002:${vocab[2]}` : `tag:${suffix}`;
	    }
	  }

	  return prefix.prefix + decodeURIComponent(suffix);
	}

	function resolveTagName(doc, node) {
	  const {
	    tag,
	    type
	  } = node;
	  let nonSpecific = false;

	  if (tag) {
	    const {
	      handle,
	      suffix,
	      verbatim
	    } = tag;

	    if (verbatim) {
	      if (verbatim !== '!' && verbatim !== '!!') return verbatim;
	      const msg = `Verbatim tags aren't resolved, so ${verbatim} is invalid.`;
	      doc.errors.push(new PlainValueEc8e588e.YAMLSemanticError(node, msg));
	    } else if (handle === '!' && !suffix) {
	      nonSpecific = true;
	    } else {
	      try {
	        return resolveTagHandle(doc, node);
	      } catch (error) {
	        doc.errors.push(error);
	      }
	    }
	  }

	  switch (type) {
	    case PlainValueEc8e588e.Type.BLOCK_FOLDED:
	    case PlainValueEc8e588e.Type.BLOCK_LITERAL:
	    case PlainValueEc8e588e.Type.QUOTE_DOUBLE:
	    case PlainValueEc8e588e.Type.QUOTE_SINGLE:
	      return PlainValueEc8e588e.defaultTags.STR;

	    case PlainValueEc8e588e.Type.FLOW_MAP:
	    case PlainValueEc8e588e.Type.MAP:
	      return PlainValueEc8e588e.defaultTags.MAP;

	    case PlainValueEc8e588e.Type.FLOW_SEQ:
	    case PlainValueEc8e588e.Type.SEQ:
	      return PlainValueEc8e588e.defaultTags.SEQ;

	    case PlainValueEc8e588e.Type.PLAIN:
	      return nonSpecific ? PlainValueEc8e588e.defaultTags.STR : null;

	    default:
	      return null;
	  }
	}

	function resolveByTagName(doc, node, tagName) {
	  const {
	    tags
	  } = doc.schema;
	  const matchWithTest = [];

	  for (const tag of tags) {
	    if (tag.tag === tagName) {
	      if (tag.test) matchWithTest.push(tag);else {
	        const res = tag.resolve(doc, node);
	        return res instanceof Collection$1 ? res : new Scalar(res);
	      }
	    }
	  }

	  const str = resolveString(doc, node);
	  if (typeof str === 'string' && matchWithTest.length > 0) return resolveScalar(str, matchWithTest, tags.scalarFallback);
	  return null;
	}

	function getFallbackTagName({
	  type
	}) {
	  switch (type) {
	    case PlainValueEc8e588e.Type.FLOW_MAP:
	    case PlainValueEc8e588e.Type.MAP:
	      return PlainValueEc8e588e.defaultTags.MAP;

	    case PlainValueEc8e588e.Type.FLOW_SEQ:
	    case PlainValueEc8e588e.Type.SEQ:
	      return PlainValueEc8e588e.defaultTags.SEQ;

	    default:
	      return PlainValueEc8e588e.defaultTags.STR;
	  }
	}

	function resolveTag(doc, node, tagName) {
	  try {
	    const res = resolveByTagName(doc, node, tagName);

	    if (res) {
	      if (tagName && node.tag) res.tag = tagName;
	      return res;
	    }
	  } catch (error) {
	    /* istanbul ignore if */
	    if (!error.source) error.source = node;
	    doc.errors.push(error);
	    return null;
	  }

	  try {
	    const fallback = getFallbackTagName(node);
	    if (!fallback) throw new Error(`The tag ${tagName} is unavailable`);
	    const msg = `The tag ${tagName} is unavailable, falling back to ${fallback}`;
	    doc.warnings.push(new PlainValueEc8e588e.YAMLWarning(node, msg));
	    const res = resolveByTagName(doc, node, fallback);
	    res.tag = tagName;
	    return res;
	  } catch (error) {
	    const refError = new PlainValueEc8e588e.YAMLReferenceError(node, error.message);
	    refError.stack = error.stack;
	    doc.errors.push(refError);
	    return null;
	  }
	}

	const isCollectionItem = node => {
	  if (!node) return false;
	  const {
	    type
	  } = node;
	  return type === PlainValueEc8e588e.Type.MAP_KEY || type === PlainValueEc8e588e.Type.MAP_VALUE || type === PlainValueEc8e588e.Type.SEQ_ITEM;
	};

	function resolveNodeProps(errors, node) {
	  const comments = {
	    before: [],
	    after: []
	  };
	  let hasAnchor = false;
	  let hasTag = false;
	  const props = isCollectionItem(node.context.parent) ? node.context.parent.props.concat(node.props) : node.props;

	  for (const {
	    start,
	    end
	  } of props) {
	    switch (node.context.src[start]) {
	      case PlainValueEc8e588e.Char.COMMENT:
	        {
	          if (!node.commentHasRequiredWhitespace(start)) {
	            const msg = 'Comments must be separated from other tokens by white space characters';
	            errors.push(new PlainValueEc8e588e.YAMLSemanticError(node, msg));
	          }

	          const {
	            header,
	            valueRange
	          } = node;
	          const cc = valueRange && (start > valueRange.start || header && start > header.start) ? comments.after : comments.before;
	          cc.push(node.context.src.slice(start + 1, end));
	          break;
	        }
	      // Actual anchor & tag resolution is handled by schema, here we just complain

	      case PlainValueEc8e588e.Char.ANCHOR:
	        if (hasAnchor) {
	          const msg = 'A node can have at most one anchor';
	          errors.push(new PlainValueEc8e588e.YAMLSemanticError(node, msg));
	        }

	        hasAnchor = true;
	        break;

	      case PlainValueEc8e588e.Char.TAG:
	        if (hasTag) {
	          const msg = 'A node can have at most one tag';
	          errors.push(new PlainValueEc8e588e.YAMLSemanticError(node, msg));
	        }

	        hasTag = true;
	        break;
	    }
	  }

	  return {
	    comments,
	    hasAnchor,
	    hasTag
	  };
	}

	function resolveNodeValue(doc, node) {
	  const {
	    anchors,
	    errors,
	    schema
	  } = doc;

	  if (node.type === PlainValueEc8e588e.Type.ALIAS) {
	    const name = node.rawValue;
	    const src = anchors.getNode(name);

	    if (!src) {
	      const msg = `Aliased anchor not found: ${name}`;
	      errors.push(new PlainValueEc8e588e.YAMLReferenceError(node, msg));
	      return null;
	    } // Lazy resolution for circular references


	    const res = new Alias$1(src);

	    anchors._cstAliases.push(res);

	    return res;
	  }

	  const tagName = resolveTagName(doc, node);
	  if (tagName) return resolveTag(doc, node, tagName);

	  if (node.type !== PlainValueEc8e588e.Type.PLAIN) {
	    const msg = `Failed to resolve ${node.type} node here`;
	    errors.push(new PlainValueEc8e588e.YAMLSyntaxError(node, msg));
	    return null;
	  }

	  try {
	    const str = resolveString(doc, node);
	    return resolveScalar(str, schema.tags, schema.tags.scalarFallback);
	  } catch (error) {
	    if (!error.source) error.source = node;
	    errors.push(error);
	    return null;
	  }
	} // sets node.resolved on success


	function resolveNode(doc, node) {
	  if (!node) return null;
	  if (node.error) doc.errors.push(node.error);
	  const {
	    comments,
	    hasAnchor,
	    hasTag
	  } = resolveNodeProps(doc.errors, node);

	  if (hasAnchor) {
	    const {
	      anchors
	    } = doc;
	    const name = node.anchor;
	    const prev = anchors.getNode(name); // At this point, aliases for any preceding node with the same anchor
	    // name have already been resolved, so it may safely be renamed.

	    if (prev) anchors.map[anchors.newName(name)] = prev; // During parsing, we need to store the CST node in anchors.map as
	    // anchors need to be available during resolution to allow for
	    // circular references.

	    anchors.map[name] = node;
	  }

	  if (node.type === PlainValueEc8e588e.Type.ALIAS && (hasAnchor || hasTag)) {
	    const msg = 'An alias node must not specify any properties';
	    doc.errors.push(new PlainValueEc8e588e.YAMLSemanticError(node, msg));
	  }

	  const res = resolveNodeValue(doc, node);

	  if (res) {
	    res.range = [node.range.start, node.range.end];
	    if (doc.options.keepCstNodes) res.cstNode = node;
	    if (doc.options.keepNodeTypes) res.type = node.type;
	    const cb = comments.before.join('\n');

	    if (cb) {
	      res.commentBefore = res.commentBefore ? `${res.commentBefore}\n${cb}` : cb;
	    }

	    const ca = comments.after.join('\n');
	    if (ca) res.comment = res.comment ? `${res.comment}\n${ca}` : ca;
	  }

	  return node.resolved = res;
	}

	function resolveMap(doc, cst) {
	  if (cst.type !== PlainValueEc8e588e.Type.MAP && cst.type !== PlainValueEc8e588e.Type.FLOW_MAP) {
	    const msg = `A ${cst.type} node cannot be resolved as a mapping`;
	    doc.errors.push(new PlainValueEc8e588e.YAMLSyntaxError(cst, msg));
	    return null;
	  }

	  const {
	    comments,
	    items
	  } = cst.type === PlainValueEc8e588e.Type.FLOW_MAP ? resolveFlowMapItems(doc, cst) : resolveBlockMapItems(doc, cst);
	  const map = new YAMLMap();
	  map.items = items;
	  resolveComments(map, comments);
	  let hasCollectionKey = false;

	  for (let i = 0; i < items.length; ++i) {
	    const {
	      key: iKey
	    } = items[i];
	    if (iKey instanceof Collection$1) hasCollectionKey = true;

	    if (doc.schema.merge && iKey && iKey.value === MERGE_KEY) {
	      items[i] = new Merge(items[i]);
	      const sources = items[i].value.items;
	      let error = null;
	      sources.some(node => {
	        if (node instanceof Alias$1) {
	          // During parsing, alias sources are CST nodes; to account for
	          // circular references their resolved values can't be used here.
	          const {
	            type
	          } = node.source;
	          if (type === PlainValueEc8e588e.Type.MAP || type === PlainValueEc8e588e.Type.FLOW_MAP) return false;
	          return error = 'Merge nodes aliases can only point to maps';
	        }

	        return error = 'Merge nodes can only have Alias nodes as values';
	      });
	      if (error) doc.errors.push(new PlainValueEc8e588e.YAMLSemanticError(cst, error));
	    } else {
	      for (let j = i + 1; j < items.length; ++j) {
	        const {
	          key: jKey
	        } = items[j];

	        if (iKey === jKey || iKey && jKey && Object.prototype.hasOwnProperty.call(iKey, 'value') && iKey.value === jKey.value) {
	          const msg = `Map keys must be unique; "${iKey}" is repeated`;
	          doc.errors.push(new PlainValueEc8e588e.YAMLSemanticError(cst, msg));
	          break;
	        }
	      }
	    }
	  }

	  if (hasCollectionKey && !doc.options.mapAsMap) {
	    const warn = 'Keys with collection values will be stringified as YAML due to JS Object restrictions. Use mapAsMap: true to avoid this.';
	    doc.warnings.push(new PlainValueEc8e588e.YAMLWarning(cst, warn));
	  }

	  cst.resolved = map;
	  return map;
	}

	const valueHasPairComment = ({
	  context: {
	    lineStart,
	    node,
	    src
	  },
	  props
	}) => {
	  if (props.length === 0) return false;
	  const {
	    start
	  } = props[0];
	  if (node && start > node.valueRange.start) return false;
	  if (src[start] !== PlainValueEc8e588e.Char.COMMENT) return false;

	  for (let i = lineStart; i < start; ++i) if (src[i] === '\n') return false;

	  return true;
	};

	function resolvePairComment(item, pair) {
	  if (!valueHasPairComment(item)) return;
	  const comment = item.getPropValue(0, PlainValueEc8e588e.Char.COMMENT, true);
	  let found = false;
	  const cb = pair.value.commentBefore;

	  if (cb && cb.startsWith(comment)) {
	    pair.value.commentBefore = cb.substr(comment.length + 1);
	    found = true;
	  } else {
	    const cc = pair.value.comment;

	    if (!item.node && cc && cc.startsWith(comment)) {
	      pair.value.comment = cc.substr(comment.length + 1);
	      found = true;
	    }
	  }

	  if (found) pair.comment = comment;
	}

	function resolveBlockMapItems(doc, cst) {
	  const comments = [];
	  const items = [];
	  let key = undefined;
	  let keyStart = null;

	  for (let i = 0; i < cst.items.length; ++i) {
	    const item = cst.items[i];

	    switch (item.type) {
	      case PlainValueEc8e588e.Type.BLANK_LINE:
	        comments.push({
	          afterKey: !!key,
	          before: items.length
	        });
	        break;

	      case PlainValueEc8e588e.Type.COMMENT:
	        comments.push({
	          afterKey: !!key,
	          before: items.length,
	          comment: item.comment
	        });
	        break;

	      case PlainValueEc8e588e.Type.MAP_KEY:
	        if (key !== undefined) items.push(new Pair(key));
	        if (item.error) doc.errors.push(item.error);
	        key = resolveNode(doc, item.node);
	        keyStart = null;
	        break;

	      case PlainValueEc8e588e.Type.MAP_VALUE:
	        {
	          if (key === undefined) key = null;
	          if (item.error) doc.errors.push(item.error);

	          if (!item.context.atLineStart && item.node && item.node.type === PlainValueEc8e588e.Type.MAP && !item.node.context.atLineStart) {
	            const msg = 'Nested mappings are not allowed in compact mappings';
	            doc.errors.push(new PlainValueEc8e588e.YAMLSemanticError(item.node, msg));
	          }

	          let valueNode = item.node;

	          if (!valueNode && item.props.length > 0) {
	            // Comments on an empty mapping value need to be preserved, so we
	            // need to construct a minimal empty node here to use instead of the
	            // missing `item.node`. -- eemeli/yaml#19
	            valueNode = new PlainValueEc8e588e.PlainValue(PlainValueEc8e588e.Type.PLAIN, []);
	            valueNode.context = {
	              parent: item,
	              src: item.context.src
	            };
	            const pos = item.range.start + 1;
	            valueNode.range = {
	              start: pos,
	              end: pos
	            };
	            valueNode.valueRange = {
	              start: pos,
	              end: pos
	            };

	            if (typeof item.range.origStart === 'number') {
	              const origPos = item.range.origStart + 1;
	              valueNode.range.origStart = valueNode.range.origEnd = origPos;
	              valueNode.valueRange.origStart = valueNode.valueRange.origEnd = origPos;
	            }
	          }

	          const pair = new Pair(key, resolveNode(doc, valueNode));
	          resolvePairComment(item, pair);
	          items.push(pair);

	          if (key && typeof keyStart === 'number') {
	            if (item.range.start > keyStart + 1024) doc.errors.push(getLongKeyError(cst, key));
	          }

	          key = undefined;
	          keyStart = null;
	        }
	        break;

	      default:
	        if (key !== undefined) items.push(new Pair(key));
	        key = resolveNode(doc, item);
	        keyStart = item.range.start;
	        if (item.error) doc.errors.push(item.error);

	        next: for (let j = i + 1;; ++j) {
	          const nextItem = cst.items[j];

	          switch (nextItem && nextItem.type) {
	            case PlainValueEc8e588e.Type.BLANK_LINE:
	            case PlainValueEc8e588e.Type.COMMENT:
	              continue next;

	            case PlainValueEc8e588e.Type.MAP_VALUE:
	              break next;

	            default:
	              {
	                const msg = 'Implicit map keys need to be followed by map values';
	                doc.errors.push(new PlainValueEc8e588e.YAMLSemanticError(item, msg));
	                break next;
	              }
	          }
	        }

	        if (item.valueRangeContainsNewline) {
	          const msg = 'Implicit map keys need to be on a single line';
	          doc.errors.push(new PlainValueEc8e588e.YAMLSemanticError(item, msg));
	        }

	    }
	  }

	  if (key !== undefined) items.push(new Pair(key));
	  return {
	    comments,
	    items
	  };
	}

	function resolveFlowMapItems(doc, cst) {
	  const comments = [];
	  const items = [];
	  let key = undefined;
	  let explicitKey = false;
	  let next = '{';

	  for (let i = 0; i < cst.items.length; ++i) {
	    const item = cst.items[i];

	    if (typeof item.char === 'string') {
	      const {
	        char,
	        offset
	      } = item;

	      if (char === '?' && key === undefined && !explicitKey) {
	        explicitKey = true;
	        next = ':';
	        continue;
	      }

	      if (char === ':') {
	        if (key === undefined) key = null;

	        if (next === ':') {
	          next = ',';
	          continue;
	        }
	      } else {
	        if (explicitKey) {
	          if (key === undefined && char !== ',') key = null;
	          explicitKey = false;
	        }

	        if (key !== undefined) {
	          items.push(new Pair(key));
	          key = undefined;

	          if (char === ',') {
	            next = ':';
	            continue;
	          }
	        }
	      }

	      if (char === '}') {
	        if (i === cst.items.length - 1) continue;
	      } else if (char === next) {
	        next = ':';
	        continue;
	      }

	      const msg = `Flow map contains an unexpected ${char}`;
	      const err = new PlainValueEc8e588e.YAMLSyntaxError(cst, msg);
	      err.offset = offset;
	      doc.errors.push(err);
	    } else if (item.type === PlainValueEc8e588e.Type.BLANK_LINE) {
	      comments.push({
	        afterKey: !!key,
	        before: items.length
	      });
	    } else if (item.type === PlainValueEc8e588e.Type.COMMENT) {
	      checkFlowCommentSpace(doc.errors, item);
	      comments.push({
	        afterKey: !!key,
	        before: items.length,
	        comment: item.comment
	      });
	    } else if (key === undefined) {
	      if (next === ',') doc.errors.push(new PlainValueEc8e588e.YAMLSemanticError(item, 'Separator , missing in flow map'));
	      key = resolveNode(doc, item);
	    } else {
	      if (next !== ',') doc.errors.push(new PlainValueEc8e588e.YAMLSemanticError(item, 'Indicator : missing in flow map entry'));
	      items.push(new Pair(key, resolveNode(doc, item)));
	      key = undefined;
	      explicitKey = false;
	    }
	  }

	  checkFlowCollectionEnd(doc.errors, cst);
	  if (key !== undefined) items.push(new Pair(key));
	  return {
	    comments,
	    items
	  };
	}

	function resolveSeq(doc, cst) {
	  if (cst.type !== PlainValueEc8e588e.Type.SEQ && cst.type !== PlainValueEc8e588e.Type.FLOW_SEQ) {
	    const msg = `A ${cst.type} node cannot be resolved as a sequence`;
	    doc.errors.push(new PlainValueEc8e588e.YAMLSyntaxError(cst, msg));
	    return null;
	  }

	  const {
	    comments,
	    items
	  } = cst.type === PlainValueEc8e588e.Type.FLOW_SEQ ? resolveFlowSeqItems(doc, cst) : resolveBlockSeqItems(doc, cst);
	  const seq = new YAMLSeq();
	  seq.items = items;
	  resolveComments(seq, comments);

	  if (!doc.options.mapAsMap && items.some(it => it instanceof Pair && it.key instanceof Collection$1)) {
	    const warn = 'Keys with collection values will be stringified as YAML due to JS Object restrictions. Use mapAsMap: true to avoid this.';
	    doc.warnings.push(new PlainValueEc8e588e.YAMLWarning(cst, warn));
	  }

	  cst.resolved = seq;
	  return seq;
	}

	function resolveBlockSeqItems(doc, cst) {
	  const comments = [];
	  const items = [];

	  for (let i = 0; i < cst.items.length; ++i) {
	    const item = cst.items[i];

	    switch (item.type) {
	      case PlainValueEc8e588e.Type.BLANK_LINE:
	        comments.push({
	          before: items.length
	        });
	        break;

	      case PlainValueEc8e588e.Type.COMMENT:
	        comments.push({
	          comment: item.comment,
	          before: items.length
	        });
	        break;

	      case PlainValueEc8e588e.Type.SEQ_ITEM:
	        if (item.error) doc.errors.push(item.error);
	        items.push(resolveNode(doc, item.node));

	        if (item.hasProps) {
	          const msg = 'Sequence items cannot have tags or anchors before the - indicator';
	          doc.errors.push(new PlainValueEc8e588e.YAMLSemanticError(item, msg));
	        }

	        break;

	      default:
	        if (item.error) doc.errors.push(item.error);
	        doc.errors.push(new PlainValueEc8e588e.YAMLSyntaxError(item, `Unexpected ${item.type} node in sequence`));
	    }
	  }

	  return {
	    comments,
	    items
	  };
	}

	function resolveFlowSeqItems(doc, cst) {
	  const comments = [];
	  const items = [];
	  let explicitKey = false;
	  let key = undefined;
	  let keyStart = null;
	  let next = '[';
	  let prevItem = null;

	  for (let i = 0; i < cst.items.length; ++i) {
	    const item = cst.items[i];

	    if (typeof item.char === 'string') {
	      const {
	        char,
	        offset
	      } = item;

	      if (char !== ':' && (explicitKey || key !== undefined)) {
	        if (explicitKey && key === undefined) key = next ? items.pop() : null;
	        items.push(new Pair(key));
	        explicitKey = false;
	        key = undefined;
	        keyStart = null;
	      }

	      if (char === next) {
	        next = null;
	      } else if (!next && char === '?') {
	        explicitKey = true;
	      } else if (next !== '[' && char === ':' && key === undefined) {
	        if (next === ',') {
	          key = items.pop();

	          if (key instanceof Pair) {
	            const msg = 'Chaining flow sequence pairs is invalid';
	            const err = new PlainValueEc8e588e.YAMLSemanticError(cst, msg);
	            err.offset = offset;
	            doc.errors.push(err);
	          }

	          if (!explicitKey && typeof keyStart === 'number') {
	            const keyEnd = item.range ? item.range.start : item.offset;
	            if (keyEnd > keyStart + 1024) doc.errors.push(getLongKeyError(cst, key));
	            const {
	              src
	            } = prevItem.context;

	            for (let i = keyStart; i < keyEnd; ++i) if (src[i] === '\n') {
	              const msg = 'Implicit keys of flow sequence pairs need to be on a single line';
	              doc.errors.push(new PlainValueEc8e588e.YAMLSemanticError(prevItem, msg));
	              break;
	            }
	          }
	        } else {
	          key = null;
	        }

	        keyStart = null;
	        explicitKey = false;
	        next = null;
	      } else if (next === '[' || char !== ']' || i < cst.items.length - 1) {
	        const msg = `Flow sequence contains an unexpected ${char}`;
	        const err = new PlainValueEc8e588e.YAMLSyntaxError(cst, msg);
	        err.offset = offset;
	        doc.errors.push(err);
	      }
	    } else if (item.type === PlainValueEc8e588e.Type.BLANK_LINE) {
	      comments.push({
	        before: items.length
	      });
	    } else if (item.type === PlainValueEc8e588e.Type.COMMENT) {
	      checkFlowCommentSpace(doc.errors, item);
	      comments.push({
	        comment: item.comment,
	        before: items.length
	      });
	    } else {
	      if (next) {
	        const msg = `Expected a ${next} in flow sequence`;
	        doc.errors.push(new PlainValueEc8e588e.YAMLSemanticError(item, msg));
	      }

	      const value = resolveNode(doc, item);

	      if (key === undefined) {
	        items.push(value);
	        prevItem = item;
	      } else {
	        items.push(new Pair(key, value));
	        key = undefined;
	      }

	      keyStart = item.range.start;
	      next = ',';
	    }
	  }

	  checkFlowCollectionEnd(doc.errors, cst);
	  if (key !== undefined) items.push(new Pair(key));
	  return {
	    comments,
	    items
	  };
	}

	var Alias_1 = Alias$1;
	var Collection_1 = Collection$1;
	var Merge_1 = Merge;
	var Node_1$1 = Node$1;
	var Pair_1 = Pair;
	var Scalar_1 = Scalar;
	var YAMLMap_1 = YAMLMap;
	var YAMLSeq_1 = YAMLSeq;
	var addComment_1 = addComment;
	var binaryOptions_1 = binaryOptions;
	var boolOptions_1 = boolOptions;
	var findPair_1 = findPair;
	var intOptions_1 = intOptions;
	var isEmptyPath_1 = isEmptyPath;
	var nullOptions_1 = nullOptions;
	var resolveMap_1 = resolveMap;
	var resolveNode_1 = resolveNode;
	var resolveSeq_1 = resolveSeq;
	var resolveString_1 = resolveString;
	var strOptions_1 = strOptions;
	var stringifyNumber_1 = stringifyNumber;
	var stringifyString_1 = stringifyString;
	var toJSON_1 = toJSON;

	var resolveSeq4a68b39b = {
		Alias: Alias_1,
		Collection: Collection_1,
		Merge: Merge_1,
		Node: Node_1$1,
		Pair: Pair_1,
		Scalar: Scalar_1,
		YAMLMap: YAMLMap_1,
		YAMLSeq: YAMLSeq_1,
		addComment: addComment_1,
		binaryOptions: binaryOptions_1,
		boolOptions: boolOptions_1,
		findPair: findPair_1,
		intOptions: intOptions_1,
		isEmptyPath: isEmptyPath_1,
		nullOptions: nullOptions_1,
		resolveMap: resolveMap_1,
		resolveNode: resolveNode_1,
		resolveSeq: resolveSeq_1,
		resolveString: resolveString_1,
		strOptions: strOptions_1,
		stringifyNumber: stringifyNumber_1,
		stringifyString: stringifyString_1,
		toJSON: toJSON_1
	};

	/* global atob, btoa, Buffer */
	const binary = {
	  identify: value => value instanceof Uint8Array,
	  // Buffer inherits from Uint8Array
	  default: false,
	  tag: 'tag:yaml.org,2002:binary',

	  /**
	   * Returns a Buffer in node and an Uint8Array in browsers
	   *
	   * To use the resulting buffer as an image, you'll want to do something like:
	   *
	   *   const blob = new Blob([buffer], { type: 'image/jpeg' })
	   *   document.querySelector('#photo').src = URL.createObjectURL(blob)
	   */
	  resolve: (doc, node) => {
	    const src = resolveSeq4a68b39b.resolveString(doc, node);

	    if (typeof Buffer === 'function') {
	      return Buffer.from(src, 'base64');
	    } else if (typeof atob === 'function') {
	      // On IE 11, atob() can't handle newlines
	      const str = atob(src.replace(/[\n\r]/g, ''));
	      const buffer = new Uint8Array(str.length);

	      for (let i = 0; i < str.length; ++i) buffer[i] = str.charCodeAt(i);

	      return buffer;
	    } else {
	      const msg = 'This environment does not support reading binary tags; either Buffer or atob is required';
	      doc.errors.push(new PlainValueEc8e588e.YAMLReferenceError(node, msg));
	      return null;
	    }
	  },
	  options: resolveSeq4a68b39b.binaryOptions,
	  stringify: ({
	    comment,
	    type,
	    value
	  }, ctx, onComment, onChompKeep) => {
	    let src;

	    if (typeof Buffer === 'function') {
	      src = value instanceof Buffer ? value.toString('base64') : Buffer.from(value.buffer).toString('base64');
	    } else if (typeof btoa === 'function') {
	      let s = '';

	      for (let i = 0; i < value.length; ++i) s += String.fromCharCode(value[i]);

	      src = btoa(s);
	    } else {
	      throw new Error('This environment does not support writing binary tags; either Buffer or btoa is required');
	    }

	    if (!type) type = resolveSeq4a68b39b.binaryOptions.defaultType;

	    if (type === PlainValueEc8e588e.Type.QUOTE_DOUBLE) {
	      value = src;
	    } else {
	      const {
	        lineWidth
	      } = resolveSeq4a68b39b.binaryOptions;
	      const n = Math.ceil(src.length / lineWidth);
	      const lines = new Array(n);

	      for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
	        lines[i] = src.substr(o, lineWidth);
	      }

	      value = lines.join(type === PlainValueEc8e588e.Type.BLOCK_LITERAL ? '\n' : ' ');
	    }

	    return resolveSeq4a68b39b.stringifyString({
	      comment,
	      type,
	      value
	    }, ctx, onComment, onChompKeep);
	  }
	};

	function parsePairs(doc, cst) {
	  const seq = resolveSeq4a68b39b.resolveSeq(doc, cst);

	  for (let i = 0; i < seq.items.length; ++i) {
	    let item = seq.items[i];
	    if (item instanceof resolveSeq4a68b39b.Pair) continue;else if (item instanceof resolveSeq4a68b39b.YAMLMap) {
	      if (item.items.length > 1) {
	        const msg = 'Each pair must have its own sequence indicator';
	        throw new PlainValueEc8e588e.YAMLSemanticError(cst, msg);
	      }

	      const pair = item.items[0] || new resolveSeq4a68b39b.Pair();
	      if (item.commentBefore) pair.commentBefore = pair.commentBefore ? `${item.commentBefore}\n${pair.commentBefore}` : item.commentBefore;
	      if (item.comment) pair.comment = pair.comment ? `${item.comment}\n${pair.comment}` : item.comment;
	      item = pair;
	    }
	    seq.items[i] = item instanceof resolveSeq4a68b39b.Pair ? item : new resolveSeq4a68b39b.Pair(item);
	  }

	  return seq;
	}
	function createPairs(schema, iterable, ctx) {
	  const pairs = new resolveSeq4a68b39b.YAMLSeq(schema);
	  pairs.tag = 'tag:yaml.org,2002:pairs';

	  for (const it of iterable) {
	    let key, value;

	    if (Array.isArray(it)) {
	      if (it.length === 2) {
	        key = it[0];
	        value = it[1];
	      } else throw new TypeError(`Expected [key, value] tuple: ${it}`);
	    } else if (it && it instanceof Object) {
	      const keys = Object.keys(it);

	      if (keys.length === 1) {
	        key = keys[0];
	        value = it[key];
	      } else throw new TypeError(`Expected { key: value } tuple: ${it}`);
	    } else {
	      key = it;
	    }

	    const pair = schema.createPair(key, value, ctx);
	    pairs.items.push(pair);
	  }

	  return pairs;
	}
	const pairs = {
	  default: false,
	  tag: 'tag:yaml.org,2002:pairs',
	  resolve: parsePairs,
	  createNode: createPairs
	};

	class YAMLOMap extends resolveSeq4a68b39b.YAMLSeq {
	  constructor() {
	    super();

	    PlainValueEc8e588e._defineProperty(this, "add", resolveSeq4a68b39b.YAMLMap.prototype.add.bind(this));

	    PlainValueEc8e588e._defineProperty(this, "delete", resolveSeq4a68b39b.YAMLMap.prototype.delete.bind(this));

	    PlainValueEc8e588e._defineProperty(this, "get", resolveSeq4a68b39b.YAMLMap.prototype.get.bind(this));

	    PlainValueEc8e588e._defineProperty(this, "has", resolveSeq4a68b39b.YAMLMap.prototype.has.bind(this));

	    PlainValueEc8e588e._defineProperty(this, "set", resolveSeq4a68b39b.YAMLMap.prototype.set.bind(this));

	    this.tag = YAMLOMap.tag;
	  }

	  toJSON(_, ctx) {
	    const map = new Map();
	    if (ctx && ctx.onCreate) ctx.onCreate(map);

	    for (const pair of this.items) {
	      let key, value;

	      if (pair instanceof resolveSeq4a68b39b.Pair) {
	        key = resolveSeq4a68b39b.toJSON(pair.key, '', ctx);
	        value = resolveSeq4a68b39b.toJSON(pair.value, key, ctx);
	      } else {
	        key = resolveSeq4a68b39b.toJSON(pair, '', ctx);
	      }

	      if (map.has(key)) throw new Error('Ordered maps must not include duplicate keys');
	      map.set(key, value);
	    }

	    return map;
	  }

	}

	PlainValueEc8e588e._defineProperty(YAMLOMap, "tag", 'tag:yaml.org,2002:omap');

	function parseOMap(doc, cst) {
	  const pairs = parsePairs(doc, cst);
	  const seenKeys = [];

	  for (const {
	    key
	  } of pairs.items) {
	    if (key instanceof resolveSeq4a68b39b.Scalar) {
	      if (seenKeys.includes(key.value)) {
	        const msg = 'Ordered maps must not include duplicate keys';
	        throw new PlainValueEc8e588e.YAMLSemanticError(cst, msg);
	      } else {
	        seenKeys.push(key.value);
	      }
	    }
	  }

	  return Object.assign(new YAMLOMap(), pairs);
	}

	function createOMap(schema, iterable, ctx) {
	  const pairs = createPairs(schema, iterable, ctx);
	  const omap = new YAMLOMap();
	  omap.items = pairs.items;
	  return omap;
	}

	const omap = {
	  identify: value => value instanceof Map,
	  nodeClass: YAMLOMap,
	  default: false,
	  tag: 'tag:yaml.org,2002:omap',
	  resolve: parseOMap,
	  createNode: createOMap
	};

	class YAMLSet extends resolveSeq4a68b39b.YAMLMap {
	  constructor() {
	    super();
	    this.tag = YAMLSet.tag;
	  }

	  add(key) {
	    const pair = key instanceof resolveSeq4a68b39b.Pair ? key : new resolveSeq4a68b39b.Pair(key);
	    const prev = resolveSeq4a68b39b.findPair(this.items, pair.key);
	    if (!prev) this.items.push(pair);
	  }

	  get(key, keepPair) {
	    const pair = resolveSeq4a68b39b.findPair(this.items, key);
	    return !keepPair && pair instanceof resolveSeq4a68b39b.Pair ? pair.key instanceof resolveSeq4a68b39b.Scalar ? pair.key.value : pair.key : pair;
	  }

	  set(key, value) {
	    if (typeof value !== 'boolean') throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
	    const prev = resolveSeq4a68b39b.findPair(this.items, key);

	    if (prev && !value) {
	      this.items.splice(this.items.indexOf(prev), 1);
	    } else if (!prev && value) {
	      this.items.push(new resolveSeq4a68b39b.Pair(key));
	    }
	  }

	  toJSON(_, ctx) {
	    return super.toJSON(_, ctx, Set);
	  }

	  toString(ctx, onComment, onChompKeep) {
	    if (!ctx) return JSON.stringify(this);
	    if (this.hasAllNullValues()) return super.toString(ctx, onComment, onChompKeep);else throw new Error('Set items must all have null values');
	  }

	}

	PlainValueEc8e588e._defineProperty(YAMLSet, "tag", 'tag:yaml.org,2002:set');

	function parseSet(doc, cst) {
	  const map = resolveSeq4a68b39b.resolveMap(doc, cst);
	  if (!map.hasAllNullValues()) throw new PlainValueEc8e588e.YAMLSemanticError(cst, 'Set items must all have null values');
	  return Object.assign(new YAMLSet(), map);
	}

	function createSet(schema, iterable, ctx) {
	  const set = new YAMLSet();

	  for (const value of iterable) set.items.push(schema.createPair(value, null, ctx));

	  return set;
	}

	const set = {
	  identify: value => value instanceof Set,
	  nodeClass: YAMLSet,
	  default: false,
	  tag: 'tag:yaml.org,2002:set',
	  resolve: parseSet,
	  createNode: createSet
	};

	const parseSexagesimal = (sign, parts) => {
	  const n = parts.split(':').reduce((n, p) => n * 60 + Number(p), 0);
	  return sign === '-' ? -n : n;
	}; // hhhh:mm:ss.sss


	const stringifySexagesimal = ({
	  value
	}) => {
	  if (isNaN(value) || !isFinite(value)) return resolveSeq4a68b39b.stringifyNumber(value);
	  let sign = '';

	  if (value < 0) {
	    sign = '-';
	    value = Math.abs(value);
	  }

	  const parts = [value % 60]; // seconds, including ms

	  if (value < 60) {
	    parts.unshift(0); // at least one : is required
	  } else {
	    value = Math.round((value - parts[0]) / 60);
	    parts.unshift(value % 60); // minutes

	    if (value >= 60) {
	      value = Math.round((value - parts[0]) / 60);
	      parts.unshift(value); // hours
	    }
	  }

	  return sign + parts.map(n => n < 10 ? '0' + String(n) : String(n)).join(':').replace(/000000\d*$/, '') // % 60 may introduce error
	  ;
	};

	const intTime = {
	  identify: value => typeof value === 'number',
	  default: true,
	  tag: 'tag:yaml.org,2002:int',
	  format: 'TIME',
	  test: /^([-+]?)([0-9][0-9_]*(?::[0-5]?[0-9])+)$/,
	  resolve: (str, sign, parts) => parseSexagesimal(sign, parts.replace(/_/g, '')),
	  stringify: stringifySexagesimal
	};
	const floatTime = {
	  identify: value => typeof value === 'number',
	  default: true,
	  tag: 'tag:yaml.org,2002:float',
	  format: 'TIME',
	  test: /^([-+]?)([0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*)$/,
	  resolve: (str, sign, parts) => parseSexagesimal(sign, parts.replace(/_/g, '')),
	  stringify: stringifySexagesimal
	};
	const timestamp = {
	  identify: value => value instanceof Date,
	  default: true,
	  tag: 'tag:yaml.org,2002:timestamp',
	  // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
	  // may be omitted altogether, resulting in a date format. In such a case, the time part is
	  // assumed to be 00:00:00Z (start of day, UTC).
	  test: RegExp('^(?:' + '([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})' + // YYYY-Mm-Dd
	  '(?:(?:t|T|[ \\t]+)' + // t | T | whitespace
	  '([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)' + // Hh:Mm:Ss(.ss)?
	  '(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?' + // Z | +5 | -03:30
	  ')?' + ')$'),
	  resolve: (str, year, month, day, hour, minute, second, millisec, tz) => {
	    if (millisec) millisec = (millisec + '00').substr(1, 3);
	    let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec || 0);

	    if (tz && tz !== 'Z') {
	      let d = parseSexagesimal(tz[0], tz.slice(1));
	      if (Math.abs(d) < 30) d *= 60;
	      date -= 60000 * d;
	    }

	    return new Date(date);
	  },
	  stringify: ({
	    value
	  }) => value.toISOString().replace(/((T00:00)?:00)?\.000Z$/, '')
	};

	/* global console, process, YAML_SILENCE_DEPRECATION_WARNINGS, YAML_SILENCE_WARNINGS */
	function shouldWarn(deprecation) {
	  const env = typeof process !== 'undefined' && process.env || {};

	  if (deprecation) {
	    if (typeof YAML_SILENCE_DEPRECATION_WARNINGS !== 'undefined') return !YAML_SILENCE_DEPRECATION_WARNINGS;
	    return !env.YAML_SILENCE_DEPRECATION_WARNINGS;
	  }

	  if (typeof YAML_SILENCE_WARNINGS !== 'undefined') return !YAML_SILENCE_WARNINGS;
	  return !env.YAML_SILENCE_WARNINGS;
	}

	function warn(warning, type) {
	  if (shouldWarn(false)) {
	    const emit = typeof process !== 'undefined' && process.emitWarning; // This will throw in Jest if `warning` is an Error instance due to
	    // https://github.com/facebook/jest/issues/2549

	    if (emit) emit(warning, type);else {
	      // eslint-disable-next-line no-console
	      console.warn(type ? `${type}: ${warning}` : warning);
	    }
	  }
	}
	function warnFileDeprecation(filename) {
	  if (shouldWarn(true)) {
	    const path = filename.replace(/.*yaml[/\\]/i, '').replace(/\.js$/, '').replace(/\\/g, '/');
	    warn(`The endpoint 'yaml/${path}' will be removed in a future release.`, 'DeprecationWarning');
	  }
	}
	const warned = {};
	function warnOptionDeprecation(name, alternative) {
	  if (!warned[name] && shouldWarn(true)) {
	    warned[name] = true;
	    let msg = `The option '${name}' will be removed in a future release`;
	    msg += alternative ? `, use '${alternative}' instead.` : '.';
	    warn(msg, 'DeprecationWarning');
	  }
	}

	var binary_1 = binary;
	var floatTime_1 = floatTime;
	var intTime_1 = intTime;
	var omap_1 = omap;
	var pairs_1 = pairs;
	var set_1 = set;
	var timestamp_1 = timestamp;
	var warn_1 = warn;
	var warnFileDeprecation_1 = warnFileDeprecation;
	var warnOptionDeprecation_1 = warnOptionDeprecation;

	var warnings39684f17 = {
		binary: binary_1,
		floatTime: floatTime_1,
		intTime: intTime_1,
		omap: omap_1,
		pairs: pairs_1,
		set: set_1,
		timestamp: timestamp_1,
		warn: warn_1,
		warnFileDeprecation: warnFileDeprecation_1,
		warnOptionDeprecation: warnOptionDeprecation_1
	};

	function createMap(schema, obj, ctx) {
	  const map = new resolveSeq4a68b39b.YAMLMap(schema);

	  if (obj instanceof Map) {
	    for (const [key, value] of obj) map.items.push(schema.createPair(key, value, ctx));
	  } else if (obj && typeof obj === 'object') {
	    for (const key of Object.keys(obj)) map.items.push(schema.createPair(key, obj[key], ctx));
	  }

	  if (typeof schema.sortMapEntries === 'function') {
	    map.items.sort(schema.sortMapEntries);
	  }

	  return map;
	}

	const map = {
	  createNode: createMap,
	  default: true,
	  nodeClass: resolveSeq4a68b39b.YAMLMap,
	  tag: 'tag:yaml.org,2002:map',
	  resolve: resolveSeq4a68b39b.resolveMap
	};

	function createSeq(schema, obj, ctx) {
	  const seq = new resolveSeq4a68b39b.YAMLSeq(schema);

	  if (obj && obj[Symbol.iterator]) {
	    for (const it of obj) {
	      const v = schema.createNode(it, ctx.wrapScalars, null, ctx);
	      seq.items.push(v);
	    }
	  }

	  return seq;
	}

	const seq = {
	  createNode: createSeq,
	  default: true,
	  nodeClass: resolveSeq4a68b39b.YAMLSeq,
	  tag: 'tag:yaml.org,2002:seq',
	  resolve: resolveSeq4a68b39b.resolveSeq
	};

	const string = {
	  identify: value => typeof value === 'string',
	  default: true,
	  tag: 'tag:yaml.org,2002:str',
	  resolve: resolveSeq4a68b39b.resolveString,

	  stringify(item, ctx, onComment, onChompKeep) {
	    ctx = Object.assign({
	      actualString: true
	    }, ctx);
	    return resolveSeq4a68b39b.stringifyString(item, ctx, onComment, onChompKeep);
	  },

	  options: resolveSeq4a68b39b.strOptions
	};

	const failsafe = [map, seq, string];

	/* global BigInt */

	const intIdentify = value => typeof value === 'bigint' || Number.isInteger(value);

	const intResolve = (src, part, radix) => resolveSeq4a68b39b.intOptions.asBigInt ? BigInt(src) : parseInt(part, radix);

	function intStringify(node, radix, prefix) {
	  const {
	    value
	  } = node;
	  if (intIdentify(value) && value >= 0) return prefix + value.toString(radix);
	  return resolveSeq4a68b39b.stringifyNumber(node);
	}

	const nullObj = {
	  identify: value => value == null,
	  createNode: (schema, value, ctx) => ctx.wrapScalars ? new resolveSeq4a68b39b.Scalar(null) : null,
	  default: true,
	  tag: 'tag:yaml.org,2002:null',
	  test: /^(?:~|[Nn]ull|NULL)?$/,
	  resolve: () => null,
	  options: resolveSeq4a68b39b.nullOptions,
	  stringify: () => resolveSeq4a68b39b.nullOptions.nullStr
	};
	const boolObj = {
	  identify: value => typeof value === 'boolean',
	  default: true,
	  tag: 'tag:yaml.org,2002:bool',
	  test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
	  resolve: str => str[0] === 't' || str[0] === 'T',
	  options: resolveSeq4a68b39b.boolOptions,
	  stringify: ({
	    value
	  }) => value ? resolveSeq4a68b39b.boolOptions.trueStr : resolveSeq4a68b39b.boolOptions.falseStr
	};
	const octObj = {
	  identify: value => intIdentify(value) && value >= 0,
	  default: true,
	  tag: 'tag:yaml.org,2002:int',
	  format: 'OCT',
	  test: /^0o([0-7]+)$/,
	  resolve: (str, oct) => intResolve(str, oct, 8),
	  options: resolveSeq4a68b39b.intOptions,
	  stringify: node => intStringify(node, 8, '0o')
	};
	const intObj = {
	  identify: intIdentify,
	  default: true,
	  tag: 'tag:yaml.org,2002:int',
	  test: /^[-+]?[0-9]+$/,
	  resolve: str => intResolve(str, str, 10),
	  options: resolveSeq4a68b39b.intOptions,
	  stringify: resolveSeq4a68b39b.stringifyNumber
	};
	const hexObj = {
	  identify: value => intIdentify(value) && value >= 0,
	  default: true,
	  tag: 'tag:yaml.org,2002:int',
	  format: 'HEX',
	  test: /^0x([0-9a-fA-F]+)$/,
	  resolve: (str, hex) => intResolve(str, hex, 16),
	  options: resolveSeq4a68b39b.intOptions,
	  stringify: node => intStringify(node, 16, '0x')
	};
	const nanObj = {
	  identify: value => typeof value === 'number',
	  default: true,
	  tag: 'tag:yaml.org,2002:float',
	  test: /^(?:[-+]?\.inf|(\.nan))$/i,
	  resolve: (str, nan) => nan ? NaN : str[0] === '-' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
	  stringify: resolveSeq4a68b39b.stringifyNumber
	};
	const expObj = {
	  identify: value => typeof value === 'number',
	  default: true,
	  tag: 'tag:yaml.org,2002:float',
	  format: 'EXP',
	  test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
	  resolve: str => parseFloat(str),
	  stringify: ({
	    value
	  }) => Number(value).toExponential()
	};
	const floatObj = {
	  identify: value => typeof value === 'number',
	  default: true,
	  tag: 'tag:yaml.org,2002:float',
	  test: /^[-+]?(?:\.([0-9]+)|[0-9]+\.([0-9]*))$/,

	  resolve(str, frac1, frac2) {
	    const frac = frac1 || frac2;
	    const node = new resolveSeq4a68b39b.Scalar(parseFloat(str));
	    if (frac && frac[frac.length - 1] === '0') node.minFractionDigits = frac.length;
	    return node;
	  },

	  stringify: resolveSeq4a68b39b.stringifyNumber
	};
	const core = failsafe.concat([nullObj, boolObj, octObj, intObj, hexObj, nanObj, expObj, floatObj]);

	/* global BigInt */

	const intIdentify$1 = value => typeof value === 'bigint' || Number.isInteger(value);

	const stringifyJSON = ({
	  value
	}) => JSON.stringify(value);

	const json = [map, seq, {
	  identify: value => typeof value === 'string',
	  default: true,
	  tag: 'tag:yaml.org,2002:str',
	  resolve: resolveSeq4a68b39b.resolveString,
	  stringify: stringifyJSON
	}, {
	  identify: value => value == null,
	  createNode: (schema, value, ctx) => ctx.wrapScalars ? new resolveSeq4a68b39b.Scalar(null) : null,
	  default: true,
	  tag: 'tag:yaml.org,2002:null',
	  test: /^null$/,
	  resolve: () => null,
	  stringify: stringifyJSON
	}, {
	  identify: value => typeof value === 'boolean',
	  default: true,
	  tag: 'tag:yaml.org,2002:bool',
	  test: /^true|false$/,
	  resolve: str => str === 'true',
	  stringify: stringifyJSON
	}, {
	  identify: intIdentify$1,
	  default: true,
	  tag: 'tag:yaml.org,2002:int',
	  test: /^-?(?:0|[1-9][0-9]*)$/,
	  resolve: str => resolveSeq4a68b39b.intOptions.asBigInt ? BigInt(str) : parseInt(str, 10),
	  stringify: ({
	    value
	  }) => intIdentify$1(value) ? value.toString() : JSON.stringify(value)
	}, {
	  identify: value => typeof value === 'number',
	  default: true,
	  tag: 'tag:yaml.org,2002:float',
	  test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
	  resolve: str => parseFloat(str),
	  stringify: stringifyJSON
	}];

	json.scalarFallback = str => {
	  throw new SyntaxError(`Unresolved plain scalar ${JSON.stringify(str)}`);
	};

	/* global BigInt */

	const boolStringify = ({
	  value
	}) => value ? resolveSeq4a68b39b.boolOptions.trueStr : resolveSeq4a68b39b.boolOptions.falseStr;

	const intIdentify$2 = value => typeof value === 'bigint' || Number.isInteger(value);

	function intResolve$1(sign, src, radix) {
	  let str = src.replace(/_/g, '');

	  if (resolveSeq4a68b39b.intOptions.asBigInt) {
	    switch (radix) {
	      case 2:
	        str = `0b${str}`;
	        break;

	      case 8:
	        str = `0o${str}`;
	        break;

	      case 16:
	        str = `0x${str}`;
	        break;
	    }

	    const n = BigInt(str);
	    return sign === '-' ? BigInt(-1) * n : n;
	  }

	  const n = parseInt(str, radix);
	  return sign === '-' ? -1 * n : n;
	}

	function intStringify$1(node, radix, prefix) {
	  const {
	    value
	  } = node;

	  if (intIdentify$2(value)) {
	    const str = value.toString(radix);
	    return value < 0 ? '-' + prefix + str.substr(1) : prefix + str;
	  }

	  return resolveSeq4a68b39b.stringifyNumber(node);
	}

	const yaml11 = failsafe.concat([{
	  identify: value => value == null,
	  createNode: (schema, value, ctx) => ctx.wrapScalars ? new resolveSeq4a68b39b.Scalar(null) : null,
	  default: true,
	  tag: 'tag:yaml.org,2002:null',
	  test: /^(?:~|[Nn]ull|NULL)?$/,
	  resolve: () => null,
	  options: resolveSeq4a68b39b.nullOptions,
	  stringify: () => resolveSeq4a68b39b.nullOptions.nullStr
	}, {
	  identify: value => typeof value === 'boolean',
	  default: true,
	  tag: 'tag:yaml.org,2002:bool',
	  test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
	  resolve: () => true,
	  options: resolveSeq4a68b39b.boolOptions,
	  stringify: boolStringify
	}, {
	  identify: value => typeof value === 'boolean',
	  default: true,
	  tag: 'tag:yaml.org,2002:bool',
	  test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/i,
	  resolve: () => false,
	  options: resolveSeq4a68b39b.boolOptions,
	  stringify: boolStringify
	}, {
	  identify: intIdentify$2,
	  default: true,
	  tag: 'tag:yaml.org,2002:int',
	  format: 'BIN',
	  test: /^([-+]?)0b([0-1_]+)$/,
	  resolve: (str, sign, bin) => intResolve$1(sign, bin, 2),
	  stringify: node => intStringify$1(node, 2, '0b')
	}, {
	  identify: intIdentify$2,
	  default: true,
	  tag: 'tag:yaml.org,2002:int',
	  format: 'OCT',
	  test: /^([-+]?)0([0-7_]+)$/,
	  resolve: (str, sign, oct) => intResolve$1(sign, oct, 8),
	  stringify: node => intStringify$1(node, 8, '0')
	}, {
	  identify: intIdentify$2,
	  default: true,
	  tag: 'tag:yaml.org,2002:int',
	  test: /^([-+]?)([0-9][0-9_]*)$/,
	  resolve: (str, sign, abs) => intResolve$1(sign, abs, 10),
	  stringify: resolveSeq4a68b39b.stringifyNumber
	}, {
	  identify: intIdentify$2,
	  default: true,
	  tag: 'tag:yaml.org,2002:int',
	  format: 'HEX',
	  test: /^([-+]?)0x([0-9a-fA-F_]+)$/,
	  resolve: (str, sign, hex) => intResolve$1(sign, hex, 16),
	  stringify: node => intStringify$1(node, 16, '0x')
	}, {
	  identify: value => typeof value === 'number',
	  default: true,
	  tag: 'tag:yaml.org,2002:float',
	  test: /^(?:[-+]?\.inf|(\.nan))$/i,
	  resolve: (str, nan) => nan ? NaN : str[0] === '-' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
	  stringify: resolveSeq4a68b39b.stringifyNumber
	}, {
	  identify: value => typeof value === 'number',
	  default: true,
	  tag: 'tag:yaml.org,2002:float',
	  format: 'EXP',
	  test: /^[-+]?([0-9][0-9_]*)?(\.[0-9_]*)?[eE][-+]?[0-9]+$/,
	  resolve: str => parseFloat(str.replace(/_/g, '')),
	  stringify: ({
	    value
	  }) => Number(value).toExponential()
	}, {
	  identify: value => typeof value === 'number',
	  default: true,
	  tag: 'tag:yaml.org,2002:float',
	  test: /^[-+]?(?:[0-9][0-9_]*)?\.([0-9_]*)$/,

	  resolve(str, frac) {
	    const node = new resolveSeq4a68b39b.Scalar(parseFloat(str.replace(/_/g, '')));

	    if (frac) {
	      const f = frac.replace(/_/g, '');
	      if (f[f.length - 1] === '0') node.minFractionDigits = f.length;
	    }

	    return node;
	  },

	  stringify: resolveSeq4a68b39b.stringifyNumber
	}], warnings39684f17.binary, warnings39684f17.omap, warnings39684f17.pairs, warnings39684f17.set, warnings39684f17.intTime, warnings39684f17.floatTime, warnings39684f17.timestamp);

	const schemas = {
	  core,
	  failsafe,
	  json,
	  yaml11
	};
	const tags = {
	  binary: warnings39684f17.binary,
	  bool: boolObj,
	  float: floatObj,
	  floatExp: expObj,
	  floatNaN: nanObj,
	  floatTime: warnings39684f17.floatTime,
	  int: intObj,
	  intHex: hexObj,
	  intOct: octObj,
	  intTime: warnings39684f17.intTime,
	  map,
	  null: nullObj,
	  omap: warnings39684f17.omap,
	  pairs: warnings39684f17.pairs,
	  seq,
	  set: warnings39684f17.set,
	  timestamp: warnings39684f17.timestamp
	};

	function findTagObject(value, tagName, tags) {
	  if (tagName) {
	    const match = tags.filter(t => t.tag === tagName);
	    const tagObj = match.find(t => !t.format) || match[0];
	    if (!tagObj) throw new Error(`Tag ${tagName} not found`);
	    return tagObj;
	  } // TODO: deprecate/remove class check


	  return tags.find(t => (t.identify && t.identify(value) || t.class && value instanceof t.class) && !t.format);
	}

	function createNode(value, tagName, ctx) {
	  if (value instanceof resolveSeq4a68b39b.Node) return value;
	  const {
	    defaultPrefix,
	    onTagObj,
	    prevObjects,
	    schema,
	    wrapScalars
	  } = ctx;
	  if (tagName && tagName.startsWith('!!')) tagName = defaultPrefix + tagName.slice(2);
	  let tagObj = findTagObject(value, tagName, schema.tags);

	  if (!tagObj) {
	    if (typeof value.toJSON === 'function') value = value.toJSON();
	    if (typeof value !== 'object') return wrapScalars ? new resolveSeq4a68b39b.Scalar(value) : value;
	    tagObj = value instanceof Map ? map : value[Symbol.iterator] ? seq : map;
	  }

	  if (onTagObj) {
	    onTagObj(tagObj);
	    delete ctx.onTagObj;
	  } // Detect duplicate references to the same object & use Alias nodes for all
	  // after first. The `obj` wrapper allows for circular references to resolve.


	  const obj = {};

	  if (value && typeof value === 'object' && prevObjects) {
	    const prev = prevObjects.get(value);

	    if (prev) {
	      const alias = new resolveSeq4a68b39b.Alias(prev); // leaves source dirty; must be cleaned by caller

	      ctx.aliasNodes.push(alias); // defined along with prevObjects

	      return alias;
	    }

	    obj.value = value;
	    prevObjects.set(value, obj);
	  }

	  obj.node = tagObj.createNode ? tagObj.createNode(ctx.schema, value, ctx) : wrapScalars ? new resolveSeq4a68b39b.Scalar(value) : value;
	  if (tagName && obj.node instanceof resolveSeq4a68b39b.Node) obj.node.tag = tagName;
	  return obj.node;
	}

	function getSchemaTags(schemas, knownTags, customTags, schemaId) {
	  let tags = schemas[schemaId.replace(/\W/g, '')]; // 'yaml-1.1' -> 'yaml11'

	  if (!tags) {
	    const keys = Object.keys(schemas).map(key => JSON.stringify(key)).join(', ');
	    throw new Error(`Unknown schema "${schemaId}"; use one of ${keys}`);
	  }

	  if (Array.isArray(customTags)) {
	    for (const tag of customTags) tags = tags.concat(tag);
	  } else if (typeof customTags === 'function') {
	    tags = customTags(tags.slice());
	  }

	  for (let i = 0; i < tags.length; ++i) {
	    const tag = tags[i];

	    if (typeof tag === 'string') {
	      const tagObj = knownTags[tag];

	      if (!tagObj) {
	        const keys = Object.keys(knownTags).map(key => JSON.stringify(key)).join(', ');
	        throw new Error(`Unknown custom tag "${tag}"; use one of ${keys}`);
	      }

	      tags[i] = tagObj;
	    }
	  }

	  return tags;
	}

	const sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

	class Schema {
	  // TODO: remove in v2
	  // TODO: remove in v2
	  constructor({
	    customTags,
	    merge,
	    schema,
	    sortMapEntries,
	    tags: deprecatedCustomTags
	  }) {
	    this.merge = !!merge;
	    this.name = schema;
	    this.sortMapEntries = sortMapEntries === true ? sortMapEntriesByKey : sortMapEntries || null;
	    if (!customTags && deprecatedCustomTags) warnings39684f17.warnOptionDeprecation('tags', 'customTags');
	    this.tags = getSchemaTags(schemas, tags, customTags || deprecatedCustomTags, schema);
	  }

	  createNode(value, wrapScalars, tagName, ctx) {
	    const baseCtx = {
	      defaultPrefix: Schema.defaultPrefix,
	      schema: this,
	      wrapScalars
	    };
	    const createCtx = ctx ? Object.assign(ctx, baseCtx) : baseCtx;
	    return createNode(value, tagName, createCtx);
	  }

	  createPair(key, value, ctx) {
	    if (!ctx) ctx = {
	      wrapScalars: true
	    };
	    const k = this.createNode(key, ctx.wrapScalars, null, ctx);
	    const v = this.createNode(value, ctx.wrapScalars, null, ctx);
	    return new resolveSeq4a68b39b.Pair(k, v);
	  }

	}

	PlainValueEc8e588e._defineProperty(Schema, "defaultPrefix", PlainValueEc8e588e.defaultTagPrefix);

	PlainValueEc8e588e._defineProperty(Schema, "defaultTags", PlainValueEc8e588e.defaultTags);

	var Schema_1 = Schema;

	var Schema42e9705c = {
		Schema: Schema_1
	};

	const defaultOptions = {
	  anchorPrefix: 'a',
	  customTags: null,
	  indent: 2,
	  indentSeq: true,
	  keepCstNodes: false,
	  keepNodeTypes: true,
	  keepBlobsInJSON: true,
	  mapAsMap: false,
	  maxAliasCount: 100,
	  prettyErrors: false,
	  // TODO Set true in v2
	  simpleKeys: false,
	  version: '1.2'
	};
	const scalarOptions = {
	  get binary() {
	    return resolveSeq4a68b39b.binaryOptions;
	  },

	  set binary(opt) {
	    Object.assign(resolveSeq4a68b39b.binaryOptions, opt);
	  },

	  get bool() {
	    return resolveSeq4a68b39b.boolOptions;
	  },

	  set bool(opt) {
	    Object.assign(resolveSeq4a68b39b.boolOptions, opt);
	  },

	  get int() {
	    return resolveSeq4a68b39b.intOptions;
	  },

	  set int(opt) {
	    Object.assign(resolveSeq4a68b39b.intOptions, opt);
	  },

	  get null() {
	    return resolveSeq4a68b39b.nullOptions;
	  },

	  set null(opt) {
	    Object.assign(resolveSeq4a68b39b.nullOptions, opt);
	  },

	  get str() {
	    return resolveSeq4a68b39b.strOptions;
	  },

	  set str(opt) {
	    Object.assign(resolveSeq4a68b39b.strOptions, opt);
	  }

	};
	const documentOptions = {
	  '1.0': {
	    schema: 'yaml-1.1',
	    merge: true,
	    tagPrefixes: [{
	      handle: '!',
	      prefix: PlainValueEc8e588e.defaultTagPrefix
	    }, {
	      handle: '!!',
	      prefix: 'tag:private.yaml.org,2002:'
	    }]
	  },
	  '1.1': {
	    schema: 'yaml-1.1',
	    merge: true,
	    tagPrefixes: [{
	      handle: '!',
	      prefix: '!'
	    }, {
	      handle: '!!',
	      prefix: PlainValueEc8e588e.defaultTagPrefix
	    }]
	  },
	  '1.2': {
	    schema: 'core',
	    merge: false,
	    tagPrefixes: [{
	      handle: '!',
	      prefix: '!'
	    }, {
	      handle: '!!',
	      prefix: PlainValueEc8e588e.defaultTagPrefix
	    }]
	  }
	};

	function stringifyTag(doc, tag) {
	  if ((doc.version || doc.options.version) === '1.0') {
	    const priv = tag.match(/^tag:private\.yaml\.org,2002:([^:/]+)$/);
	    if (priv) return '!' + priv[1];
	    const vocab = tag.match(/^tag:([a-zA-Z0-9-]+)\.yaml\.org,2002:(.*)/);
	    return vocab ? `!${vocab[1]}/${vocab[2]}` : `!${tag.replace(/^tag:/, '')}`;
	  }

	  let p = doc.tagPrefixes.find(p => tag.indexOf(p.prefix) === 0);

	  if (!p) {
	    const dtp = doc.getDefaults().tagPrefixes;
	    p = dtp && dtp.find(p => tag.indexOf(p.prefix) === 0);
	  }

	  if (!p) return tag[0] === '!' ? tag : `!<${tag}>`;
	  const suffix = tag.substr(p.prefix.length).replace(/[!,[\]{}]/g, ch => ({
	    '!': '%21',
	    ',': '%2C',
	    '[': '%5B',
	    ']': '%5D',
	    '{': '%7B',
	    '}': '%7D'
	  })[ch]);
	  return p.handle + suffix;
	}

	function getTagObject(tags, item) {
	  if (item instanceof resolveSeq4a68b39b.Alias) return resolveSeq4a68b39b.Alias;

	  if (item.tag) {
	    const match = tags.filter(t => t.tag === item.tag);
	    if (match.length > 0) return match.find(t => t.format === item.format) || match[0];
	  }

	  let tagObj, obj;

	  if (item instanceof resolveSeq4a68b39b.Scalar) {
	    obj = item.value; // TODO: deprecate/remove class check

	    const match = tags.filter(t => t.identify && t.identify(obj) || t.class && obj instanceof t.class);
	    tagObj = match.find(t => t.format === item.format) || match.find(t => !t.format);
	  } else {
	    obj = item;
	    tagObj = tags.find(t => t.nodeClass && obj instanceof t.nodeClass);
	  }

	  if (!tagObj) {
	    const name = obj && obj.constructor ? obj.constructor.name : typeof obj;
	    throw new Error(`Tag not resolved for ${name} value`);
	  }

	  return tagObj;
	} // needs to be called before value stringifier to allow for circular anchor refs


	function stringifyProps(node, tagObj, {
	  anchors,
	  doc
	}) {
	  const props = [];
	  const anchor = doc.anchors.getName(node);

	  if (anchor) {
	    anchors[anchor] = node;
	    props.push(`&${anchor}`);
	  }

	  if (node.tag) {
	    props.push(stringifyTag(doc, node.tag));
	  } else if (!tagObj.default) {
	    props.push(stringifyTag(doc, tagObj.tag));
	  }

	  return props.join(' ');
	}

	function stringify(item, ctx, onComment, onChompKeep) {
	  const {
	    anchors,
	    schema
	  } = ctx.doc;
	  let tagObj;

	  if (!(item instanceof resolveSeq4a68b39b.Node)) {
	    const createCtx = {
	      aliasNodes: [],
	      onTagObj: o => tagObj = o,
	      prevObjects: new Map()
	    };
	    item = schema.createNode(item, true, null, createCtx);

	    for (const alias of createCtx.aliasNodes) {
	      alias.source = alias.source.node;
	      let name = anchors.getName(alias.source);

	      if (!name) {
	        name = anchors.newName();
	        anchors.map[name] = alias.source;
	      }
	    }
	  }

	  if (item instanceof resolveSeq4a68b39b.Pair) return item.toString(ctx, onComment, onChompKeep);
	  if (!tagObj) tagObj = getTagObject(schema.tags, item);
	  const props = stringifyProps(item, tagObj, ctx);
	  if (props.length > 0) ctx.indentAtStart = (ctx.indentAtStart || 0) + props.length + 1;
	  const str = typeof tagObj.stringify === 'function' ? tagObj.stringify(item, ctx, onComment, onChompKeep) : item instanceof resolveSeq4a68b39b.Scalar ? resolveSeq4a68b39b.stringifyString(item, ctx, onComment, onChompKeep) : item.toString(ctx, onComment, onChompKeep);
	  if (!props) return str;
	  return item instanceof resolveSeq4a68b39b.Scalar || str[0] === '{' || str[0] === '[' ? `${props} ${str}` : `${props}\n${ctx.indent}${str}`;
	}

	class Anchors {
	  static validAnchorNode(node) {
	    return node instanceof resolveSeq4a68b39b.Scalar || node instanceof resolveSeq4a68b39b.YAMLSeq || node instanceof resolveSeq4a68b39b.YAMLMap;
	  }

	  constructor(prefix) {
	    PlainValueEc8e588e._defineProperty(this, "map", {});

	    this.prefix = prefix;
	  }

	  createAlias(node, name) {
	    this.setAnchor(node, name);
	    return new resolveSeq4a68b39b.Alias(node);
	  }

	  createMergePair(...sources) {
	    const merge = new resolveSeq4a68b39b.Merge();
	    merge.value.items = sources.map(s => {
	      if (s instanceof resolveSeq4a68b39b.Alias) {
	        if (s.source instanceof resolveSeq4a68b39b.YAMLMap) return s;
	      } else if (s instanceof resolveSeq4a68b39b.YAMLMap) {
	        return this.createAlias(s);
	      }

	      throw new Error('Merge sources must be Map nodes or their Aliases');
	    });
	    return merge;
	  }

	  getName(node) {
	    const {
	      map
	    } = this;
	    return Object.keys(map).find(a => map[a] === node);
	  }

	  getNames() {
	    return Object.keys(this.map);
	  }

	  getNode(name) {
	    return this.map[name];
	  }

	  newName(prefix) {
	    if (!prefix) prefix = this.prefix;
	    const names = Object.keys(this.map);

	    for (let i = 1; true; ++i) {
	      const name = `${prefix}${i}`;
	      if (!names.includes(name)) return name;
	    }
	  } // During parsing, map & aliases contain CST nodes


	  resolveNodes() {
	    const {
	      map,
	      _cstAliases
	    } = this;
	    Object.keys(map).forEach(a => {
	      map[a] = map[a].resolved;
	    });

	    _cstAliases.forEach(a => {
	      a.source = a.source.resolved;
	    });

	    delete this._cstAliases;
	  }

	  setAnchor(node, name) {
	    if (node != null && !Anchors.validAnchorNode(node)) {
	      throw new Error('Anchors may only be set for Scalar, Seq and Map nodes');
	    }

	    if (name && /[\x00-\x19\s,[\]{}]/.test(name)) {
	      throw new Error('Anchor names must not contain whitespace or control characters');
	    }

	    const {
	      map
	    } = this;
	    const prev = node && Object.keys(map).find(a => map[a] === node);

	    if (prev) {
	      if (!name) {
	        return prev;
	      } else if (prev !== name) {
	        delete map[prev];
	        map[name] = node;
	      }
	    } else {
	      if (!name) {
	        if (!node) return null;
	        name = this.newName();
	      }

	      map[name] = node;
	    }

	    return name;
	  }

	}

	const visit = (node, tags) => {
	  if (node && typeof node === 'object') {
	    const {
	      tag
	    } = node;

	    if (node instanceof resolveSeq4a68b39b.Collection) {
	      if (tag) tags[tag] = true;
	      node.items.forEach(n => visit(n, tags));
	    } else if (node instanceof resolveSeq4a68b39b.Pair) {
	      visit(node.key, tags);
	      visit(node.value, tags);
	    } else if (node instanceof resolveSeq4a68b39b.Scalar) {
	      if (tag) tags[tag] = true;
	    }
	  }

	  return tags;
	};

	const listTagNames = node => Object.keys(visit(node, {}));

	function parseContents(doc, contents) {
	  const comments = {
	    before: [],
	    after: []
	  };
	  let body = undefined;
	  let spaceBefore = false;

	  for (const node of contents) {
	    if (node.valueRange) {
	      if (body !== undefined) {
	        const msg = 'Document contains trailing content not separated by a ... or --- line';
	        doc.errors.push(new PlainValueEc8e588e.YAMLSyntaxError(node, msg));
	        break;
	      }

	      const res = resolveSeq4a68b39b.resolveNode(doc, node);

	      if (spaceBefore) {
	        res.spaceBefore = true;
	        spaceBefore = false;
	      }

	      body = res;
	    } else if (node.comment !== null) {
	      const cc = body === undefined ? comments.before : comments.after;
	      cc.push(node.comment);
	    } else if (node.type === PlainValueEc8e588e.Type.BLANK_LINE) {
	      spaceBefore = true;

	      if (body === undefined && comments.before.length > 0 && !doc.commentBefore) {
	        // space-separated comments at start are parsed as document comments
	        doc.commentBefore = comments.before.join('\n');
	        comments.before = [];
	      }
	    }
	  }

	  doc.contents = body || null;

	  if (!body) {
	    doc.comment = comments.before.concat(comments.after).join('\n') || null;
	  } else {
	    const cb = comments.before.join('\n');

	    if (cb) {
	      const cbNode = body instanceof resolveSeq4a68b39b.Collection && body.items[0] ? body.items[0] : body;
	      cbNode.commentBefore = cbNode.commentBefore ? `${cb}\n${cbNode.commentBefore}` : cb;
	    }

	    doc.comment = comments.after.join('\n') || null;
	  }
	}

	function resolveTagDirective({
	  tagPrefixes
	}, directive) {
	  const [handle, prefix] = directive.parameters;

	  if (!handle || !prefix) {
	    const msg = 'Insufficient parameters given for %TAG directive';
	    throw new PlainValueEc8e588e.YAMLSemanticError(directive, msg);
	  }

	  if (tagPrefixes.some(p => p.handle === handle)) {
	    const msg = 'The %TAG directive must only be given at most once per handle in the same document.';
	    throw new PlainValueEc8e588e.YAMLSemanticError(directive, msg);
	  }

	  return {
	    handle,
	    prefix
	  };
	}

	function resolveYamlDirective(doc, directive) {
	  let [version] = directive.parameters;
	  if (directive.name === 'YAML:1.0') version = '1.0';

	  if (!version) {
	    const msg = 'Insufficient parameters given for %YAML directive';
	    throw new PlainValueEc8e588e.YAMLSemanticError(directive, msg);
	  }

	  if (!documentOptions[version]) {
	    const v0 = doc.version || doc.options.version;
	    const msg = `Document will be parsed as YAML ${v0} rather than YAML ${version}`;
	    doc.warnings.push(new PlainValueEc8e588e.YAMLWarning(directive, msg));
	  }

	  return version;
	}

	function parseDirectives(doc, directives, prevDoc) {
	  const directiveComments = [];
	  let hasDirectives = false;

	  for (const directive of directives) {
	    const {
	      comment,
	      name
	    } = directive;

	    switch (name) {
	      case 'TAG':
	        try {
	          doc.tagPrefixes.push(resolveTagDirective(doc, directive));
	        } catch (error) {
	          doc.errors.push(error);
	        }

	        hasDirectives = true;
	        break;

	      case 'YAML':
	      case 'YAML:1.0':
	        if (doc.version) {
	          const msg = 'The %YAML directive must only be given at most once per document.';
	          doc.errors.push(new PlainValueEc8e588e.YAMLSemanticError(directive, msg));
	        }

	        try {
	          doc.version = resolveYamlDirective(doc, directive);
	        } catch (error) {
	          doc.errors.push(error);
	        }

	        hasDirectives = true;
	        break;

	      default:
	        if (name) {
	          const msg = `YAML only supports %TAG and %YAML directives, and not %${name}`;
	          doc.warnings.push(new PlainValueEc8e588e.YAMLWarning(directive, msg));
	        }

	    }

	    if (comment) directiveComments.push(comment);
	  }

	  if (prevDoc && !hasDirectives && '1.1' === (doc.version || prevDoc.version || doc.options.version)) {
	    const copyTagPrefix = ({
	      handle,
	      prefix
	    }) => ({
	      handle,
	      prefix
	    });

	    doc.tagPrefixes = prevDoc.tagPrefixes.map(copyTagPrefix);
	    doc.version = prevDoc.version;
	  }

	  doc.commentBefore = directiveComments.join('\n') || null;
	}

	function assertCollection(contents) {
	  if (contents instanceof resolveSeq4a68b39b.Collection) return true;
	  throw new Error('Expected a YAML collection as document contents');
	}

	class Document$1 {
	  constructor(options) {
	    this.anchors = new Anchors(options.anchorPrefix);
	    this.commentBefore = null;
	    this.comment = null;
	    this.contents = null;
	    this.directivesEndMarker = null;
	    this.errors = [];
	    this.options = options;
	    this.schema = null;
	    this.tagPrefixes = [];
	    this.version = null;
	    this.warnings = [];
	  }

	  add(value) {
	    assertCollection(this.contents);
	    return this.contents.add(value);
	  }

	  addIn(path, value) {
	    assertCollection(this.contents);
	    this.contents.addIn(path, value);
	  }

	  delete(key) {
	    assertCollection(this.contents);
	    return this.contents.delete(key);
	  }

	  deleteIn(path) {
	    if (resolveSeq4a68b39b.isEmptyPath(path)) {
	      if (this.contents == null) return false;
	      this.contents = null;
	      return true;
	    }

	    assertCollection(this.contents);
	    return this.contents.deleteIn(path);
	  }

	  getDefaults() {
	    return Document$1.defaults[this.version] || Document$1.defaults[this.options.version] || {};
	  }

	  get(key, keepScalar) {
	    return this.contents instanceof resolveSeq4a68b39b.Collection ? this.contents.get(key, keepScalar) : undefined;
	  }

	  getIn(path, keepScalar) {
	    if (resolveSeq4a68b39b.isEmptyPath(path)) return !keepScalar && this.contents instanceof resolveSeq4a68b39b.Scalar ? this.contents.value : this.contents;
	    return this.contents instanceof resolveSeq4a68b39b.Collection ? this.contents.getIn(path, keepScalar) : undefined;
	  }

	  has(key) {
	    return this.contents instanceof resolveSeq4a68b39b.Collection ? this.contents.has(key) : false;
	  }

	  hasIn(path) {
	    if (resolveSeq4a68b39b.isEmptyPath(path)) return this.contents !== undefined;
	    return this.contents instanceof resolveSeq4a68b39b.Collection ? this.contents.hasIn(path) : false;
	  }

	  set(key, value) {
	    assertCollection(this.contents);
	    this.contents.set(key, value);
	  }

	  setIn(path, value) {
	    if (resolveSeq4a68b39b.isEmptyPath(path)) this.contents = value;else {
	      assertCollection(this.contents);
	      this.contents.setIn(path, value);
	    }
	  }

	  setSchema(id, customTags) {
	    if (!id && !customTags && this.schema) return;
	    if (typeof id === 'number') id = id.toFixed(1);

	    if (id === '1.0' || id === '1.1' || id === '1.2') {
	      if (this.version) this.version = id;else this.options.version = id;
	      delete this.options.schema;
	    } else if (id && typeof id === 'string') {
	      this.options.schema = id;
	    }

	    if (Array.isArray(customTags)) this.options.customTags = customTags;
	    const opt = Object.assign({}, this.getDefaults(), this.options);
	    this.schema = new Schema42e9705c.Schema(opt);
	  }

	  parse(node, prevDoc) {
	    if (this.options.keepCstNodes) this.cstNode = node;
	    if (this.options.keepNodeTypes) this.type = 'DOCUMENT';
	    const {
	      directives = [],
	      contents = [],
	      directivesEndMarker,
	      error,
	      valueRange
	    } = node;

	    if (error) {
	      if (!error.source) error.source = this;
	      this.errors.push(error);
	    }

	    parseDirectives(this, directives, prevDoc);
	    if (directivesEndMarker) this.directivesEndMarker = true;
	    this.range = valueRange ? [valueRange.start, valueRange.end] : null;
	    this.setSchema();
	    this.anchors._cstAliases = [];
	    parseContents(this, contents);
	    this.anchors.resolveNodes();

	    if (this.options.prettyErrors) {
	      for (const error of this.errors) if (error instanceof PlainValueEc8e588e.YAMLError) error.makePretty();

	      for (const warn of this.warnings) if (warn instanceof PlainValueEc8e588e.YAMLError) warn.makePretty();
	    }

	    return this;
	  }

	  listNonDefaultTags() {
	    return listTagNames(this.contents).filter(t => t.indexOf(Schema42e9705c.Schema.defaultPrefix) !== 0);
	  }

	  setTagPrefix(handle, prefix) {
	    if (handle[0] !== '!' || handle[handle.length - 1] !== '!') throw new Error('Handle must start and end with !');

	    if (prefix) {
	      const prev = this.tagPrefixes.find(p => p.handle === handle);
	      if (prev) prev.prefix = prefix;else this.tagPrefixes.push({
	        handle,
	        prefix
	      });
	    } else {
	      this.tagPrefixes = this.tagPrefixes.filter(p => p.handle !== handle);
	    }
	  }

	  toJSON(arg, onAnchor) {
	    const {
	      keepBlobsInJSON,
	      mapAsMap,
	      maxAliasCount
	    } = this.options;
	    const keep = keepBlobsInJSON && (typeof arg !== 'string' || !(this.contents instanceof resolveSeq4a68b39b.Scalar));
	    const ctx = {
	      doc: this,
	      indentStep: '  ',
	      keep,
	      mapAsMap: keep && !!mapAsMap,
	      maxAliasCount,
	      stringify // Requiring directly in Pair would create circular dependencies

	    };
	    const anchorNames = Object.keys(this.anchors.map);
	    if (anchorNames.length > 0) ctx.anchors = new Map(anchorNames.map(name => [this.anchors.map[name], {
	      alias: [],
	      aliasCount: 0,
	      count: 1
	    }]));
	    const res = resolveSeq4a68b39b.toJSON(this.contents, arg, ctx);
	    if (typeof onAnchor === 'function' && ctx.anchors) for (const {
	      count,
	      res
	    } of ctx.anchors.values()) onAnchor(res, count);
	    return res;
	  }

	  toString() {
	    if (this.errors.length > 0) throw new Error('Document with errors cannot be stringified');
	    const indentSize = this.options.indent;

	    if (!Number.isInteger(indentSize) || indentSize <= 0) {
	      const s = JSON.stringify(indentSize);
	      throw new Error(`"indent" option must be a positive integer, not ${s}`);
	    }

	    this.setSchema();
	    const lines = [];
	    let hasDirectives = false;

	    if (this.version) {
	      let vd = '%YAML 1.2';

	      if (this.schema.name === 'yaml-1.1') {
	        if (this.version === '1.0') vd = '%YAML:1.0';else if (this.version === '1.1') vd = '%YAML 1.1';
	      }

	      lines.push(vd);
	      hasDirectives = true;
	    }

	    const tagNames = this.listNonDefaultTags();
	    this.tagPrefixes.forEach(({
	      handle,
	      prefix
	    }) => {
	      if (tagNames.some(t => t.indexOf(prefix) === 0)) {
	        lines.push(`%TAG ${handle} ${prefix}`);
	        hasDirectives = true;
	      }
	    });
	    if (hasDirectives || this.directivesEndMarker) lines.push('---');

	    if (this.commentBefore) {
	      if (hasDirectives || !this.directivesEndMarker) lines.unshift('');
	      lines.unshift(this.commentBefore.replace(/^/gm, '#'));
	    }

	    const ctx = {
	      anchors: {},
	      doc: this,
	      indent: '',
	      indentStep: ' '.repeat(indentSize),
	      stringify // Requiring directly in nodes would create circular dependencies

	    };
	    let chompKeep = false;
	    let contentComment = null;

	    if (this.contents) {
	      if (this.contents instanceof resolveSeq4a68b39b.Node) {
	        if (this.contents.spaceBefore && (hasDirectives || this.directivesEndMarker)) lines.push('');
	        if (this.contents.commentBefore) lines.push(this.contents.commentBefore.replace(/^/gm, '#')); // top-level block scalars need to be indented if followed by a comment

	        ctx.forceBlockIndent = !!this.comment;
	        contentComment = this.contents.comment;
	      }

	      const onChompKeep = contentComment ? null : () => chompKeep = true;
	      const body = stringify(this.contents, ctx, () => contentComment = null, onChompKeep);
	      lines.push(resolveSeq4a68b39b.addComment(body, '', contentComment));
	    } else if (this.contents !== undefined) {
	      lines.push(stringify(this.contents, ctx));
	    }

	    if (this.comment) {
	      if ((!chompKeep || contentComment) && lines[lines.length - 1] !== '') lines.push('');
	      lines.push(this.comment.replace(/^/gm, '#'));
	    }

	    return lines.join('\n') + '\n';
	  }

	}

	PlainValueEc8e588e._defineProperty(Document$1, "defaults", documentOptions);

	var Document_1 = Document$1;
	var defaultOptions_1 = defaultOptions;
	var scalarOptions_1 = scalarOptions;

	var Document2cf6b08c = {
		Document: Document_1,
		defaultOptions: defaultOptions_1,
		scalarOptions: scalarOptions_1
	};

	function createNode$1(value, wrapScalars = true, tag) {
	  if (tag === undefined && typeof wrapScalars === 'string') {
	    tag = wrapScalars;
	    wrapScalars = true;
	  }

	  const options = Object.assign({}, Document2cf6b08c.Document.defaults[Document2cf6b08c.defaultOptions.version], Document2cf6b08c.defaultOptions);
	  const schema = new Schema42e9705c.Schema(options);
	  return schema.createNode(value, wrapScalars, tag);
	}

	class Document$2 extends Document2cf6b08c.Document {
	  constructor(options) {
	    super(Object.assign({}, Document2cf6b08c.defaultOptions, options));
	  }

	}

	function parseAllDocuments(src, options) {
	  const stream = [];
	  let prev;

	  for (const cstDoc of parseCst.parse(src)) {
	    const doc = new Document$2(options);
	    doc.parse(cstDoc, prev);
	    stream.push(doc);
	    prev = doc;
	  }

	  return stream;
	}

	function parseDocument(src, options) {
	  const cst = parseCst.parse(src);
	  const doc = new Document$2(options).parse(cst[0]);

	  if (cst.length > 1) {
	    const errMsg = 'Source contains multiple documents; please use YAML.parseAllDocuments()';
	    doc.errors.unshift(new PlainValueEc8e588e.YAMLSemanticError(cst[1], errMsg));
	  }

	  return doc;
	}

	function parse$1(src, options) {
	  const doc = parseDocument(src, options);
	  doc.warnings.forEach(warning => warnings39684f17.warn(warning));
	  if (doc.errors.length > 0) throw doc.errors[0];
	  return doc.toJSON();
	}

	function stringify$1(value, options) {
	  const doc = new Document$2(options);
	  doc.contents = value;
	  return String(doc);
	}

	const YAML = {
	  createNode: createNode$1,
	  defaultOptions: Document2cf6b08c.defaultOptions,
	  Document: Document$2,
	  parse: parse$1,
	  parseAllDocuments,
	  parseCST: parseCst.parse,
	  parseDocument,
	  scalarOptions: Document2cf6b08c.scalarOptions,
	  stringify: stringify$1
	};

	var YAML_1 = YAML;

	var dist$1 = {
		YAML: YAML_1
	};

	var yaml = dist$1.YAML;

	var loaders_1 = createCommonjsModule(function (module, exports) {

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	exports.loaders = void 0;

	/* eslint-disable @typescript-eslint/no-require-imports */
	let importFresh$1;

	const loadJs = function loadJs(filepath) {
	  if (importFresh$1 === undefined) {
	    importFresh$1 = importFresh;
	  }

	  const result = importFresh$1(filepath);
	  return result;
	};

	let parseJson;

	const loadJson = function loadJson(filepath, content) {
	  if (parseJson === undefined) {
	    parseJson = parseJson$1;
	  }

	  try {
	    const result = parseJson(content);
	    return result;
	  } catch (error) {
	    error.message = `JSON Error in ${filepath}:\n${error.message}`;
	    throw error;
	  }
	};

	let yaml$1;

	const loadYaml = function loadYaml(filepath, content) {
	  if (yaml$1 === undefined) {
	    yaml$1 = yaml;
	  }

	  try {
	    const result = yaml$1.parse(content, {
	      prettyErrors: true
	    });
	    return result;
	  } catch (error) {
	    error.message = `YAML Error in ${filepath}:\n${error.message}`;
	    throw error;
	  }
	};

	const loaders = {
	  loadJs,
	  loadJson,
	  loadYaml
	};
	exports.loaders = loaders;

	});

	var getPropertyByPath_2 = getPropertyByPath;

	// Resolves property names or property paths defined with period-delimited
	// strings or arrays of strings. Property names that are found on the source
	// object are used directly (even if they include a period).
	// Nested property names that include periods, within a path, are only
	// understood in array paths.
	function getPropertyByPath(source, path) {
	  if (typeof path === 'string' && Object.prototype.hasOwnProperty.call(source, path)) {
	    return source[path];
	  }

	  const parsedPath = typeof path === 'string' ? path.split('.') : path; // eslint-disable-next-line @typescript-eslint/no-explicit-any

	  return parsedPath.reduce((previous, key) => {
	    if (previous === undefined) {
	      return previous;
	    }

	    return previous[key];
	  }, source);
	}


	var getPropertyByPath_1 = /*#__PURE__*/Object.defineProperty({
		getPropertyByPath: getPropertyByPath_2
	}, '__esModule', {value: true});

	var ExplorerBase_1 = createCommonjsModule(function (module, exports) {

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	exports.getExtensionDescription = getExtensionDescription;
	exports.ExplorerBase = void 0;

	var _path = _interopRequireDefault(require$$0__default['default']);





	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

	class ExplorerBase {
	  constructor(options) {
	    if (options.cache === true) {
	      this.loadCache = new Map();
	      this.searchCache = new Map();
	    }

	    this.config = options;
	    this.validateConfig();
	  }

	  clearLoadCache() {
	    if (this.loadCache) {
	      this.loadCache.clear();
	    }
	  }

	  clearSearchCache() {
	    if (this.searchCache) {
	      this.searchCache.clear();
	    }
	  }

	  clearCaches() {
	    this.clearLoadCache();
	    this.clearSearchCache();
	  }

	  validateConfig() {
	    const config = this.config;
	    config.searchPlaces.forEach(place => {
	      const loaderKey = _path.default.extname(place) || 'noExt';
	      const loader = config.loaders[loaderKey];

	      if (!loader) {
	        throw new Error(`No loader specified for ${getExtensionDescription(place)}, so searchPlaces item "${place}" is invalid`);
	      }

	      if (typeof loader !== 'function') {
	        throw new Error(`loader for ${getExtensionDescription(place)} is not a function (type provided: "${typeof loader}"), so searchPlaces item "${place}" is invalid`);
	      }
	    });
	  }

	  shouldSearchStopWithResult(result) {
	    if (result === null) return false;
	    if (result.isEmpty && this.config.ignoreEmptySearchPlaces) return false;
	    return true;
	  }

	  nextDirectoryToSearch(currentDir, currentResult) {
	    if (this.shouldSearchStopWithResult(currentResult)) {
	      return null;
	    }

	    const nextDir = nextDirUp(currentDir);

	    if (nextDir === currentDir || currentDir === this.config.stopDir) {
	      return null;
	    }

	    return nextDir;
	  }

	  loadPackageProp(filepath, content) {
	    const parsedContent = loaders_1.loaders.loadJson(filepath, content);

	    const packagePropValue = (0, getPropertyByPath_1.getPropertyByPath)(parsedContent, this.config.packageProp);
	    return packagePropValue || null;
	  }

	  getLoaderEntryForFile(filepath) {
	    if (_path.default.basename(filepath) === 'package.json') {
	      const loader = this.loadPackageProp.bind(this);
	      return loader;
	    }

	    const loaderKey = _path.default.extname(filepath) || 'noExt';
	    const loader = this.config.loaders[loaderKey];

	    if (!loader) {
	      throw new Error(`No loader specified for ${getExtensionDescription(filepath)}`);
	    }

	    return loader;
	  }

	  loadedContentToCosmiconfigResult(filepath, loadedContent) {
	    if (loadedContent === null) {
	      return null;
	    }

	    if (loadedContent === undefined) {
	      return {
	        filepath,
	        config: undefined,
	        isEmpty: true
	      };
	    }

	    return {
	      config: loadedContent,
	      filepath
	    };
	  }

	  validateFilePath(filepath) {
	    if (!filepath) {
	      throw new Error('load must pass a non-empty string');
	    }
	  }

	}

	exports.ExplorerBase = ExplorerBase;

	function nextDirUp(dir) {
	  return _path.default.dirname(dir);
	}

	function getExtensionDescription(filepath) {
	  const ext = _path.default.extname(filepath);

	  return ext ? `extension "${ext}"` : 'files without extensions';
	}

	});

	var readFile_2 = readFile;
	var readFileSync_1 = readFileSync;

	var _fs = _interopRequireDefault$1(fs__default['default']);

	function _interopRequireDefault$1(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

	async function fsReadFileAsync(pathname, encoding) {
	  return new Promise((resolve, reject) => {
	    _fs.default.readFile(pathname, encoding, (error, contents) => {
	      if (error) {
	        reject(error);
	        return;
	      }

	      resolve(contents);
	    });
	  });
	}

	async function readFile(filepath, options = {}) {
	  const throwNotFound = options.throwNotFound === true;

	  try {
	    const content = await fsReadFileAsync(filepath, 'utf8');
	    return content;
	  } catch (error) {
	    if (throwNotFound === false && error.code === 'ENOENT') {
	      return null;
	    }

	    throw error;
	  }
	}

	function readFileSync(filepath, options = {}) {
	  const throwNotFound = options.throwNotFound === true;

	  try {
	    const content = _fs.default.readFileSync(filepath, 'utf8');

	    return content;
	  } catch (error) {
	    if (throwNotFound === false && error.code === 'ENOENT') {
	      return null;
	    }

	    throw error;
	  }
	}


	var readFile_1 = /*#__PURE__*/Object.defineProperty({
		readFile: readFile_2,
		readFileSync: readFileSync_1
	}, '__esModule', {value: true});

	var cacheWrapper_2 = cacheWrapper;
	var cacheWrapperSync_1 = cacheWrapperSync;

	async function cacheWrapper(cache, key, fn) {
	  const cached = cache.get(key);

	  if (cached !== undefined) {
	    return cached;
	  }

	  const result = await fn();
	  cache.set(key, result);
	  return result;
	}

	function cacheWrapperSync(cache, key, fn) {
	  const cached = cache.get(key);

	  if (cached !== undefined) {
	    return cached;
	  }

	  const result = fn();
	  cache.set(key, result);
	  return result;
	}


	var cacheWrapper_1 = /*#__PURE__*/Object.defineProperty({
		cacheWrapper: cacheWrapper_2,
		cacheWrapperSync: cacheWrapperSync_1
	}, '__esModule', {value: true});

	const {promisify} = util__default['default'];


	async function isType(fsStatType, statsMethodName, filePath) {
		if (typeof filePath !== 'string') {
			throw new TypeError(`Expected a string, got ${typeof filePath}`);
		}

		try {
			const stats = await promisify(fs__default['default'][fsStatType])(filePath);
			return stats[statsMethodName]();
		} catch (error) {
			if (error.code === 'ENOENT') {
				return false;
			}

			throw error;
		}
	}

	function isTypeSync(fsStatType, statsMethodName, filePath) {
		if (typeof filePath !== 'string') {
			throw new TypeError(`Expected a string, got ${typeof filePath}`);
		}

		try {
			return fs__default['default'][fsStatType](filePath)[statsMethodName]();
		} catch (error) {
			if (error.code === 'ENOENT') {
				return false;
			}

			throw error;
		}
	}

	var isFile = isType.bind(null, 'stat', 'isFile');
	var isDirectory = isType.bind(null, 'stat', 'isDirectory');
	var isSymlink = isType.bind(null, 'lstat', 'isSymbolicLink');
	var isFileSync = isTypeSync.bind(null, 'statSync', 'isFile');
	var isDirectorySync = isTypeSync.bind(null, 'statSync', 'isDirectory');
	var isSymlinkSync = isTypeSync.bind(null, 'lstatSync', 'isSymbolicLink');

	var pathType = {
		isFile: isFile,
		isDirectory: isDirectory,
		isSymlink: isSymlink,
		isFileSync: isFileSync,
		isDirectorySync: isDirectorySync,
		isSymlinkSync: isSymlinkSync
	};

	var getDirectory_2 = getDirectory;
	var getDirectorySync_1 = getDirectorySync;

	var _path = _interopRequireDefault$2(require$$0__default['default']);



	function _interopRequireDefault$2(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

	async function getDirectory(filepath) {
	  const filePathIsDirectory = await (0, pathType.isDirectory)(filepath);

	  if (filePathIsDirectory === true) {
	    return filepath;
	  }

	  const directory = _path.default.dirname(filepath);

	  return directory;
	}

	function getDirectorySync(filepath) {
	  const filePathIsDirectory = (0, pathType.isDirectorySync)(filepath);

	  if (filePathIsDirectory === true) {
	    return filepath;
	  }

	  const directory = _path.default.dirname(filepath);

	  return directory;
	}


	var getDirectory_1 = /*#__PURE__*/Object.defineProperty({
		getDirectory: getDirectory_2,
		getDirectorySync: getDirectorySync_1
	}, '__esModule', {value: true});

	var Explorer_1 = createCommonjsModule(function (module, exports) {

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	exports.Explorer = void 0;

	var _path = _interopRequireDefault(require$$0__default['default']);









	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

	class Explorer extends ExplorerBase_1.ExplorerBase {
	  constructor(options) {
	    super(options);
	  }

	  async search(searchFrom = process.cwd()) {
	    const startDirectory = await (0, getDirectory_1.getDirectory)(searchFrom);
	    const result = await this.searchFromDirectory(startDirectory);
	    return result;
	  }

	  async searchFromDirectory(dir) {
	    const absoluteDir = _path.default.resolve(process.cwd(), dir);

	    const run = async () => {
	      const result = await this.searchDirectory(absoluteDir);
	      const nextDir = this.nextDirectoryToSearch(absoluteDir, result);

	      if (nextDir) {
	        return this.searchFromDirectory(nextDir);
	      }

	      const transformResult = await this.config.transform(result);
	      return transformResult;
	    };

	    if (this.searchCache) {
	      return (0, cacheWrapper_1.cacheWrapper)(this.searchCache, absoluteDir, run);
	    }

	    return run();
	  }

	  async searchDirectory(dir) {
	    for await (const place of this.config.searchPlaces) {
	      const placeResult = await this.loadSearchPlace(dir, place);

	      if (this.shouldSearchStopWithResult(placeResult) === true) {
	        return placeResult;
	      }
	    } // config not found


	    return null;
	  }

	  async loadSearchPlace(dir, place) {
	    const filepath = _path.default.join(dir, place);

	    const fileContents = await (0, readFile_1.readFile)(filepath);
	    const result = await this.createCosmiconfigResult(filepath, fileContents);
	    return result;
	  }

	  async loadFileContent(filepath, content) {
	    if (content === null) {
	      return null;
	    }

	    if (content.trim() === '') {
	      return undefined;
	    }

	    const loader = this.getLoaderEntryForFile(filepath);
	    const loaderResult = await loader(filepath, content);
	    return loaderResult;
	  }

	  async createCosmiconfigResult(filepath, content) {
	    const fileContent = await this.loadFileContent(filepath, content);
	    const result = this.loadedContentToCosmiconfigResult(filepath, fileContent);
	    return result;
	  }

	  async load(filepath) {
	    this.validateFilePath(filepath);

	    const absoluteFilePath = _path.default.resolve(process.cwd(), filepath);

	    const runLoad = async () => {
	      const fileContents = await (0, readFile_1.readFile)(absoluteFilePath, {
	        throwNotFound: true
	      });
	      const result = await this.createCosmiconfigResult(absoluteFilePath, fileContents);
	      const transformResult = await this.config.transform(result);
	      return transformResult;
	    };

	    if (this.loadCache) {
	      return (0, cacheWrapper_1.cacheWrapper)(this.loadCache, absoluteFilePath, runLoad);
	    }

	    return runLoad();
	  }

	}

	exports.Explorer = Explorer;

	});

	var ExplorerSync_1 = createCommonjsModule(function (module, exports) {

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	exports.ExplorerSync = void 0;

	var _path = _interopRequireDefault(require$$0__default['default']);









	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

	class ExplorerSync extends ExplorerBase_1.ExplorerBase {
	  constructor(options) {
	    super(options);
	  }

	  searchSync(searchFrom = process.cwd()) {
	    const startDirectory = (0, getDirectory_1.getDirectorySync)(searchFrom);
	    const result = this.searchFromDirectorySync(startDirectory);
	    return result;
	  }

	  searchFromDirectorySync(dir) {
	    const absoluteDir = _path.default.resolve(process.cwd(), dir);

	    const run = () => {
	      const result = this.searchDirectorySync(absoluteDir);
	      const nextDir = this.nextDirectoryToSearch(absoluteDir, result);

	      if (nextDir) {
	        return this.searchFromDirectorySync(nextDir);
	      }

	      const transformResult = this.config.transform(result);
	      return transformResult;
	    };

	    if (this.searchCache) {
	      return (0, cacheWrapper_1.cacheWrapperSync)(this.searchCache, absoluteDir, run);
	    }

	    return run();
	  }

	  searchDirectorySync(dir) {
	    for (const place of this.config.searchPlaces) {
	      const placeResult = this.loadSearchPlaceSync(dir, place);

	      if (this.shouldSearchStopWithResult(placeResult) === true) {
	        return placeResult;
	      }
	    } // config not found


	    return null;
	  }

	  loadSearchPlaceSync(dir, place) {
	    const filepath = _path.default.join(dir, place);

	    const content = (0, readFile_1.readFileSync)(filepath);
	    const result = this.createCosmiconfigResultSync(filepath, content);
	    return result;
	  }

	  loadFileContentSync(filepath, content) {
	    if (content === null) {
	      return null;
	    }

	    if (content.trim() === '') {
	      return undefined;
	    }

	    const loader = this.getLoaderEntryForFile(filepath);
	    const loaderResult = loader(filepath, content);
	    return loaderResult;
	  }

	  createCosmiconfigResultSync(filepath, content) {
	    const fileContent = this.loadFileContentSync(filepath, content);
	    const result = this.loadedContentToCosmiconfigResult(filepath, fileContent);
	    return result;
	  }

	  loadSync(filepath) {
	    this.validateFilePath(filepath);

	    const absoluteFilePath = _path.default.resolve(process.cwd(), filepath);

	    const runLoadSync = () => {
	      const content = (0, readFile_1.readFileSync)(absoluteFilePath, {
	        throwNotFound: true
	      });
	      const cosmiconfigResult = this.createCosmiconfigResultSync(absoluteFilePath, content);
	      const transformResult = this.config.transform(cosmiconfigResult);
	      return transformResult;
	    };

	    if (this.loadCache) {
	      return (0, cacheWrapper_1.cacheWrapperSync)(this.loadCache, absoluteFilePath, runLoadSync);
	    }

	    return runLoadSync();
	  }

	}

	exports.ExplorerSync = ExplorerSync;

	});

	var dist$2 = createCommonjsModule(function (module, exports) {

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	exports.cosmiconfig = cosmiconfig;
	exports.cosmiconfigSync = cosmiconfigSync;
	exports.defaultLoaders = void 0;

	var _os = _interopRequireDefault(os__default['default']);









	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

	/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
	// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
	function cosmiconfig(moduleName, options = {}) {
	  const normalizedOptions = normalizeOptions(moduleName, options);
	  const explorer = new Explorer_1.Explorer(normalizedOptions);
	  return {
	    search: explorer.search.bind(explorer),
	    load: explorer.load.bind(explorer),
	    clearLoadCache: explorer.clearLoadCache.bind(explorer),
	    clearSearchCache: explorer.clearSearchCache.bind(explorer),
	    clearCaches: explorer.clearCaches.bind(explorer)
	  };
	} // eslint-disable-next-line @typescript-eslint/explicit-function-return-type


	function cosmiconfigSync(moduleName, options = {}) {
	  const normalizedOptions = normalizeOptions(moduleName, options);
	  const explorerSync = new ExplorerSync_1.ExplorerSync(normalizedOptions);
	  return {
	    search: explorerSync.searchSync.bind(explorerSync),
	    load: explorerSync.loadSync.bind(explorerSync),
	    clearLoadCache: explorerSync.clearLoadCache.bind(explorerSync),
	    clearSearchCache: explorerSync.clearSearchCache.bind(explorerSync),
	    clearCaches: explorerSync.clearCaches.bind(explorerSync)
	  };
	} // do not allow mutation of default loaders. Make sure it is set inside options


	const defaultLoaders = Object.freeze({
	  '.cjs': loaders_1.loaders.loadJs,
	  '.js': loaders_1.loaders.loadJs,
	  '.json': loaders_1.loaders.loadJson,
	  '.yaml': loaders_1.loaders.loadYaml,
	  '.yml': loaders_1.loaders.loadYaml,
	  noExt: loaders_1.loaders.loadYaml
	});
	exports.defaultLoaders = defaultLoaders;

	const identity = function identity(x) {
	  return x;
	};

	function normalizeOptions(moduleName, options) {
	  const defaults = {
	    packageProp: moduleName,
	    searchPlaces: ['package.json', `.${moduleName}rc`, `.${moduleName}rc.json`, `.${moduleName}rc.yaml`, `.${moduleName}rc.yml`, `.${moduleName}rc.js`, `.${moduleName}rc.cjs`, `${moduleName}.config.js`, `${moduleName}.config.cjs`],
	    ignoreEmptySearchPlaces: true,
	    stopDir: _os.default.homedir(),
	    cache: true,
	    transform: identity,
	    loaders: defaultLoaders
	  };
	  const normalizedOptions = { ...defaults,
	    ...options,
	    loaders: { ...defaults.loaders,
	      ...options.loaders
	    }
	  };
	  return normalizedOptions;
	}

	});

	var _a;


	const explorerSync = dist$2.cosmiconfigSync('jess', {
	    searchPlaces: [
	        '.jessrc.js',
	        'jess.config.js'
	    ]
	});
	let result = ((_a = explorerSync.search()) === null || _a === void 0 ? void 0 : _a.config) || { options: {} };
	if ('default' in result) {
	    result = result.default;
	}
	var _default$4 = result;

	var config = /*#__PURE__*/Object.defineProperty({
		default: _default$4
	}, '__esModule', {value: true});

	var context = createCommonjsModule(function (module, exports) {
	var __importDefault = (commonjsGlobal && commonjsGlobal.__importDefault) || function (mod) {
	    return (mod && mod.__esModule) ? mod : { "default": mod };
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Context = exports.generateId = void 0;
	const config_1 = __importDefault(config);
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
	        this.opts = Object.assign(Object.assign({}, opts), config_1.default.options);
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
	    toString() {
	        const out = new output.OutputCollector;
	        this.toCSS(new context.Context, out);
	        return out.toString();
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

	var jsNode = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.JsNode = void 0;

	/**
	 * A super-type for inheritance checks
	 */
	class JsNode extends tree.Node {
	}
	exports.JsNode = JsNode;
	});

	var atRule = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.atrule = exports.AtRule = void 0;

	/**
	 * A rule like @charset or @media
	 */
	class AtRule extends tree.Node {
	    eval(context) {
	        const node = super.eval(context);
	        /** Don't let rooted rules bubble past an at-rule */
	        if (node.rules) {
	            let rules = node.rules.value;
	            /** Wrap sub-rules of a media query like Less */
	            if (context.frames.length !== 0) {
	                const rule = new tree.Rule({ sels: new tree.List([new tree.Ampersand()]), value: rules })
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
	const atrule = (value, location) => new AtRule(value, location);
	exports.atrule = atrule;
	});

	var ampersand = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.amp = exports.Ampersand = void 0;

	/**
	 * The '&' selector element
	 */
	class Ampersand extends tree.Node {
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
	        return new tree.Nil();
	    }
	    toModule(context, out) {
	        out.add(`$J.amp()`, this.location);
	    }
	}
	exports.Ampersand = Ampersand;
	const amp = (value, location) => new Ampersand(value, location);
	exports.amp = amp;
	});

	var anonymous = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.anon = exports.Anonymous = void 0;

	/**
	 * A generic value that needs to
	 * be escaped for module output
	 */
	class Anonymous extends tree.Node {
	    toModule(context, out) {
	        out.add(`$J.anon(${JSON.stringify(this.value)})`, this.location);
	    }
	}
	exports.Anonymous = Anonymous;
	const anon = (value, location) => new Anonymous(value, location);
	exports.anon = anon;
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
	class JsIdent extends tree.JsNode {
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
	const ident = (value, location) => new JsIdent(value, location);
	exports.ident = ident;
	});

	var call_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.call = exports.Call = void 0;


	/**
	 * A function call
	 */
	class Call extends tree.Node {
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
	        if (value instanceof tree.List) {
	            args = value.value;
	        }
	        else {
	            args = [value];
	        }
	        /**
	         * @todo
	         * Like Less, allow late evaluation?
	         */
	        args = args.map(arg => arg && arg instanceof tree.Node ? arg.eval(context) : arg);
	        /**
	         * The proxied default function returns hashed classes as props,
	         * so to not cause conflicts, Function props like `call` are aliased
	         * as `__call`
	         */
	        const returnVal = ref['$IS_PROXY'] === true
	            ? ref.__call(context, args[0], true)
	            : ref.call(context, ...args);
	        return returnVal instanceof tree.Node ? returnVal.eval(context) : returnVal;
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
	const call = (...args) => new Call(...args);
	exports.call = call;
	});

	var color_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.color = exports.Color = void 0;


	function clamp(v, max) {
	    return Math.min(Math.max(v, 0), max);
	}
	class Color extends tree.Node {
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
	const color = (value, location) => new Color(value, location);
	exports.color = color;
	});

	var combinator = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.co = exports.Combinator = void 0;

	class Combinator extends tree.Anonymous {
	    toCSS(context, out) {
	        const val = this.value;
	        out.add(val === ' ' ? val : ` ${val} `, this.location);
	    }
	    toModule(context, out) {
	        out.add(`$J.co("${this.value}")`);
	    }
	}
	exports.Combinator = Combinator;
	const co = (value, location) => new Combinator(value, location);
	exports.co = co;
	});

	var declaration = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.decl = exports.Declaration = void 0;

	/**
	 * A continuous collection of nodes
	 */
	class Declaration extends tree.Node {
	    constructor(value, location) {
	        const name = value.name;
	        if (name.constructor === String) {
	            value.name = new tree.Anonymous(name);
	        }
	        super(value, location);
	    }
	    eval(context) {
	        const node = this.clone();
	        node.name = this.name.eval(context);
	        node.value = tree.cast(this.value).eval(context);
	        if (node.important) {
	            node.important = new tree.Anonymous(this.important.value);
	        }
	        return node;
	    }
	    toCSS(context, out) {
	        this.name.toCSS(context, out);
	        out.add(': ');
	        tree.cast(this.value).toCSS(context, out);
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
	const decl = (value, location) => new Declaration(value, location);
	exports.decl = decl;
	});

	var dimension_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.num = exports.dimension = exports.Dimension = void 0;

	/**
	 * A number or dimension
	 */
	class Dimension extends tree.Node {
	    constructor(value, location) {
	        if (tree.isNodeMap(value)) {
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
	const dimension = (...args) => new Dimension(...args);
	exports.dimension = dimension;
	/** alias */
	exports.num = exports.dimension;
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
	var Symbol$1 = _root.Symbol;

	var _Symbol = Symbol$1;

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

	var util = createCommonjsModule(function (module, exports) {
	var __importDefault = (commonjsGlobal && commonjsGlobal.__importDefault) || function (mod) {
	    return (mod && mod.__esModule) ? mod : { "default": mod };
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.cast = void 0;

	const isPlainObject_1$1 = __importDefault(isPlainObject_1);
	/**
	 * Casts a primitive value to a Jess node
	 * (if not already). This is for CSS output.
	 *
	 * @example
	 * cast(area(5))
	 */
	const cast = (value) => {
	    if (value === undefined || value === null) {
	        return new tree.Nil;
	    }
	    if (value instanceof tree.Node) {
	        return value;
	    }
	    if (isPlainObject_1$1.default(value)) {
	        if (Object.prototype.hasOwnProperty.call(value, '$root')) {
	            return value.$root;
	        }
	        return new tree.Anonymous('[object]');
	    }
	    if (Array.isArray(value)) {
	        return new tree.List(value);
	    }
	    if (value.constructor === Number) {
	        return new tree.Dimension(value);
	    }
	    return new tree.Anonymous(value.toString());
	};
	exports.cast = cast;
	});

	var element = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.el = exports.Element = void 0;



	class Element extends tree.Node {
	    constructor(value, location) {
	        if (node.isNodeMap(value)) {
	            super(value, location);
	            return;
	        }
	        super({
	            value: value.constructor === String ? new tree.Anonymous(value) : value
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
	        const value = util.cast(node.value).eval(context);
	        node.value = value;
	        // Bubble expressions and lists up to Selectors
	        if (value instanceof tree.Expression || value instanceof tree.List) {
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
	const el = (...args) => new Element(...args);
	exports.el = el;
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
	var _default$5 = combinate;

	var dist$3 = /*#__PURE__*/Object.defineProperty({
		default: _default$5
	}, '__esModule', {value: true});

	var expression = createCommonjsModule(function (module, exports) {
	var __importDefault = (commonjsGlobal && commonjsGlobal.__importDefault) || function (mod) {
	    return (mod && mod.__esModule) ? mod : { "default": mod };
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.expr = exports.Expression = void 0;


	const combinate_1 = __importDefault(dist$3);

	/**
	 * A continuous collection of nodes
	 */
	class Expression extends tree.Node {
	    constructor(value, location) {
	        if (node.isNodeMap(value)) {
	            super(value, location);
	            return;
	        }
	        const values = value.map(v => v.constructor === String ? new tree.Anonymous(v) : v);
	        super({
	            value: values
	        }, location);
	    }
	    toArray() {
	        return this.value.filter(node => node && !(node instanceof tree.WS));
	    }
	    eval(context) {
	        const node = this.clone();
	        /** Convert all values to Nodes */
	        node.value = node.value
	            .map(n => util.cast(n).eval(context))
	            .filter(n => n && !(n instanceof tree.Nil));
	        let lists;
	        node.value.forEach((n, i) => {
	            if (n instanceof tree.List) {
	                if (!lists) {
	                    lists = {};
	                }
	                lists[i] = n.value;
	            }
	        });
	        if (lists) {
	            const combinations = combinate_1.default(lists);
	            const returnList = new tree.List([]).inherit(this);
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
	        this.value.forEach(n => {
	            const val = util.cast(n);
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
	const expr = (...args) => new Expression(...args);
	exports.expr = expr;
	});

	var include_1 = createCommonjsModule(function (module, exports) {
	var __importDefault = (commonjsGlobal && commonjsGlobal.__importDefault) || function (mod) {
	    return (mod && mod.__esModule) ? mod : { "default": mod };
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.include = exports.Include = void 0;

	const isPlainObject_1$1 = __importDefault(isPlainObject_1);


	class Include extends tree.Node {
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
	                    rules.push(new tree.Declaration({
	                        name,
	                        value: util.cast((value[name])).eval(context)
	                    }));
	                }
	            }
	            return new tree.Ruleset(rules);
	        }
	        value = util.cast(value).eval(context);
	        /**
	         * Include Roots as plain Rulesets
	         */
	        if (value instanceof tree.Root) {
	            return new tree.Ruleset(value.value).eval(context);
	        }
	        if (!value.allowRoot && !value.allowRuleRoot) {
	            let message = '@include returned an invalid node.';
	            if (value instanceof tree.Call && this.value instanceof tree.Call) {
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
	class JsImport extends tree.JsNode {
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
	class JsKeyValue extends tree.JsNode {
	    constructor(val, location) {
	        let { name, value } = val;
	        if (name.constructor === String) {
	            name = new tree.JsIdent(name);
	        }
	        super({ name, value }, location);
	    }
	    toCSS(context, out) {
	        const value = this.value;
	        out.add(this.name.value, this.location);
	        if (!(value instanceof tree.JsCollection)) {
	            out.add(':');
	        }
	        out.add(' ');
	        value.toCSS(context, out);
	        if (!(value instanceof tree.JsCollection)) {
	            out.add(';');
	        }
	    }
	    toModule(context, out) {
	        out.add(`${this.name.value}: `, this.location);
	        this.value.toModule(context, out);
	    }
	}
	exports.JsKeyValue = JsKeyValue;
	const keyval = (value, location) => new JsKeyValue(value, location);
	exports.keyval = keyval;
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
	class JsExpr extends tree.Node {
	    getValue() {
	        const { value, post } = this;
	        if (post) {
	            return `${value} + '${post}'`;
	        }
	        return value;
	    }
	    getVar(context) {
	        context.rootRules.push(new tree.Declaration({
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
	const js = (value, location) => new JsExpr(value, location);
	exports.js = js;
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
	class Let extends tree.JsNode {
	    toCSS(context, out) {
	        out.add('@let ', this.location);
	        this.value.toCSS(context, out);
	    }
	    recurseValue(value, keys, context, out) {
	        const pre = context.pre;
	        if (value instanceof tree.JsCollection) {
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
	/**
	 * `let` is a reserved word, so we'll use `set`
	 * for lower-case API
	 */
	const set = (value, location) => new Let(value, location);
	exports.set = set;
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
	class List extends tree.Node {
	    toArray() {
	        return this.value;
	    }
	    toCSS(context, out) {
	        out.add('', this.location);
	        const length = this.value.length - 1;
	        const pre = context.pre;
	        this.value.forEach((node, i) => {
	            const val = util.cast(node);
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
	        this.value.forEach((node, i) => {
	            out.add(pre);
	            if (node instanceof tree.Node) {
	                node.toModule(context, out);
	            }
	            else {
	                out.add(JSON.stringify(node));
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
	const list = (value, location) => new List(value, location);
	exports.list = list;
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
	class Mixin extends tree.JsNode {
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
	                    if (node instanceof tree.JsIdent) {
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
	const mixin = (value, location) => new Mixin(value, location);
	exports.mixin = mixin;
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
	const nil = (value, location) => new Nil(value, location);
	exports.nil = nil;
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
	const paren = (value, location) => new Paren(value, location);
	exports.paren = paren;
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
	class Rule extends tree.Node {
	    constructor(value, location) {
	        const val = value.value;
	        if (Array.isArray(val)) {
	            value.value = new tree.Ruleset(val);
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
	                return new tree.Nil();
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
	const rule = (value, location) => new Rule(value, location);
	exports.rule = rule;
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
	class Ruleset extends tree.Node {
	    eval(context) {
	        if (!this.evaluated) {
	            const rule = this.clone();
	            const rules = [];
	            this.value.forEach(rule => {
	                rule = rule.eval(context);
	                if (rule && !(rule instanceof tree.Nil)) {
	                    if (rule instanceof tree.Rule || rule instanceof tree.AtRule) {
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
	            if (node instanceof tree.JsNode) {
	                node.toModule(context, out);
	                out.add('\n');
	            }
	            else if (node instanceof tree.Declaration && context.opts.dynamic) {
	                /**
	                 * Creates either runtime vars or var() depending on settings
	                 */
	                const n = node.clone();
	                const process = (n) => {
	                    if (n instanceof tree.JsExpr || n instanceof tree.Call) {
	                        if (n instanceof tree.Call) {
	                            n.processNodes(process);
	                        }
	                        if (context.isRuntime) {
	                            context.rootRules.push(new tree.Declaration({
	                                name: context.getVar(),
	                                value: n
	                            }));
	                            return n;
	                        }
	                        return new tree.Call({
	                            name: 'var',
	                            value: new tree.List([
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
	const ruleset = (value, location) => new Ruleset(value, location);
	exports.ruleset = ruleset;
	});

	var root_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.root = exports.Root = void 0;

	/**
	 * The root node. Contains a collection of nodes
	 */
	class Root extends tree.Node {
	    eval(context) {
	        const node = this.clone();
	        const rules = [];
	        this.value.forEach(rule => {
	            rule = rule.eval(context);
	            if (rule) {
	                if (rule instanceof tree.Ruleset) {
	                    rules.push(...rule.value);
	                }
	                else if (!(rule instanceof tree.Nil)) {
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
	        const jsNodes = this.value.filter(n => n instanceof tree.JsNode);
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
	                if (!(node instanceof tree.JsNode)) {
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
	const root = (value, location) => new Root(value, location);
	exports.root = root;
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
	class Selector extends tree.Expression {
	    constructor(value, location) {
	        if (tree.isNodeMap(value)) {
	            super(value, location);
	            return;
	        }
	        const values = value.map(v => v.constructor === String ? new tree.Combinator(v) : v);
	        super({
	            value: values
	        }, location);
	    }
	    eval(context) {
	        let selector = this.clone();
	        let elements = [...selector.value];
	        selector.value = elements;
	        const hasAmp = elements.find(el => el instanceof tree.Ampersand);
	        /**
	         * Try to evaluate all selectors as if they are prepended by `&`
	         */
	        if (!hasAmp) {
	            if (elements[0] instanceof tree.Combinator) {
	                elements.unshift(new tree.Ampersand());
	            }
	            else {
	                elements.unshift(new tree.Ampersand(), new tree.Combinator(' '));
	            }
	        }
	        selector = super.eval.call(selector, context);
	        elements = selector.value;
	        for (let i = 0; i < elements.length; i++) {
	            let value = elements[0];
	            if (value instanceof tree.Combinator ||
	                value instanceof tree.WS) {
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
	class Spaced extends tree.Expression {
	    constructor(value, location) {
	        if (tree.isNodeMap(value)) {
	            super(value, location);
	            return;
	        }
	        const values = [value[0]];
	        for (let i = 1; i < value.length; i++) {
	            values.push(new tree.WS(), value[i]);
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
	const square = (value, location) => new Square(value, location);
	exports.square = square;
	});

	var ws_1 = createCommonjsModule(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.ws = exports.WS = void 0;

	/**
	 * A whitespace node
	 */
	class WS extends tree.Node {
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
	const ws = (value, location) => new WS(value, location);
	exports.ws = ws;
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
	/** Base classes - keep these on top */
	__exportStar(node, exports);
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
	__exportStar(util, exports);
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
	var Map$1 = _getNative(_root, 'Map');

	var _Map = Map$1;

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

	var _defineProperty$1 = defineProperty;

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
	  if (key == '__proto__' && _defineProperty$1) {
	    _defineProperty$1(object, key, {
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
	var Uint8Array$1 = _root.Uint8Array;

	var _Uint8Array = Uint8Array$1;

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
	var baseSetToString = !_defineProperty$1 ? identity_1 : function(func, string) {
	  return _defineProperty$1(func, 'toString', {
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

	var util$1 = createCommonjsModule(function (module, exports) {
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

	var lib$3 = createCommonjsModule(function (module, exports) {
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
	// import * as tree from './tree'
	__exportStar(tree, exports);

	Object.defineProperty(exports, "Context", { enumerable: true, get: function () { return context.Context; } });
	__exportStar(renderCss_1, exports);
	__exportStar(util$1, exports);
	});

	const $CONTEXT = new lib$3.Context({});
	$CONTEXT.id = '76d9c67f';
	function $DEFAULT ($VARS = {}, $RETURN_NODE) {
	  exports.value = lib$3.get($VARS, 'value', lib$3.anon("red"));
	  
	  return {
	    value: exports.value
	  }
	}
	const $DEFAULT_PROXY = lib$3.proxy($DEFAULT, $CONTEXT);
	$DEFAULT_PROXY(undefined, true);

	exports.default = $DEFAULT_PROXY;

	Object.defineProperty(exports, '__esModule', { value: true });

})));
