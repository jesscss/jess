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
  num,
  paren,
  query,
  quoted,
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
  scanCheapSelectorListComponents,
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

type LessAstParseContext = {
  allowKeyframeSelectors?: boolean;
};

const DEFAULT_PARSE_CONTEXT: LessAstParseContext = {};
const KEYFRAMES_PARSE_CONTEXT: LessAstParseContext = { allowKeyframeSelectors: true };

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

function findLessTopLevelBlockStart(source: string, offset: number, end: number): number {
  let cursor = offset;
  while (cursor < end) {
    const blockStart = findTopLevelBlockStart(source, cursor, end, LESS_SCANNER_OPTIONS);
    if (blockStart === -1) {
      return -1;
    }
    if (blockStart > offset && source[blockStart - 1] === '@') {
      const interpolationEnd = source.indexOf('}', blockStart + 1);
      if (interpolationEnd !== -1 && interpolationEnd < end) {
        cursor = interpolationEnd + 1;
        continue;
      }
    }
    return blockStart;
  }
  return -1;
}

function isBalancedLessDeferredText(text: string, options?: { requireInterpolation?: boolean }): boolean {
  if (!text) {
    return false;
  }
  let expectedClose = '';
  let sawInterpolation = false;
  let cursor = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '"' || char === '\'') {
      cursor = skipQuotedSourceString(text, cursor, text.length);
      continue;
    }
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === '@' && text[cursor + 1] === '{') {
      const interpolationEnd = text.indexOf('}', cursor + 2);
      if (interpolationEnd === -1) {
        return false;
      }
      sawInterpolation = true;
      cursor = interpolationEnd + 1;
      continue;
    }
    if (char === '/' && text[cursor + 1] === '*') {
      const commentEnd = text.indexOf('*/', cursor + 2);
      if (commentEnd === -1) {
        return false;
      }
      cursor = commentEnd + 2;
      continue;
    }
    if (char === '/' && text[cursor + 1] === '/') {
      cursor += 2;
      while (cursor < text.length) {
        const code = text.charCodeAt(cursor);
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
      return false;
    } else if (char === ')' || char === ']' || char === '}') {
      if (expectedClose[expectedClose.length - 1] !== char) {
        return false;
      }
      expectedClose = expectedClose.slice(0, -1);
    }
    cursor++;
  }
  return expectedClose.length === 0 && (!options?.requireInterpolation || sawInterpolation);
}

function parseLessAtRulePrelude(text: string): AtRulePrelude | undefined {
  const prelude = parseCheapAtRulePrelude(text, LESS_SCANNER_OPTIONS)
    ?? parseCheapAtRulePreludeList(text, LESS_SCANNER_OPTIONS);
  if (prelude !== undefined) {
    return prelude;
  }
  return isBalancedLessDeferredText(text) ? text : undefined;
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

function parseCheapLessSelectorList(selector: string): string | Selector | undefined {
  const selectorList = scanCheapSelectorListComponents(selector, LESS_SCANNER_OPTIONS);
  if (!selectorList) {
    return undefined;
  }
  const items = selectorList.map(materializeCheapSelector);
  return items.length > 1 ? sellist(items) : items[0];
}

function findTopLevelParenOpen(text: string): number {
  let bracketDepth = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '"' || char === '\'') {
      cursor = skipQuotedSourceString(text, cursor, text.length);
      continue;
    }
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === '@' && text[cursor + 1] === '{') {
      const interpolationEnd = text.indexOf('}', cursor + 2);
      if (interpolationEnd === -1) {
        return -1;
      }
      cursor = interpolationEnd + 1;
      continue;
    }
    if (char === '[') {
      bracketDepth++;
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === '(' && bracketDepth === 0) {
      return cursor;
    }
    cursor++;
  }
  return -1;
}

function looksLikeInterpolatedMixinHead(text: string): boolean {
  const head = text.trim();
  if (head[0] !== '.' && head[0] !== '#') {
    return false;
  }
  for (let i = 1; i < head.length; i++) {
    const char = head[i];
    if (
      isLessHeaderSpace(head.charCodeAt(i))
      || char === '>'
      || char === '+'
      || char === '~'
      || char === ':'
      || char === '['
      || char === ']'
    ) {
      return false;
    }
  }
  return true;
}

function parseDeferredLessSelector(selector: string): string | undefined {
  const source = selector.trim();
  const parenOpen = findTopLevelParenOpen(source);
  if (parenOpen !== -1 && looksLikeInterpolatedMixinHead(source.slice(0, parenOpen))) {
    return undefined;
  }
  return isBalancedLessDeferredText(source, { requireInterpolation: true }) ? source : undefined;
}

function parseDeferredLessAmpersandSelector(selector: string): string | undefined {
  const source = selector.trim();
  if (source === '&' || source[0] !== '&' || source.includes('(') || source.includes(')')) {
    return undefined;
  }
  return isBalancedLessDeferredText(source) ? source : undefined;
}

function parseKeyframeSelectorArm(text: string): string | undefined {
  const source = text.trim();
  if (source === 'from' || source === 'to') {
    return source;
  }
  if (source.length < 2 || source[source.length - 1] !== '%') {
    return undefined;
  }
  let dot = false;
  for (let i = 0; i < source.length - 1; i++) {
    const code = source.charCodeAt(i);
    if (code >= 48 && code <= 57) {
      continue;
    }
    if (code === 46 && !dot) {
      dot = true;
      continue;
    }
    return undefined;
  }
  return source[0] === '.' || source[source.length - 2] === '.' ? undefined : source;
}

function parseKeyframeSelectorList(selector: string): string | Selector | undefined {
  const firstComma = findTopLevelDelimiter(selector, ',', 0, selector.length, LESS_SCANNER_OPTIONS);
  if (firstComma === -1) {
    return parseKeyframeSelectorArm(selector);
  }
  const first = parseKeyframeSelectorArm(selector.slice(0, firstComma));
  if (first === undefined) {
    return undefined;
  }
  const items = [first];
  let cursor = firstComma + 1;
  while (cursor < selector.length) {
    const comma = findTopLevelDelimiter(selector, ',', cursor, selector.length, LESS_SCANNER_OPTIONS);
    const itemEnd = comma === -1 ? selector.length : comma;
    const item = parseKeyframeSelectorArm(selector.slice(cursor, itemEnd));
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
    if (comma === -1) {
      break;
    }
    cursor = comma + 1;
  }
  return sellist(items);
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
  return new VarDeclaration({
    name,
    value: mixin({ rules: body }, {
      rulesVisibility: {
        Mixin: 'private',
        VarDeclaration: 'private'
      }
    })
  });
}

type CheapMixinHeader = {
  name: string;
  params?: ReturnType<typeof list>;
};
type CheapMixinParam = Node;

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

function hasBalancedCheapDelimitedText(source: string, allowBlocks: boolean): boolean {
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
      if (!allowBlocks) {
        return false;
      }
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

function hasBalancedCheapArgumentText(source: string): boolean {
  return hasBalancedCheapDelimitedText(source, true);
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

function parseCheapMixinLiteralParam(text: string): Node | undefined {
  if (
    !text
    || text.endsWith('...')
    || findTopLevelDelimiter(text, ':', 0, text.length, LESS_SCANNER_OPTIONS) !== -1
  ) {
    return undefined;
  }
  return parseCheapQuotedFunctionArg(text)
    ?? parseCheapNumberFunctionArg(text)
    ?? parseCheapIdentFunctionArg(text);
}

function parseCheapMixinParam(source: string): CheapMixinParam | undefined {
  const text = source.trim();
  if (text === '...') {
    return rest();
  }
  if (text[0] !== '@') {
    return parseCheapMixinLiteralParam(text);
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

function isCheapMixinDeclarationParamText(source: string): boolean {
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
      && !isCheapMixinDeclarationParamText(nextSegment)
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
      || !hasBalancedCheapArgumentText(arg)
      || (separator === ';' && !hasNoEmptyTopLevelCommaArms(arg))
    ) {
      return undefined;
    }
    const spread = parseCheapMixinCallSpreadArg(arg);
    if (spread) {
      args.push(spread);
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
      continue;
    }
    if (arg.endsWith('...')) {
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

function parseCheapMixinCallSpreadArg(arg: string): ReturnType<typeof rest> | undefined {
  if (arg === '...') {
    return rest();
  }
  if (!arg.endsWith('...') || arg[0] !== '@') {
    return undefined;
  }
  const nameLimit = arg.length - 3;
  let nameEnd = 1;
  while (nameEnd < nameLimit && isLessNameCode(arg.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  if (nameEnd === 1 || nameEnd !== nameLimit) {
    return undefined;
  }
  return rest(ref({ key: arg.slice(1, nameEnd) }, { type: 'variable' }));
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

/**
 * Read Less namespace mixin references without materializing selector nodes.
 *
 * Less treats `#ns.mixin()`, `#ns .mixin()`, and `#ns > .mixin()` as the same
 * lookup path shape, so the scanner-first path stores only the reference keys.
 */
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
    if (source[cursor] === '.' || source[cursor] === '#') {
      continue;
    }
    const separator = skipSourceTrivia(source, cursor, source.length, LESS_SCANNER_OPTIONS);
    const next = source[separator] === '>'
      ? skipSourceTrivia(source, separator + 1, source.length, LESS_SCANNER_OPTIONS)
      : separator;
    if (next === cursor || (source[next] !== '.' && source[next] !== '#')) {
      break;
    }
    cursor = next;
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
    rules: parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic)
  });
}

function isKeyframesAtRuleName(name: string): boolean {
  return /^@(?:-[a-z]+-)?keyframes$/iu.test(name);
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
  const prelude = parseLessAtRulePrelude(preludeText);
  if (preludeText && !prelude) {
    return undefined;
  }
  return atrule({
    name,
    ...(prelude !== undefined && { prelude }),
    rules: parseLessNodes(
      source,
      blockStart + 1,
      blockEnd,
      addDiagnostic,
      isKeyframesAtRuleName(name) ? KEYFRAMES_PARSE_CONTEXT : DEFAULT_PARSE_CONTEXT
    )
  });
}

function parseLessBlockNode(
  source: string,
  start: number,
  blockStart: number,
  blockEnd: number,
  addDiagnostic: DiagnosticSink,
  context: LessAstParseContext
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
        rules: parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic)
      });
    }
    return rules(parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic));
  }
  const deferredAmpersandSelector = parseDeferredLessAmpersandSelector(selector);
  if (deferredAmpersandSelector !== undefined) {
    return ruleset({
      selector: deferredAmpersandSelector,
      ...(guard && { guard }),
      rules: parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic)
    }, { deferSelectorMaterialization: true });
  }
  const variableName = parseLessVariableBlockName(source, start, blockStart);
  if (variableName) {
    return createDetachedRulesetVariable(
      variableName,
      parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic)
    );
  }
  if (selector[0] === '@' && selector[1] !== '{') {
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
  const deferredSelector = parseDeferredLessSelector(selector);
  if (deferredSelector !== undefined) {
    return ruleset({
      selector: deferredSelector,
      ...(guard && { guard }),
      rules: parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic)
    }, { deferSelectorMaterialization: true });
  }
  const mixinDefinition = parseCheapMixinBlock(source, start, blockStart, blockEnd, addDiagnostic, selector, guard);
  if (mixinDefinition) {
    return mixinDefinition;
  }
  const parsedSelector = context.allowKeyframeSelectors && !guard
    ? parseKeyframeSelectorList(selector)
    : parseCheapLessSelectorList(selector);
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
    rules: parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic)
  }, context.allowKeyframeSelectors ? { deferSelectorMaterialization: true } : undefined);
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

function readCheapFunctionName(source: string): CheapMixinName | undefined {
  const first = source.charCodeAt(0);
  if (
    !((first >= 65 && first <= 90) || (first >= 97 && first <= 122) || first === 95)
  ) {
    return undefined;
  }
  let nameEnd = 1;
  while (nameEnd < source.length && isLessNameCode(source.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  return { name: source.slice(0, nameEnd), end: nameEnd };
}

function parseCheapQuotedFunctionArg(text: string): Node | undefined {
  const quote = text[0];
  if ((quote !== '"' && quote !== '\'') || skipQuotedSourceString(text, 0, text.length) !== text.length) {
    return undefined;
  }
  return quoted(any(text.slice(1, -1), { role: 'any' }), { quote });
}

function parseCheapVariableFunctionArg(text: string): Node | undefined {
  if (text[0] !== '@') {
    return undefined;
  }
  let nameEnd = 1;
  while (nameEnd < text.length && isLessNameCode(text.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  return nameEnd > 1 && nameEnd === text.length
    ? ref({ key: text.slice(1) }, { type: 'variable' })
    : undefined;
}

function parseCheapNumberFunctionArg(text: string): Node | undefined {
  let cursor = text[0] === '-' || text[0] === '+' ? 1 : 0;
  let digits = 0;
  while (cursor < text.length) {
    const code = text.charCodeAt(cursor);
    if (code < 48 || code > 57) {
      break;
    }
    cursor++;
    digits++;
  }
  if (text[cursor] === '.') {
    cursor++;
    while (cursor < text.length) {
      const code = text.charCodeAt(cursor);
      if (code < 48 || code > 57) {
        break;
      }
      cursor++;
      digits++;
    }
  }
  return digits > 0 && cursor === text.length ? num(Number(text)) : undefined;
}

function parseCheapIdentFunctionArg(text: string): Node | undefined {
  if (!text) {
    return undefined;
  }
  for (let i = 0; i < text.length; i++) {
    if (!isLessNameCode(text.charCodeAt(i))) {
      return undefined;
    }
  }
  return any(text, { role: 'ident' });
}

function parseCheapFunctionCallArgList(source: string): Node[] | undefined {
  const items: Node[] = [];
  let cursor = 0;
  while (cursor <= source.length) {
    const comma = findTopLevelDelimiter(source, ',', cursor, source.length, LESS_SCANNER_OPTIONS);
    const itemEnd = comma === -1 ? source.length : comma;
    const item = parseCheapFunctionCallArg(source.slice(cursor, itemEnd));
    if (!item) {
      return undefined;
    }
    items.push(item);
    if (comma === -1) {
      return items;
    }
    cursor = comma + 1;
    if (cursor >= source.length) {
      return undefined;
    }
  }
  return undefined;
}

function parseCheapEscapedParenFunctionArg(text: string): Node | undefined {
  if (!text.startsWith('~(')) {
    return undefined;
  }
  const close = findCheapCallCloseParen(text, 1);
  if (close !== text.length - 1) {
    return undefined;
  }
  const inner = text.slice(2, close).trim();
  if (!inner) {
    return paren(undefined, { escaped: true });
  }
  const items = parseCheapFunctionCallArgList(inner);
  return items ? paren(list(items), { escaped: true }) : undefined;
}

function parseCheapFunctionCallArg(source: string): Node | undefined {
  const text = source.trim();
  return parseCheapEscapedParenFunctionArg(text)
    ?? parseCheapQuotedFunctionArg(text)
    ?? parseCheapVariableFunctionArg(text)
    ?? parseCheapNumberFunctionArg(text)
    ?? parseCheapIdentFunctionArg(text);
}

function parseCheapFunctionCallArgs(source: string): ReturnType<typeof list> | undefined {
  const text = source.trim();
  if (!text) {
    return undefined;
  }
  const semi = findTopLevelDelimiter(text, ';', 0, text.length, LESS_SCANNER_OPTIONS);
  const args: Node[] = [];
  if (semi !== -1) {
    let cursor = 0;
    while (cursor <= text.length) {
      const end = findTopLevelDelimiter(text, ';', cursor, text.length, LESS_SCANNER_OPTIONS);
      const partEnd = end === -1 ? text.length : end;
      const segment = text.slice(cursor, partEnd);
      const items = parseCheapFunctionCallArgList(segment);
      if (!items?.length) {
        return undefined;
      }
      args.push(items.length === 1 ? items[0]! : list(items));
      if (end === -1) {
        break;
      }
      cursor = end + 1;
      if (cursor >= text.length) {
        return undefined;
      }
    }
    return list(args, { sep: ';' });
  }
  const items = parseCheapFunctionCallArgList(text);
  return items ? list(items) : undefined;
}

function parseCheapFunctionCallStatement(source: string, start: number, end: number): Node | undefined {
  const text = source.slice(start, end).trim();
  const callee = readCheapFunctionName(text);
  if (!callee) {
    return undefined;
  }
  let cursor = skipSourceTrivia(text, callee.end, text.length, LESS_SCANNER_OPTIONS);
  if (text[cursor] !== '(') {
    return undefined;
  }
  const argsStart = cursor + 1;
  const argsEnd = findCheapCallCloseParen(text, cursor);
  if (argsEnd === -1) {
    return undefined;
  }
  const argsText = text.slice(argsStart, argsEnd);
  const args = parseCheapFunctionCallArgs(argsText);
  if (argsText.trim() && !args) {
    return undefined;
  }
  cursor = skipSourceTrivia(text, argsEnd + 1, text.length, LESS_SCANNER_OPTIONS);
  if (cursor !== text.length) {
    return undefined;
  }
  return call({
    name: ref(callee.name, { type: 'function', fallbackValue: true }),
    ...(args && { args })
  }, { silentFail: true });
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
    const functionCall = parseCheapFunctionCallStatement(source, start, end);
    if (functionCall) {
      return functionCall;
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
  addDiagnostic: DiagnosticSink,
  context: LessAstParseContext = DEFAULT_PARSE_CONTEXT
): Node[] {
  const children: Node[] = [];
  let cursor = start;
  while (cursor < end) {
    cursor = skipSourceTrivia(source, cursor, end, LESS_SCANNER_OPTIONS);
    if (cursor >= end) {
      break;
    }
    const blockStart = findLessTopLevelBlockStart(source, cursor, end);
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
    const blockNode = parseLessBlockNode(source, cursor, blockStart, blockEnd, addDiagnostic, context);
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
    const blockStart = findLessTopLevelBlockStart(source, cursor, source.length);
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
    const blockNode = parseLessBlockNode(source, cursor, blockStart, blockEnd, addDiagnostic, DEFAULT_PARSE_CONTEXT);
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
