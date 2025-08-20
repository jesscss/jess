# awaitable-pipe

![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)

A tiny, zero-dependency pipe with friendly types that “just works”: it stays sync when everything is sync, and turns into a Promise only when something is async. No wrappers, no ceremony.

- **Stays sync when it can**: all-sync pipelines return a plain value
- **Goes async when it must**: any async input/step returns a Promise
- **One place for errors**: `safePipe` gives you a single `onError` + optional `fallback`
- **Steps-only API**: start with an initializer step (() => value | Promise), or omit it entirely
- **Typed nicely**: TypeScript keeps the sync/async shape without Result-like wrappers

## Install

```bash
pnpm add @jesscss/awaitable-pipe
# or
npm i @jesscss/awaitable-pipe
```

## Quick Start

```ts
import { pipe, safePipe } from '@jesscss/awaitable-pipe';

// Sync stays sync
const upper = (s: string) => s.toUpperCase();
const exclaim = (s: string) => s + '!';
const out = pipe('ok', upper, exclaim);   // 'OK!'

// Mixed becomes Promise
const load = async (s: string) => s + '!';
const outP = pipe('ok', upper, load);     // Promise<string>
const result = await outP;                // 'OK!'

// Start without an initial value
const s2 = pipe((x?: number) => (x ?? 2) * 3); // 6

// Single-point error handling (never throws)
const boom = () => { throw new Error('nope'); };
const safe = safePipe('ok', { onError: console.error, fallback: 'X' }, boom, upper);
// 'X'
```

## API

### pipe(...steps)
- **Return shape**: sync returns a value; any async → Promise
- **Errors**: sync errors throw; async errors reject
- **Inputs**: value, Promise, thunk (() => value|Promise), or omit (first step gets `undefined`)

```ts
// compose sync functions → string
const a = pipe(() => 'hi', (s) => s.trim(), (s) => s.toUpperCase());

// mix in async → Promise<string>
const b = pipe(() => 'hi', async (s) => s + '!', (s) => s + '?');

// no initial value
const c = pipe((x?: number) => (x ?? 1) + 1, (n) => n * 10); // 20
```

### safePipe(optionsOrStep, ...steps)
If you prefer not to throw or reject, `safePipe` centralizes error handling. You get an optional `onError` callback and a `fallback` value (or thunk). On error, the pipeline returns the fallback (or `undefined` if you didn’t provide one).

- **Never throws**: errors are caught and routed to `onError`
- **Return shape preserved**: still sync-if-sync, async-if-async
- **Flexible start**: with a value/Promise/thunk or no initial value (options-first)

```ts
// Sync-only path
const r1 = safePipe({ onError: console.warn, fallback: 'X' }, () => 'ok', (s: string) => s.toUpperCase()); // 'OK'

// Sync error → fallback
const r2 = safePipe({ onError: console.warn, fallback: 'X' },
  () => { throw new Error('boom'); },
  (s: string) => s.toUpperCase()
); // 'X'

// Async path → Promise<string>
const r3 = await safePipe({ onError: console.warn, fallback: 'X' },
  () => 'ok',
  async (s: string) => s + '!',
  (s: string) => s + '?'
); // 'ok!?'

// 1) No initial value (options-first). First step receives undefined.
const r4 = safePipe({ onError: console.warn, fallback: 0 },
  (x?: number) => (x ?? 2) * 5,
  (n) => n + 1
); // 11

// 2) No fallback provided. On error, returns undefined (never throws).
const r5 = safePipe('ok', { onError: console.warn },
  () => { throw new Error('boom'); },
  (s: string) => s.toUpperCase()
); // undefined
```

## Composing pipes
You can feed the output of one pipe (value or Promise) into another. Types keep up with you.

```ts
const p1 = pipe(() => 'hi', (s: string) => s.toUpperCase()); // string
const p2 = pipe(() => p1, (s) => s + '!');                   // 'HI!'

const p3 = pipe(() => 'hi', async s => s + '!');             // Promise<string>
const p4 = pipe(() => p3, (s) => s + '?');                   // Promise<string>
const fin = await p4;                                        // 'hi!?'
```

## Per-step helpers
Sometimes you want to guard or handle errors at a specific step without switching the whole pipeline to safe mode. Use these helpers as steps inside `pipe` or `safePipe`:

```ts
import { pipe, tryStep, guard } from '@jesscss/awaitable-pipe';

// tryStep: catch at this step only, with optional onError and fallback
const step = tryStep((n: number) => {
  if (n < 0) throw new Error('no negatives');
  return n * 2;
}, {
  onError: (err, n) => console.warn('bad number:', n, err),
  fallback: 0 // could also be (err, n) => 0
});

const out = pipe(() => 5, step);   // 10
const out2 = pipe(() => -1, step); // 0

// guard: ensure a condition holds at this step (sync or async)
const positive = guard((n: number) => n > 0, (n) => new Error(`not positive: ${n}`));
const ok = pipe(() => 3, positive);         // 3
// pipe(() => -2, positive) would throw: Error('not positive: -2')
```

## Why would you want this?
JavaScript Promises are great, but they aren’t free. Every async hop schedules work, allocates objects, and pushes errors across an async boundary. In hot paths, that overhead adds up.

- **Zero extra overhead for sync work**: when your steps are synchronous, you get plain values—no microtasks, no `await`, no extra Promise allocations.
- **Seamless async when you need it**: if any step is async, the pipeline naturally promotes to a Promise—no special handling required.
- **Cleaner stacks**: sync-only flows keep straightforward stack traces and easier debugging.
- **Simple error strategy**: prefer natural throw/reject with `pipe`, or centralize it once with `safePipe` without wrapping results.

The result: familiar ergonomics, fast by default.

## License
MIT
