import {
  VarDeclaration,
  any,
  atrule,
  atrulestatement,
  call,
  compound,
  decl,
  list,
  mixin,
  nil,
  paren,
  query,
  rest,
  rules,
  ruleset,
  sel,
  sellist,
  stylesheet,
  ref,
  type AtRulePrelude,
  type Node,
  type Selector,
  type Stylesheet
} from '@jesscss/core';
import {
  SourceText,
  appendParserDiagnostic,
  findBalancedBlockEnd,
  findStatementEnd,
  findTrailingImportantStart,
  findTopLevelBlockStart,
  findTopLevelDelimiter,
  scanCheapAtRulePrelude,
  scanCheapAtRulePreludeList,
  scanCheapSelectorComponents,
  skipQuotedSourceString,
  skipSourceTrivia,
  type CheapAtRulePreludeToken,
  type CheapSelectorComponent,
  type ParserDiagnostic,
  type ScannerParseResult,
  type SourceScannerOptions
} from '@jesscss/parser';

export type LessAstStylesheetResult = ScannerParseResult<Stylesheet>;

const EMPTY_DIAGNOSTICS: readonly ParserDiagnostic[] = [];
const LESS_SCANNER_OPTIONS: SourceScannerOptions = { lineComments: true };

type DiagnosticSink = (
  severity: ParserDiagnostic['severity'],
  code: string,
  message: string,
  start: number,
  end: number
) => void;

function isLessNameCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57)
    || code === 45
    || code === 95
  );
}

function isLessHeaderSpace(code: number): boolean {
  return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}

function materializeCheapAtRulePreludeToken(token: CheapAtRulePreludeToken): string | Node {
  return typeof token === 'string' ? token : paren(any(token[1]));
}

function materializeCheapAtRulePreludeNode(token: CheapAtRulePreludeToken): Node {
  return typeof token === 'string' ? any(token) : paren(any(token[1]));
}

function parseCheapAtRulePrelude(text: string, options?: SourceScannerOptions): AtRulePrelude | undefined {
  const tokens = scanCheapAtRulePrelude(text, options);
  if (!tokens) {
    return undefined;
  }
  if (tokens.length === 1) {
    return materializeCheapAtRulePreludeToken(tokens[0]!);
  }
  return query(tokens.map(materializeCheapAtRulePreludeNode));
}

function materializeCheapAtRulePreludeListItem(tokens: CheapAtRulePreludeToken[]): Node {
  return tokens.length === 1
    ? materializeCheapAtRulePreludeNode(tokens[0]!)
    : query(tokens.map(materializeCheapAtRulePreludeNode));
}

function parseCheapAtRulePreludeList(text: string, options?: SourceScannerOptions): AtRulePrelude | undefined {
  const items = scanCheapAtRulePreludeList(text, options);
  return items ? list(items.map(materializeCheapAtRulePreludeListItem)) : undefined;
}

function materializeCheapCompound(component: readonly string[]): string | Selector {
  return component.length === 1
    ? component[0]!
    : compound([...component]);
}

function materializeCheapSelector(components: CheapSelectorComponent[]): string | Selector {
  if (components.length === 1) {
    const only = components[0]!;
    if (Array.isArray(only)) {
      return materializeCheapCompound(only);
    }
  }
  return sel(components.map((component) => {
    if (typeof component === 'string') {
      return component;
    }
    return materializeCheapCompound(component);
  }));
}

function parseCheapLessSelector(selector: string): string | Selector | undefined {
  const source = selector.trim();
  const components = scanCheapSelectorComponents(source);
  if (!components) {
    return undefined;
  }
  if (components.length === 1) {
    const only = components[0]!;
    return Array.isArray(only) && only.length === 1 ? source : materializeCheapSelector(components);
  }
  return materializeCheapSelector(components);
}

function parseCheapLessSelectorList(selector: string): string | Selector | undefined {
  const firstComma = findTopLevelDelimiter(selector, ',', 0, selector.length, LESS_SCANNER_OPTIONS);
  if (firstComma === -1) {
    return parseCheapLessSelector(selector);
  }
  const items: Array<string | Selector> = [];
  let cursor = 0;
  while (cursor < selector.length) {
    const comma = findTopLevelDelimiter(selector, ',', cursor, selector.length, LESS_SCANNER_OPTIONS);
    const itemEnd = comma === -1 ? selector.length : comma;
    const item = parseCheapLessSelector(selector.slice(cursor, itemEnd));
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
    if (comma === -1) {
      break;
    }
    cursor = comma + 1;
  }
  return items.length > 1 ? sellist(items) : items[0];
}

function parseLessVariableDeclaration(
  source: string,
  start: number,
  colon: number,
  end: number
): VarDeclaration | undefined {
  if (source[start] !== '@') {
    return undefined;
  }
  let nameEnd = start + 1;
  while (nameEnd < colon && isLessNameCode(source.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  const name = source.slice(start + 1, nameEnd);
  if (!name || source.slice(nameEnd, colon).trim()) {
    return undefined;
  }
  const trimmedValue = source.slice(colon + 1, end).trim();
  const importantStart = findTrailingImportantStart(trimmedValue);
  return new VarDeclaration({
    name,
    value: importantStart === -1 ? trimmedValue : trimmedValue.slice(0, importantStart).trimEnd(),
    ...(importantStart !== -1 && { important: trimmedValue.slice(importantStart) })
  });
}

function parseLessVariableBlockName(source: string, start: number, blockStart: number): string | undefined {
  if (source[start] !== '@') {
    return undefined;
  }
  const colon = findTopLevelDelimiter(source, ':', start, blockStart, LESS_SCANNER_OPTIONS);
  if (colon === -1) {
    return undefined;
  }
  let nameEnd = start + 1;
  while (nameEnd < colon && isLessNameCode(source.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  const name = source.slice(start + 1, nameEnd);
  if (!name || source.slice(nameEnd, colon).trim() || source.slice(colon + 1, blockStart).trim()) {
    return undefined;
  }
  return name;
}

function createDetachedRulesetVariable(name: string, body: Node[]): VarDeclaration {
  const bodyRules = rules(body, {
    rulesVisibility: {
      Mixin: 'private',
      VarDeclaration: 'private'
    }
  });
  return new VarDeclaration({
    name,
    value: mixin({ rules: bodyRules })
  });
}

type CheapMixinHeader = {
  name: string;
  params?: ReturnType<typeof list>;
};
type CheapMixinParam = VarDeclaration | ReturnType<typeof rest>;

type GuardedHeader = {
  body: string;
  guard?: string;
};

/** Find a mixin-call `)` without allocating tokens or accepting malformed suffixes. */
function findCheapCallCloseParen(source: string, open: number): number {
  let cursor = open + 1;
  let expectedClose = '';
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\"' || char === '\'') {
      cursor = skipQuotedSourceString(source, cursor, source.length);
      continue;
    }
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const commentEnd = source.indexOf('*/', cursor + 2);
      cursor = commentEnd === -1 ? source.length : commentEnd + 2;
      continue;
    }
    if (char === '/' && source[cursor + 1] === '/') {
      cursor += 2;
      while (cursor < source.length) {
        const code = source.charCodeAt(cursor);
        if (code === 10 || code === 13) {
          break;
        }
        cursor++;
      }
      continue;
    }
    if (char === '(') {
      expectedClose += ')';
    } else if (char === '[') {
      expectedClose += ']';
    } else if (char === '{') {
      expectedClose += '}';
    } else if (char === ')' || char === ']' || char === '}') {
      if (!expectedClose) {
        if (char !== ')') {
          return -1;
        }
        return cursor;
      }
      if (expectedClose[expectedClose.length - 1] !== char) {
        return -1;
      }
      expectedClose = expectedClose.slice(0, -1);
    }
    cursor++;
  }
  return -1;
}

function hasBalancedCheapArgumentText(source: string): boolean {
  let cursor = 0;
  let expectedClose = '';
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\"' || char === '\'') {
      cursor = skipQuotedSourceString(source, cursor, source.length);
      continue;
    }
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const commentEnd = source.indexOf('*/', cursor + 2);
      if (commentEnd === -1) {
        return false;
      }
      cursor = commentEnd + 2;
      continue;
    }
    if (char === '/' && source[cursor + 1] === '/') {
      cursor += 2;
      while (cursor < source.length) {
        const code = source.charCodeAt(cursor);
        if (code === 10 || code === 13) {
          break;
        }
        cursor++;
      }
      continue;
    }
    if (char === '(') {
      expectedClose += ')';
    } else if (char === '[') {
      expectedClose += ']';
    } else if (char === '{') {
      expectedClose += '}';
    } else if (char === ')' || char === ']' || char === '}') {
      if (!expectedClose || expectedClose[expectedClose.length - 1] !== char) {
        return false;
      }
      expectedClose = expectedClose.slice(0, -1);
    }
    cursor++;
  }
  return expectedClose.length === 0;
}

function findTopLevelWhen(source: string): number {
  let cursor = 0;
  let expectedClose = '';
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\"' || char === '\'') {
      cursor = skipQuotedSourceString(source, cursor, source.length);
      continue;
    }
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const commentEnd = source.indexOf('*/', cursor + 2);
      cursor = commentEnd === -1 ? source.length : commentEnd + 2;
      continue;
    }
    if (char === '/' && source[cursor + 1] === '/') {
      cursor += 2;
      while (cursor < source.length) {
        const code = source.charCodeAt(cursor);
        if (code === 10 || code === 13) {
          break;
        }
        cursor++;
      }
      continue;
    }
    if (char === '(') {
      expectedClose += ')';
    } else if (char === '[') {
      expectedClose += ']';
    } else if (char === '{') {
      expectedClose += '}';
    } else if (char === ')' || char === ']' || char === '}') {
      if (!expectedClose || expectedClose[expectedClose.length - 1] !== char) {
        return -1;
      }
      expectedClose = expectedClose.slice(0, -1);
    } else if (
      !expectedClose
      && source.startsWith('when', cursor)
      && cursor > 0
      && isLessHeaderSpace(source.charCodeAt(cursor - 1))
      && (
        cursor + 4 >= source.length
        || isLessHeaderSpace(source.charCodeAt(cursor + 4))
        || source.charCodeAt(cursor + 4) === 40
      )
    ) {
      return cursor;
    }
    cursor++;
  }
  return -1;
}

function splitGuardedHeader(header: string): GuardedHeader {
  const source = header.trim();
  const whenStart = findTopLevelWhen(source);
  if (whenStart === -1) {
    return { body: source };
  }
  const body = source.slice(0, whenStart).trimEnd();
  const guard = source.slice(whenStart + 4).trim();
  if (!body || !isCheapGuardText(guard)) {
    return { body: source };
  }
  return { body, guard };
}

function isCheapGuardText(source: string): boolean {
  const text = source.trim();
  let conditionStart = 0;
  if (
    text.startsWith('not')
    && (text.length === 3 || isLessHeaderSpace(text.charCodeAt(3)))
  ) {
    conditionStart = skipSourceTrivia(text, 3, text.length, LESS_SCANNER_OPTIONS);
  }
  return text.charCodeAt(conditionStart) === 40 && hasBalancedCheapArgumentText(text);
}

function parseCheapMixinParam(source: string): CheapMixinParam | undefined {
  const text = source.trim();
  if (text === '...') {
    return rest();
  }
  if (text[0] !== '@') {
    return undefined;
  }
  if (text.endsWith('...')) {
    const nameLimit = text.length - 3;
    let nameEnd = 1;
    while (nameEnd < nameLimit && isLessNameCode(text.charCodeAt(nameEnd))) {
      nameEnd++;
    }
    if (nameEnd === 1 || nameEnd !== nameLimit) {
      return undefined;
    }
    return rest(text.slice(1, nameEnd));
  }
  const colon = findTopLevelDelimiter(text, ':', 0, text.length, LESS_SCANNER_OPTIONS);
  const nameLimit = colon === -1 ? text.length : colon;
  let nameEnd = 1;
  while (nameEnd < nameLimit && isLessNameCode(text.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  if (nameEnd === 1 || text.slice(nameEnd, nameLimit).trim()) {
    return undefined;
  }
  const defaultValue = colon === -1 ? undefined : text.slice(colon + 1).trim();
  if (defaultValue !== undefined && (!defaultValue || !hasBalancedCheapArgumentText(defaultValue))) {
    return undefined;
  }
  return new VarDeclaration({
    name: any(text.slice(1, nameEnd), { role: 'property' }),
    value: defaultValue ?? nil()
  }, { paramVar: true });
}

function hasCheapMixinParamDefault(source: string): boolean {
  return findTopLevelDelimiter(source, ':', 0, source.length, LESS_SCANNER_OPTIONS) !== -1;
}

function isCheapMixinParamText(source: string): boolean {
  const text = source.trimStart();
  if (text === '...') {
    return true;
  }
  if (text[0] !== '@') {
    return false;
  }
  if (text.endsWith('...')) {
    const nameLimit = text.length - 3;
    let nameEnd = 1;
    while (nameEnd < nameLimit && isLessNameCode(text.charCodeAt(nameEnd))) {
      nameEnd++;
    }
    return nameEnd > 1 && nameEnd === nameLimit;
  }
  const colon = findTopLevelDelimiter(text, ':', 0, text.length, LESS_SCANNER_OPTIONS);
  const nameLimit = colon === -1 ? text.length : colon;
  let nameEnd = 1;
  while (nameEnd < nameLimit && isLessNameCode(text.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  if (nameEnd === 1 || text.slice(nameEnd, nameLimit).trim()) {
    return false;
  }
  const defaultValue = colon === -1 ? undefined : text.slice(colon + 1).trim();
  return defaultValue === undefined || (!!defaultValue && hasBalancedCheapArgumentText(defaultValue));
}

function parseCheapCommaMixinParams(source: string): CheapMixinParam[] | undefined {
  const params: CheapMixinParam[] = [];
  let cursor = 0;
  let segmentStart = 0;
  let current = '';
  while (cursor <= source.length) {
    const comma = findTopLevelDelimiter(source, ',', cursor, source.length, LESS_SCANNER_OPTIONS);
    const segmentEnd = comma === -1 ? source.length : comma;
    const segment = source.slice(segmentStart, segmentEnd);
    const nextStart = comma === -1 ? source.length : comma + 1;
    const nextComma = comma === -1
      ? -1
      : findTopLevelDelimiter(source, ',', nextStart, source.length, LESS_SCANNER_OPTIONS);
    const nextSegmentEnd = nextComma === -1 ? source.length : nextComma;
    const nextSegment = comma === -1 ? '' : source.slice(nextStart, nextSegmentEnd);
    if (!segment.trim() || (comma !== -1 && !nextSegment.trim())) {
      return undefined;
    }
    const candidate = current ? `${current},${segment}` : segment;
    if (
      comma !== -1
      && hasCheapMixinParamDefault(candidate)
      && !isCheapMixinParamText(nextSegment)
    ) {
      current = candidate;
      cursor = comma + 1;
      segmentStart = cursor;
      continue;
    }
    const param = parseCheapMixinParam(candidate);
    if (!param) {
      return undefined;
    }
    if (param.type === 'Rest' && comma !== -1) {
      return undefined;
    }
    params.push(param);
    if (comma === -1) {
      break;
    }
    current = '';
    cursor = comma + 1;
    segmentStart = cursor;
    if (cursor >= source.length) {
      return undefined;
    }
  }
  return params;
}

function parseCheapMixinParams(source: string): ReturnType<typeof list> | undefined {
  const text = source.trim();
  if (!text) {
    return undefined;
  }
  const separator = findTopLevelDelimiter(text, ';', 0, text.length, LESS_SCANNER_OPTIONS) !== -1
    ? ';'
    : findTopLevelDelimiter(text, ',', 0, text.length, LESS_SCANNER_OPTIONS) !== -1
      ? ','
      : undefined;
  if (separator === ',') {
    const params = parseCheapCommaMixinParams(text);
    return params?.length ? list(params, { sep: ',' }) : undefined;
  }
  const params: CheapMixinParam[] = [];
  let cursor = 0;
  while (cursor <= text.length) {
    const end = separator
      ? findTopLevelDelimiter(text, separator, cursor, text.length, LESS_SCANNER_OPTIONS)
      : -1;
    const partEnd = end === -1 ? text.length : end;
    const param = parseCheapMixinParam(text.slice(cursor, partEnd));
    if (!param) {
      return undefined;
    }
    if (param.type === 'Rest' && separator && end !== -1) {
      return undefined;
    }
    params.push(param);
    if (!separator || end === -1) {
      break;
    }
    cursor = end + 1;
    if (cursor >= text.length) {
      break;
    }
  }
  return params.length ? list(params, separator ? { sep: separator } : undefined) : undefined;
}

function parseCheapMixinCallArgs(source: string): ReturnType<typeof list> | undefined {
  const text = source.trim();
  if (!text) {
    return undefined;
  }
  const semi = findTopLevelDelimiter(text, ';', 0, text.length, LESS_SCANNER_OPTIONS);
  const comma = findTopLevelDelimiter(text, ',', 0, text.length, LESS_SCANNER_OPTIONS);
  const separator = semi !== -1
    ? ';'
    : comma !== -1
      ? ','
      : undefined;
  const args: Node[] = [];
  let cursor = 0;
  while (cursor <= text.length) {
    const end = separator
      ? findTopLevelDelimiter(text, separator, cursor, text.length, LESS_SCANNER_OPTIONS)
      : -1;
    const partEnd = end === -1 ? text.length : end;
    const arg = text.slice(cursor, partEnd).trim();
    if (
      !arg
      || arg.endsWith('...')
      || !hasBalancedCheapArgumentText(arg)
      || (separator === ';' && !hasNoEmptyTopLevelCommaArms(arg))
    ) {
      return undefined;
    }
    const namedColon = findTopLevelDelimiter(arg, ':', 0, arg.length, LESS_SCANNER_OPTIONS);
    if (namedColon === -1) {
      args.push(any(arg));
    } else {
      const name = arg.slice(0, namedColon).trim();
      const value = arg.slice(namedColon + 1).trim();
      if (name[0] !== '@' || !value || !hasBalancedCheapArgumentText(value)) {
        return undefined;
      }
      let nameEnd = 1;
      while (nameEnd < name.length && isLessNameCode(name.charCodeAt(nameEnd))) {
        nameEnd++;
      }
      if (nameEnd === 1 || name.slice(nameEnd).trim()) {
        return undefined;
      }
      args.push(new VarDeclaration({
        name: any(name.slice(1), { role: 'property' }),
        value
      }, { paramVar: true }));
    }
    if (!separator || end === -1) {
      break;
    }
    cursor = end + 1;
    if (cursor >= text.length) {
      if (separator === ';') {
        break;
      }
      return undefined;
    }
  }
  return list(args, separator ? { sep: separator } : undefined);
}

function hasNoEmptyTopLevelCommaArms(source: string): boolean {
  let cursor = 0;
  while (cursor <= source.length) {
    const comma = findTopLevelDelimiter(source, ',', cursor, source.length, LESS_SCANNER_OPTIONS);
    const armEnd = comma === -1 ? source.length : comma;
    if (!source.slice(cursor, armEnd).trim()) {
      return false;
    }
    if (comma === -1) {
      return true;
    }
    cursor = comma + 1;
  }
  return true;
}

function isCheapMixinName(source: string): boolean {
  const components = scanCheapSelectorComponents(source);
  return components?.length === 1
    && Array.isArray(components[0])
    && components[0].length === 1
    && components[0][0] === source;
}

type CheapMixinName = {
  name: string;
  end: number;
};

type CheapMixinReferenceName = {
  key: string | string[];
  end: number;
};

function readCheapMixinName(source: string, offset = 0): CheapMixinName | undefined {
  const first = source[offset];
  if (first !== '.' && first !== '#') {
    return undefined;
  }
  let nameEnd = offset + 1;
  while (nameEnd < source.length && isLessNameCode(source.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  if (nameEnd === offset + 1) {
    return undefined;
  }
  const name = source.slice(offset, nameEnd);
  return isCheapMixinName(name) ? { name, end: nameEnd } : undefined;
}

function readCheapMixinReferenceName(source: string): CheapMixinReferenceName | undefined {
  const keys: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const segment = readCheapMixinName(source, cursor);
    if (!segment) {
      break;
    }
    keys.push(segment.name);
    cursor = segment.end;
    if (source[cursor] !== '.' && source[cursor] !== '#') {
      break;
    }
  }
  if (!keys.length) {
    return undefined;
  }
  return {
    key: keys.length === 1 ? keys[0]! : keys,
    end: cursor
  };
}

function parseCheapMixinHeader(header: string): CheapMixinHeader | undefined {
  const source = header.trim();
  const callee = readCheapMixinName(source);
  if (!callee) {
    return undefined;
  }
  const { name } = callee;
  let cursor = callee.end;
  cursor = skipSourceTrivia(source, cursor, source.length, LESS_SCANNER_OPTIONS);
  if (source[cursor] !== '(') {
    return undefined;
  }
  cursor = skipSourceTrivia(source, cursor + 1, source.length, LESS_SCANNER_OPTIONS);
  const paramsStart = cursor;
  const paramsEnd = source.lastIndexOf(')');
  if (paramsEnd === -1) {
    return undefined;
  }
  cursor = skipSourceTrivia(source, paramsEnd + 1, source.length, LESS_SCANNER_OPTIONS);
  if (cursor !== source.length) {
    return undefined;
  }
  const params = parseCheapMixinParams(source.slice(paramsStart, paramsEnd));
  return paramsStart === paramsEnd || params
    ? {
        name,
        ...(params && { params })
      }
    : undefined;
}

function parseCheapMixinBlock(
  source: string,
  start: number,
  blockStart: number,
  blockEnd: number,
  addDiagnostic: DiagnosticSink,
  headerText?: string,
  guard?: string
): Node | undefined {
  const header = parseCheapMixinHeader(headerText ?? source.slice(start, blockStart));
  if (!header) {
    return undefined;
  }
  return mixin({
    name: any(header.name, { role: 'name' }),
    ...(header.params && { params: header.params }),
    ...(guard && { guard }),
    rules: rules(parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic))
  });
}

function parseAtRuleBlock(
  source: string,
  start: number,
  blockStart: number,
  blockEnd: number,
  addDiagnostic: DiagnosticSink
): Node | undefined {
  if (source[start] !== '@') {
    return undefined;
  }
  let nameEnd = start + 1;
  while (nameEnd < blockStart && isLessNameCode(source.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  const name = source.slice(start, nameEnd);
  if (name.length === 1) {
    return undefined;
  }
  const preludeText = source.slice(nameEnd, blockStart).trim();
  const prelude = parseCheapAtRulePrelude(preludeText, LESS_SCANNER_OPTIONS)
    ?? parseCheapAtRulePreludeList(preludeText, LESS_SCANNER_OPTIONS);
  if (preludeText && !prelude) {
    return undefined;
  }
  return atrule({
    name,
    ...(prelude !== undefined && { prelude }),
    rules: rules(parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic))
  });
}

function parseLessBlockNode(
  source: string,
  start: number,
  blockStart: number,
  blockEnd: number,
  addDiagnostic: DiagnosticSink
): Node | undefined {
  const { body: selector, guard } = splitGuardedHeader(source.slice(start, blockStart));
  if (!selector) {
    addDiagnostic(
      'warning',
      'less-ast-unsupported-block-header',
      'Less AST parser skipped a block with an unsupported header.',
      start,
      blockEnd + 1
    );
    return undefined;
  }
  if (selector === '&') {
    if (guard) {
      return ruleset({
        selector: nil(),
        guard,
        rules: rules(parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic))
      });
    }
    return rules(parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic));
  }
  const variableName = parseLessVariableBlockName(source, start, blockStart);
  if (variableName) {
    return createDetachedRulesetVariable(
      variableName,
      parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic)
    );
  }
  if (selector[0] === '@') {
    const atRule = parseAtRuleBlock(source, start, blockStart, blockEnd, addDiagnostic);
    if (atRule) {
      return atRule;
    }
    addDiagnostic(
      'warning',
      'less-ast-unsupported-at-rule',
      'Less AST parser skipped an at-rule block.',
      start,
      blockEnd + 1
    );
    return undefined;
  }
  const mixinDefinition = parseCheapMixinBlock(source, start, blockStart, blockEnd, addDiagnostic, selector, guard);
  if (mixinDefinition) {
    return mixinDefinition;
  }
  const parsedSelector = parseCheapLessSelectorList(selector);
  if (parsedSelector === undefined) {
    addDiagnostic(
      'warning',
      'less-ast-unsupported-block-header',
      'Less AST parser skipped a block with an unsupported header.',
      start,
      blockEnd + 1
    );
    return undefined;
  }
  return ruleset({
    selector: parsedSelector,
    ...(guard && { guard }),
    rules: rules(parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic))
  });
}

function parseAtRuleStatement(source: string, start: number, end: number): Node | undefined {
  const textEnd = source[end - 1] === ';' ? end - 1 : end;
  const textStart = skipSourceTrivia(source, start, textEnd, LESS_SCANNER_OPTIONS);
  const text = source.slice(textStart, textEnd).trim();
  if (!text || text[0] !== '@') {
    return undefined;
  }
  let nameEnd = 1;
  while (nameEnd < text.length && isLessNameCode(text.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  const name = text.slice(0, nameEnd);
  if (name.length === 1) {
    return undefined;
  }
  const prelude = text.slice(nameEnd).trim();
  return atrulestatement({
    name,
    ...(prelude && { prelude })
  });
}

function parseCheapMixinCallStatement(source: string, start: number, end: number): Node | undefined {
  const text = source.slice(start, end).trim();
  const importantStart = findTrailingImportantStart(text);
  const callText = importantStart === -1 ? text : text.slice(0, importantStart).trimEnd();
  const callee = readCheapMixinReferenceName(callText);
  if (!callee) {
    return undefined;
  }
  let cursor = skipSourceTrivia(callText, callee.end, callText.length, LESS_SCANNER_OPTIONS);
  if (callText[cursor] !== '(') {
    return undefined;
  }
  const argsStart = cursor + 1;
  const argsEnd = findCheapCallCloseParen(callText, cursor);
  if (argsEnd === -1) {
    return undefined;
  }
  const argsText = callText.slice(argsStart, argsEnd);
  const args = parseCheapMixinCallArgs(argsText);
  if (argsText.trim() && !args) {
    return undefined;
  }
  cursor = skipSourceTrivia(callText, argsEnd + 1, callText.length, LESS_SCANNER_OPTIONS);
  if (cursor !== callText.length) {
    return undefined;
  }
  return call({
    name: ref({ key: callee.key }, { type: 'mixin-ruleset', role: 'name' }),
    ...(args && { args })
  }, importantStart === -1 ? undefined : { markImportant: true });
}

function parseLessStatementNode(
  source: string,
  start: number,
  end: number,
  addDiagnostic: DiagnosticSink
): Node | undefined {
  const colon = findTopLevelDelimiter(source, ':', start, end, LESS_SCANNER_OPTIONS);
  if (colon === -1) {
    const statement = parseAtRuleStatement(source, start, end + 1);
    if (statement) {
      return statement;
    }
    const mixinCall = parseCheapMixinCallStatement(source, start, end);
    if (mixinCall) {
      return mixinCall;
    }
    if (source.slice(start, end).trim()) {
      const isMalformedAtRule = source[skipSourceTrivia(source, start, end, LESS_SCANNER_OPTIONS)] === '@';
      addDiagnostic(
        'warning',
        isMalformedAtRule ? 'less-ast-malformed-at-rule-statement' : 'less-ast-unsupported-statement',
        isMalformedAtRule
          ? 'Less AST parser skipped a malformed at-rule statement.'
          : 'Less AST parser skipped a statement without a top-level declaration colon.',
        start,
        end
      );
    }
    return undefined;
  }
  const variable = parseLessVariableDeclaration(source, start, colon, end);
  if (variable) {
    return variable;
  }
  const name = source.slice(start, colon).trim();
  if (!name) {
    addDiagnostic(
      'warning',
      'less-ast-empty-declaration-name',
      'Less AST parser skipped a declaration with an empty name.',
      start,
      end
    );
    return undefined;
  }
  const isCustomProperty = name.startsWith('--');
  const valueText = source.slice(colon + 1, end);
  if (isCustomProperty) {
    return decl({ name, value: valueText });
  }
  const trimmedValue = valueText.trim();
  const importantStart = findTrailingImportantStart(trimmedValue);
  return decl({
    name,
    value: importantStart === -1 ? trimmedValue : trimmedValue.slice(0, importantStart).trimEnd(),
    ...(importantStart !== -1 && { important: trimmedValue.slice(importantStart) })
  });
}

function parseLessNodes(
  source: string,
  start: number,
  end: number,
  addDiagnostic: DiagnosticSink
): Node[] {
  const children: Node[] = [];
  let cursor = start;
  while (cursor < end) {
    cursor = skipSourceTrivia(source, cursor, end, LESS_SCANNER_OPTIONS);
    if (cursor >= end) {
      break;
    }
    const blockStart = findTopLevelBlockStart(source, cursor, end, LESS_SCANNER_OPTIONS);
    const statementLimit = blockStart === -1 ? end : blockStart;
    const statementEnd = findStatementEnd(source, cursor, statementLimit, LESS_SCANNER_OPTIONS);
    if (statementEnd < statementLimit) {
      const statement = parseLessStatementNode(source, cursor, statementEnd, addDiagnostic);
      if (statement) {
        children.push(statement);
      }
      cursor = statementEnd + 1;
      continue;
    }
    if (blockStart === -1) {
      const statement = parseLessStatementNode(source, cursor, end, addDiagnostic);
      if (statement) {
        children.push(statement);
      }
      break;
    }
    const blockEnd = findBalancedBlockEnd(source, blockStart, end, LESS_SCANNER_OPTIONS);
    if (blockEnd === -1) {
      addDiagnostic(
        'error',
        'less-ast-unclosed-block',
        'Less AST parser reached the end of source before the block closed.',
        blockStart,
        end
      );
      break;
    }
    const blockNode = parseLessBlockNode(source, cursor, blockStart, blockEnd, addDiagnostic);
    if (blockNode) {
      children.push(blockNode);
    }
    cursor = blockEnd + 1;
  }
  return children;
}

/**
 * Parse a small Less stylesheet subset directly into existing core AST nodes.
 *
 * This is a scanner-first parser proof, not a compatibility parser. It accepts
 * cheap qualified rules, nested cheap qualified rules, ordinary declarations,
 * simple `@name:` variables, detached ruleset variables, cheap mixin
 * definitions, cheap parenthesized mixin calls, and statement/block at-rules.
 * Values stay as strings until a later decision proves typed parsing is
 * necessary.
 */
export function parseLessAstStylesheet(
  filePath: string,
  input: string | SourceText
): LessAstStylesheetResult {
  const sourceText = input instanceof SourceText ? input : new SourceText(input, filePath);
  const source = sourceText.text;
  let diagnostics: ParserDiagnostic[] | undefined;
  const addDiagnostic: DiagnosticSink = (severity, code, message, start, end): void => {
    diagnostics = appendParserDiagnostic(diagnostics, severity, code, message, start, end);
  };
  const children: Node[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    cursor = skipSourceTrivia(source, cursor, source.length, LESS_SCANNER_OPTIONS);
    if (cursor >= source.length) {
      break;
    }
    const blockStart = findTopLevelBlockStart(source, cursor, source.length, LESS_SCANNER_OPTIONS);
    const statementEnd = findStatementEnd(
      source,
      cursor,
      blockStart === -1 ? source.length : blockStart,
      LESS_SCANNER_OPTIONS
    );
    if (statementEnd < (blockStart === -1 ? source.length : blockStart)) {
      const statement = parseLessStatementNode(source, cursor, statementEnd, addDiagnostic);
      if (statement) {
        children.push(statement);
      }
      cursor = statementEnd + 1;
      continue;
    }
    if (blockStart === -1) {
      if (source.slice(cursor).trim()) {
        diagnostics = appendParserDiagnostic(
          diagnostics,
          'warning',
          'less-ast-unsupported-trailing-source',
          'Less AST parser skipped trailing source without a top-level block.',
          cursor,
          source.length
        );
      }
      break;
    }
    const blockEnd = findBalancedBlockEnd(source, blockStart, source.length, LESS_SCANNER_OPTIONS);
    if (blockEnd === -1) {
      diagnostics = appendParserDiagnostic(
        diagnostics,
        'error',
        'less-ast-unclosed-block',
        'Less AST parser reached the end of source before the block closed.',
        blockStart,
        source.length
      );
      break;
    }
    const blockNode = parseLessBlockNode(source, cursor, blockStart, blockEnd, addDiagnostic);
    if (blockNode) {
      children.push(blockNode);
    }
    cursor = blockEnd + 1;
  }
  return {
    tree: stylesheet(children),
    source: sourceText,
    diagnostics: diagnostics ?? EMPTY_DIAGNOSTICS
  };
}
