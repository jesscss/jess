import { Lexer } from 'chevrotain';
import { createLexerDefinition } from '@jesscss/css-parser';
import type { ScssRecursiveParser, TokenMap as ScssTokenMap } from '../scssRecursiveParser.js';
import { scssFragments, scssTokens } from '../scssTokens.js';
import {
  Any,
  Call,
  Interpolated,
  INTERPOLATION_PLACEHOLDER,
  isNode,
  N,
  Quoted,
  Reference,
  Sequence,
  VarDeclaration,
  type LocationInfo,
  type Node,
  type Selector
} from '@jesscss/core';
import type { IToken } from '@jesscss/parser-runtime';

export type InterpolationMatch = { start: number; end: number; content: string };

export function findScssInterpolations(value: string): InterpolationMatch[] {
  const matches: InterpolationMatch[] = [];
  let i = 0;
  while (i < value.length) {
    if (value[i] === '#' && value[i + 1] === '{') {
      const start = i;
      i += 2; // skip #{
      let braceCount = 1;
      const contentStart = i;
      while (i < value.length && braceCount > 0) {
        const ch = value[i]!;
        if (ch === '{') {
          braceCount++;
        } else if (ch === '}') {
          braceCount--;
        }
        i++;
      }
      if (braceCount === 0) {
        matches.push({ start, end: i, content: value.slice(contentStart, i - 1) });
      }
    } else {
      i++;
    }
  }
  return matches;
}

let interpolationParser:
  | {
    lexer: Lexer;
    parser: ScssRecursiveParser;
  }
  | undefined;

/** Store the ScssRecursiveParser class, set lazily to break circular dependency */
let ScssRecursiveParserClass: (new (T: any, config: any) => ScssRecursiveParser) | undefined;

/** Called by ScssRecursiveParser constructor to register itself */
export function registerScssRecursiveParser(cls: new (T: any, config: any) => ScssRecursiveParser): void {
  ScssRecursiveParserClass = cls;
}

export function getInterpolationParser(): { lexer: Lexer; parser: ScssRecursiveParser } {
  if (interpolationParser) {
    return interpolationParser;
  }
  const { lexer, T } = createLexerDefinition(scssFragments(), scssTokens());
  const chevLexer = new Lexer(lexer, {
    ensureOptimizations: true,
    skipValidations: process.env.TEST !== 'true'
  });
  if (!ScssRecursiveParserClass) {
    throw new Error('ScssRecursiveParser not registered. Ensure it is imported before calling getInterpolationParser.');
  }
  const parser = new ScssRecursiveParserClass(T as any, {});
  interpolationParser = { lexer: chevLexer, parser };
  return interpolationParser;
}

export function parseInterpolationExpression(expr: string): Node {
  const { lexer, parser } = getInterpolationParser();
  const lexed = lexer.tokenize(expr);
  (parser as any).input = lexed.tokens as IToken[];
  return (parser as any).valueSequence({} as any) as unknown as Node;
}

export function parseSelectorListExpression(expr: string): Selector {
  const { lexer, parser } = getInterpolationParser();
  const lexed = lexer.tokenize(expr);
  (parser as any).input = lexed.tokens as IToken[];
  const out = (parser as any).selectorList({} as any) as unknown as Selector;
  if ((parser as any).errors.length > 0) {
    const msg = (parser as any).errors[0]?.message ?? 'Invalid selector.parse() input';
    throw new SyntaxError(msg);
  }
  return out;
}

export function processScssStringInterpolation(
  value: string,
  location: LocationInfo,
  context: any
): Any | Interpolated {
  const matches = findScssInterpolations(value);
  if (matches.length === 0) {
    return new Any(value, { role: 'any' }, location, context);
  }

  const replacements: Node[] = [];
  let source = value;
  let offset = 0;

  for (const match of matches) {
    const adjustedStart = match.start - offset;
    const adjustedEnd = match.end - offset;
    const before = source.slice(0, adjustedStart);
    const after = source.slice(adjustedEnd);
    source = before + INTERPOLATION_PLACEHOLDER + after;
    offset += (match.end - match.start) - INTERPOLATION_PLACEHOLDER.length;

    const parsed = parseInterpolationExpression(match.content.trim());
    const simpleRef = asSingleVariableReference(parsed);
    if (simpleRef && typeof simpleRef.data.key === 'string') {
      replacements.push(new Reference({ key: simpleRef.data.key }, { type: 'variable', role: 'ident' }, location, context));
    } else if (isNode(parsed, N.Reference)) {
      replacements.push(new Expression(parsed, undefined, location, context));
    } else {
      replacements.push(parsed);
    }
  }

  return new Interpolated({ source, replacements }, { role: 'any' }, location, context);
}

// Re-import Expression here to avoid issues
import { Expression } from '@jesscss/core';

export function unwrapSingleSequence(n: Node): Node {
  if (isNode(n, N.Sequence) && (n as Sequence).data.length === 1) {
    return (n as Sequence).data[0]!;
  }
  return n;
}

export function asSingleVariableReference(n: Node): Reference | undefined {
  const node = unwrapSingleSequence(n);
  if (
    isNode(node, N.Reference)
    && node.options?.type === 'variable'
    && !node.data.target
    && typeof node.data.key === 'string'
  ) {
    return node as Reference;
  }
  return undefined;
}

export function makePrivateTempVarDecl(parser: ScssRecursiveParser, name: string, value: Node, location?: LocationInfo): VarDeclaration {
  const decl = new VarDeclaration(
    {
      name: new Any(name, { role: 'property' }, location, parser.context),
      value
    },
    undefined,
    location,
    parser.context
  );
  (decl.options as any).rulesVisibility = { VarDeclaration: 'private' };
  return decl;
}

export function toNameInterpolationReplacement(
  parser: ScssRecursiveParser,
  expr: Node,
  location?: LocationInfo
): Node {
  const simpleRef = asSingleVariableReference(expr);
  if (simpleRef && typeof simpleRef.data.key === 'string') {
    return new Reference({ key: simpleRef.data.key }, { type: 'variable', role: 'ident' }, location, parser.context);
  }
  const tmpName = parser.nextTempVarName();
  parser.enqueuePendingNode(makePrivateTempVarDecl(parser, tmpName, expr, location));
  return new Reference({ key: tmpName }, { type: 'variable', role: 'ident' }, location, parser.context);
}

export function toDeclKey(node: Node): string {
  const key = node.valueOf();
  return String(key);
}

export function isValidIdentifierKey(key: string): boolean {
  return /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(key);
}

export function desugarMapLookup(
  parser: ScssRecursiveParser,
  call: Call
): Node {
  const name = call.data.name;
  if (typeof name !== 'string') {
    return call;
  }
  if (name !== 'map-get' && name !== 'map.get') {
    return call;
  }

  const argsList = call.data.args;
  const args = isNode(argsList, N.List) ? (argsList as any).data : [];
  if (args.length < 2) {
    return call;
  }

  const mapExpr = unwrapSingleSequence(args[0] as Node);
  const keyArgs = args.slice(1).map((a: any) => unwrapSingleSequence(a as Node));

  const initialTarget: Reference | Call | undefined =
    isNode(mapExpr, N.Reference)
      ? (mapExpr as Reference)
      : isNode(mapExpr, N.Call)
        ? (mapExpr as Call)
        : undefined;

  if (!initialTarget) {
    return call;
  }

  const callLoc: LocationInfo | undefined = Array.isArray(call.location) && call.location.length === 6
    ? (call.location as LocationInfo)
    : undefined;

  let currentTarget: Reference | Call = initialTarget;
  for (const keyNode of keyArgs) {
    const keyStr = toDeclKey(keyNode);
    const useDeclaration = isValidIdentifierKey(keyStr);
    const ref = new Reference(
      { target: currentTarget, key: useDeclaration ? keyStr : keyNode },
      { type: useDeclaration ? 'declaration' : 'index' },
      callLoc,
      parser.context
    );
    currentTarget = ref;
  }

  return currentTarget;
}

export function makeNamespacedReference(
  parser: ScssRecursiveParser,
  parts: string[],
  finalType: 'variable' | 'function' | 'mixin' | 'mixin-ruleset'
): Reference {
  let current: Reference = new Reference(parts[0]!, { type: 'variable' }, undefined, parser.context);
  for (let i = 1; i < parts.length; i++) {
    const isFinal = i === parts.length - 1;
    const type = isFinal ? finalType : 'index';
    current = new Reference(
      { target: current, key: parts[i]! },
      { type },
      undefined,
      parser.context
    );
  }
  return current;
}

export function desugarNamespacedCall(parser: ScssRecursiveParser, call: Call): Call {
  const { name } = call.data;
  if (typeof name !== 'string') {
    return call;
  }
  if (!name.includes('.')) {
    return call;
  }
  if (name === 'map.get') {
    return call;
  }
  const parts = name.split('.').filter(Boolean);
  if (parts.length < 2) {
    return call;
  }
  const ref = makeNamespacedReference(parser, parts, 'function');
  return new Call({ name: ref, args: call.data.args }, call.options, call.location, parser.context);
}

export function looksLikeMapLiteral(parser: ScssRecursiveParser, T: ScssTokenMap): boolean {
  let depth = 0;
  for (let i = 1; i < 50; i++) {
    const tok = parser.LA(i);
    if (tok.tokenType === T.LParen) {
      depth++;
    }
    if (tok.tokenType === T.RParen) {
      if (depth === 0) {
        return false;
      }
      depth--;
      if (depth === 0) {
        return false;
      }
    }
    if (tok.tokenType === T.Colon && depth === 1) {
      return true;
    }
    if (tok.tokenType.name === 'EOF') {
      return false;
    }
  }
  return false;
}

export function looksLikeScssComparison(parser: ScssRecursiveParser, T: ScssTokenMap): boolean {
  for (let i = 1; i < 30; i++) {
    const tok = parser.LA(i);
    const tt = tok.tokenType;
    if (
      tt === T.LCurly
      || tt === T.RCurly
      || tt === T.RParen
      || tt === T.And
      || tt === T.Or
      || tt === T.Comma
      || tt === T.Semi
      || tt.name === 'EOF'
    ) {
      return false;
    }
    if (
      tt === T.NotEq
      || tt === T.EqEq
      || tt === T.Eq
      || tt === T.Gt
      || tt === T.GtEq
      || tt === T.Lt
      || tt === T.LtEq
    ) {
      return true;
    }
  }
  return false;
}

export function isScriptUsePath(path: string): boolean {
  return path.endsWith('.js') || path.endsWith('.ts') || path.endsWith('.json');
}

export function quotedLike(original: Quoted, nextValue: string, context: ScssRecursiveParser['context']): Quoted {
  const quote = original.options?.quote ?? '"';
  const escaped = original.options?.escaped;
  const loc: LocationInfo | undefined = Array.isArray(original.location) && original.location.length === 6
    ? (original.location as LocationInfo)
    : undefined;
  return new Quoted(new Any(nextValue, { role: 'any' }), { quote, escaped }, loc, context);
}

export function defaultNamespaceFromPath(path: string): string | undefined {
  if (path.startsWith('sass:')) {
    const name = path.slice('sass:'.length);
    return name.split('/').filter(Boolean).pop();
  }
  const base = path.split('/').filter(Boolean).pop();
  if (!base) {
    return undefined;
  }
  const noExt = base.replace(/\.(scss|sass|css|jess|js|ts|json)$/i, '');
  return noExt || undefined;
}

