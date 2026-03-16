import { Node } from '../node.js';

export type SerializeTypesOptions = {
  // Include primitive main values next to the type when useful
  showValues?: boolean;
  // Include options next to the type when useful
  showOptions?: boolean;
  // Max length for printed strings; longer strings are truncated with …
  maxStringLength?: number;
  // Use shortType instead of type
  useShortType?: boolean;
  // Indentation size in spaces
  indentSize?: number;
};

const defaultOptions: Required<SerializeTypesOptions> = {
  showValues: true,
  showOptions: false,
  maxStringLength: 40,
  useShortType: false,
  indentSize: 2
};

function isJessNode(value: unknown): value is Node {
  return value instanceof Node;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  return typeof value === 'object';
}

function truncate(str: string, max: number): string {
  if (str.length <= max) {
    return str;
  }
  return `${str.slice(0, max - 1)}…`;
}

function formatPrimitive(value: unknown, opts: Required<SerializeTypesOptions>): string {
  if (typeof value === 'string') {
    const content = truncate(value, opts.maxStringLength);
    return `'${content.replace(/'/g, '\\\'')}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  return String(value);
}

function indent(depth: number, size: number): string {
  return ''.padStart(depth * size);
}

function summarizeArray(items: unknown[], opts: Required<SerializeTypesOptions>): string {
  // For non-node arrays emit a compact summary: [a, b]
  const parts = items.map((item) => {
    if (isJessNode(item)) {
      return opts.useShortType ? (item as any).shortType : (item as any).type;
    }
    if (Array.isArray(item)) {
      return '[' + summarizeArray(item, opts) + ']';
    }
    return formatPrimitive(item, opts);
  });
  return parts.join(', ');
}

function serializeArray(arr: unknown[], depth: number, opts: Required<SerializeTypesOptions>, visiting: Set<Node>): string {
  const pad = indent(depth, opts.indentSize);
  if (arr.length === 0) {
    return `${pad}[]`;
  }
  const first = arr[0];
  if (isJessNode(first)) {
    const inner = arr.map(item => serializeNode(item as Node, depth + 1, opts, visiting)).join('\n');
    return `${pad}[\n${inner}\n${pad}]`;
  }
  // Not a node array; show compact
  return `${pad}[${summarizeArray(arr, opts)}]`;
}

function serializePlainObject(obj: Record<string, unknown>, depth: number, opts: Required<SerializeTypesOptions>, visiting: Set<Node>): string {
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined);
  if (keys.length === 0) {
    return '';
  }
  const lines: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (isJessNode(v)) {
      const inner = '\n' + serializeNode(v, depth + 2, opts, visiting);
      lines.push(`${indent(depth + 1, opts.indentSize)}${key}: ${inner}`);
    } else if (Array.isArray(v)) {
      const inner = serializeArray(v, depth + 2, opts, visiting);
      lines.push(`${indent(depth + 1, opts.indentSize)}${key}:\n${inner}`);
    } else if (isPlainObject(v)) {
      const inner = serializePlainObject(v as Record<string, unknown>, depth + 1, opts, visiting);
      if (inner) {
        lines.push(`${indent(depth + 1, opts.indentSize)}${key}: {\n${inner}\n${indent(depth + 1, opts.indentSize)}}`);
      } else {
        lines.push(`${indent(depth + 1, opts.indentSize)}${key}: {}`);
      }
    } else {
      lines.push(`${indent(depth + 1, opts.indentSize)}${key}: ${formatPrimitive(v, opts)}`);
    }
  }
  return lines.join('\n');
}

function serializeNodeOptions(n: Node, depth: number, opts: Required<SerializeTypesOptions>, visiting: Set<Node>): string | null {
  if (!opts.showOptions) {
    return null;
  }
  const nodeOptions = (n as any).options;
  if (!nodeOptions || typeof nodeOptions !== 'object') {
    return null;
  }
  // Check if there are any non-undefined properties
  const keys = Object.keys(nodeOptions).filter(k => nodeOptions[k] !== undefined);
  if (keys.length === 0) {
    return null;
  }
  return serializePlainObject(nodeOptions, depth + 1, opts, visiting);
}

function serializeNode(n: Node, depth: number, opts: Required<SerializeTypesOptions>, visiting: Set<Node>): string {
  const typeName = opts.useShortType ? (n as any).shortType : (n as any).type;
  const pad = indent(depth, opts.indentSize);
  const role = (n as any)?.role as string | undefined;
  const meta = role ? ` [role=${role}]` : '';
  const open = `${pad}(${typeName}${meta}`;

  // Protect against cycles
  if (visiting.has(n)) {
    return `${open} …)`;
  }
  visiting.add(n);

  const value = (n as any).data as unknown;
  const optionsStr = serializeNodeOptions(n, depth, opts, visiting);

  // If the main value is a primitive, include it inline
  if (
    value === null
    || value === undefined
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    visiting.delete(n);
    if (optionsStr) {
      if (opts.showValues && value !== undefined) {
        const rendered = formatPrimitive(value, opts);
        return `${open}\n${optionsStr}\n${indent(depth + 1, opts.indentSize)}${rendered}\n${pad})`;
      }
      return `${open}\n${optionsStr}\n${pad})`;
    }
    if (opts.showValues && value !== undefined) {
      const rendered = formatPrimitive(value, opts);
      return `${open} ${rendered})`;
    }
    return `${open})`;
  }

  // If the main value is a Node, print it on next line
  if (isJessNode(value)) {
    const inner = '\n' + serializeNode(value, depth + 1, opts, visiting);
    visiting.delete(n);
    if (optionsStr) {
      return `${open}\n${optionsStr}${inner}\n${pad})`;
    }
    return `${open}${inner}\n${pad})`;
  }

  // Special-case Number plain object: print compact form
  if (typeName === 'Num' && isPlainObject(value)) {
    const num = (value as any).number;
    const keys = Object.keys(value as Record<string, unknown>).filter(k => (value as any)[k] !== undefined);
    if (typeof num === 'number' && (keys.length === 1 || (keys.length === 0))) {
      visiting.delete(n);
      if (optionsStr) {
        return `${open}\n${optionsStr}\n${indent(depth + 1, opts.indentSize)}${num}\n${pad})`;
      }
      return `${open} ${num})`;
    }
  }

  // If the main value is an array
  if (Array.isArray(value)) {
    const arrStr = serializeArray(value, depth + 1, opts, visiting);
    visiting.delete(n);
    if (optionsStr) {
      return `${open}\n${optionsStr}\n${arrStr}\n${pad})`;
    }
    return `${open}\n${arrStr}\n${pad})`;
  }

  // If the main value is a plain object, print key: value summaries
  if (isPlainObject(value)) {
    const inner = serializePlainObject(value as Record<string, unknown>, depth, opts, visiting);
    visiting.delete(n);
    if (optionsStr) {
      return `${open}\n${optionsStr}${inner ? '\n' + inner : ''}\n${pad})`;
    }
    return inner ? `${open}\n${inner}\n${pad})` : `${open})`;
  }

  visiting.delete(n);
  if (optionsStr) {
    return `${open}\n${optionsStr}\n${pad})`;
  }
  return `${open})`;
}

function serializeUnknown(value: unknown, depth: number, opts: Required<SerializeTypesOptions>, visiting: Set<Node>): string {
  if (isJessNode(value)) {
    return serializeNode(value, depth, opts, visiting);
  }
  if (Array.isArray(value)) {
    const arr = summarizeArray(value, opts);
    return `${indent(depth, opts.indentSize)}[${arr}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    const parts = keys.map(k => `${k}: ${formatPrimitive((value as Record<string, unknown>)[k], opts)}`);
    return `${indent(depth, opts.indentSize)}{ ${parts.join(', ')} }`;
  }
  return `${indent(depth, opts.indentSize)}${formatPrimitive(value, opts)}`;
}

export function serializeTypes(value: unknown, options?: SerializeTypesOptions): string {
  const opts: Required<SerializeTypesOptions> = { ...defaultOptions, ...(options ?? {}) };
  const visiting = new Set<Node>();
  return serializeUnknown(value, 0, opts, visiting);
}
