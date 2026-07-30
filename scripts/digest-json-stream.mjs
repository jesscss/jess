/**
 * STREAMING JSON DIGEST — the replacement for `sha256(JSON.stringify(tree))`.
 *
 * `JSON.stringify` on an AST/CST has three independent disqualifiers, any one
 * of them fatal on its own:
 *
 *   CYCLES          a parent pointer or a shared subtree throws
 *                   `TypeError: Converting circular structure to JSON`
 *   STACK DEPTH     it recurses with no depth guard
 *   MATERIALIZATION it builds the ENTIRE tree as one string before the hash can
 *                   consume a single byte, which is what OOMs a corpus-scale
 *                   oracle at 8 GB
 *
 * The fix is to REMOVE THE STRING, not to swap in a faster stringifier: a
 * faster stringifier still builds the string, so it addresses none of the three.
 *
 * WHAT THIS GUARANTEES. `digestJson(value)` returns byte-for-byte the same
 * `{ bytes, sha256 }` that `digestBuffer(Buffer.from(JSON.stringify(value)))`
 * returned, for every value on which `JSON.stringify` succeeds. That is not an
 * aspiration — it is the point. If a digest moves, the canonicalization has
 * changed and that is a bug, not an improvement.
 *
 * HOW IT STAYS IDENTICAL. Only the STRUCTURAL characters (`{}[],:`) are emitted
 * by this file. Every leaf — every string, every number — is encoded by
 * `JSON.stringify` itself, one small scalar at a time. So the escaping, the
 * number formatting and the lone-surrogate handling are the platform's, exactly
 * as before, and there is no second implementation of them to drift.
 *
 * The three disqualifiers are answered directly:
 *   - traversal uses an EXPLICIT STACK, so tree depth costs heap, not frames
 *   - a cycle is detected on the ancestor path and reported with that path,
 *     rather than surfacing as `JSON.stringify`'s context-free TypeError
 *   - output is flushed into the hash in bounded chunks and never accumulated
 */
import { createHash } from 'node:crypto';

/**
 * Flush threshold in UTF-16 units. Chunks are only ever cut at a token
 * boundary, never inside an encoded leaf, so a surrogate pair can never be
 * split across two `Buffer.from` calls (which would encode differently from
 * the same text encoded whole).
 */
const FLUSH_AT = 1 << 16;

function createSink() {
  const hash = createHash('sha256');
  let pending = '';
  let bytes = 0;

  function flush() {
    if (pending === '') {
      return;
    }
    const buffer = Buffer.from(pending, 'utf8');
    bytes += buffer.length;
    hash.update(buffer);
    pending = '';
  }

  return {
    emit(text) {
      pending += text;
      if (pending.length >= FLUSH_AT) {
        flush();
      }
    },
    finish() {
      flush();
      return { bytes, sha256: hash.digest('hex') };
    }
  };
}

/**
 * `JSON.stringify`'s own disposition for a value, applied before we decide
 * whether it is a container. Mirrors SerializeJSONProperty: `toJSON` first,
 * then the scalar cases. Returns `undefined` for values JSON omits.
 *
 * NOTE `toJSON` is load-bearing here, not incidental: `packages/core/src/tree/
 * node-base.ts` defines `toJSON()` on every node precisely to drop the
 * back-references that would otherwise make a node cyclic. Honoring it is what
 * keeps this identical to the previous behavior.
 */
function resolveValue(value, key) {
  let resolved = value;
  if (resolved !== null && typeof resolved === 'object' && typeof resolved.toJSON === 'function') {
    resolved = resolved.toJSON(key);
  }
  return unwrapBoxed(resolved);
}

/**
 * SerializeJSONProperty steps 4-7: a boxed primitive is serialized as the
 * primitive it wraps, NOT as an object. `JSON.stringify(new Number(5))` is `5`,
 * and `new String('x')` is `"x"` rather than `{"0":"x"}`.
 *
 * Easy to miss because `typeof` reports `'object'` for all of them, which would
 * send them down the container path and silently change the digest. Dispatch is
 * on the internal slot via `Object.prototype.toString`, so it is also correct
 * for a cross-realm box.
 */
function unwrapBoxed(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  switch (Object.prototype.toString.call(value)) {
    case '[object Number]':
      return Number(value);
    case '[object String]':
      return String(value);
    case '[object Boolean]':
    case '[object BigInt]':
      return value.valueOf();
    default:
      return value;
  }
}

/** The encoding of a non-container, or `undefined` if JSON omits the value. */
function encodeScalar(value) {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
      throw new TypeError('Do not know how to serialize a BigInt');
    default:
      // undefined, function, symbol — omitted by JSON.stringify.
      return undefined;
  }
}

function isContainer(value) {
  return value !== null && typeof value === 'object';
}

function describePath(path) {
  // The root frame carries an empty label; it contributes no path segment.
  const segments = path.filter(segment => segment !== '');
  return segments.length === 0 ? '<root>' : segments.join('.');
}

/**
 * sha256 + UTF-8 byte count of `JSON.stringify(root)`, computed without ever
 * holding that string.
 *
 * Returns `undefined` when `JSON.stringify` would itself return `undefined`
 * (a bare `undefined`, function or symbol at the root), so callers can keep
 * whatever handling they already had for that case.
 */
export function digestJson(root) {
  const resolvedRoot = resolveValue(root, '');
  if (!isContainer(resolvedRoot)) {
    const encoded = encodeScalar(resolvedRoot);
    if (encoded === undefined) {
      return undefined;
    }
    const sink = createSink();
    sink.emit(encoded);
    return sink.finish();
  }

  const sink = createSink();

  /*
   * One frame per open container. `onPath` is the ancestor set — a cycle is a
   * repeat along the path, NOT merely a value seen twice: a shared subtree is
   * legal in JSON (it is duplicated in the output) and must not be rejected.
   */
  const stack = [];
  const onPath = new Set();

  function pushContainer(value, label) {
    if (onPath.has(value)) {
      throw new TypeError(
        `Converting circular structure to JSON at ${describePath([...stack.map(f => f.label), label])}`
      );
    }
    onPath.add(value);
    if (Array.isArray(value)) {
      /*
       * `length` is snapshotted once, as SerializeJSONArray does. Re-reading it
       * each turn would diverge if a getter mutated the array mid-walk.
       */
      stack.push({ kind: 'array', value, label, index: 0, length: value.length });
      sink.emit('[');
    } else {
      stack.push({ kind: 'object', value, label, keys: Object.keys(value), index: 0, wrote: false });
      sink.emit('{');
    }
  }

  /**
   * Emit one ALREADY-RESOLVED member value. Containers are pushed and emitted
   * on later turns; scalars are emitted inline. Returns false when JSON omits
   * the value, so an object member can be skipped and an array hole can become
   * `null`.
   *
   * Takes the resolved value rather than the raw one so that `toJSON` is called
   * exactly once per member, as `JSON.stringify` calls it.
   */
  function emitResolved(value, label) {
    if (isContainer(value)) {
      pushContainer(value, label);
      return true;
    }
    const encoded = encodeScalar(value);
    if (encoded === undefined) {
      return false;
    }
    sink.emit(encoded);
    return true;
  }

  pushContainer(resolvedRoot, '');

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];

    if (frame.kind === 'array') {
      if (frame.index >= frame.length) {
        sink.emit(']');
        onPath.delete(frame.value);
        stack.pop();
        continue;
      }
      const index = frame.index++;
      if (index > 0) {
        sink.emit(',');
      }
      const key = String(index);

      // An omitted element is `null` in an array, never a hole.
      if (!emitResolved(resolveValue(frame.value[index], key), key)) {
        sink.emit('null');
      }
      continue;
    }

    if (frame.index >= frame.keys.length) {
      sink.emit('}');
      onPath.delete(frame.value);
      stack.pop();
      continue;
    }

    const key = frame.keys[frame.index++];
    const resolved = resolveValue(frame.value[key], key);

    /*
     * Decide the separator only AFTER the member is known to be emitted: a
     * member JSON omits must not leave a dangling comma.
     */
    if (!isContainer(resolved) && encodeScalar(resolved) === undefined) {
      continue;
    }
    if (frame.wrote) {
      sink.emit(',');
    }
    sink.emit(`${JSON.stringify(key)}:`);
    frame.wrote = true;
    emitResolved(resolved, key);
  }

  return sink.finish();
}
