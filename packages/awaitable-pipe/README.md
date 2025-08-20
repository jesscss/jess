# @jesscss/awaitable-pipe

A tiny, zero-dependency pipe that stays sync when possible and becomes a Promise when needed.

- Sync-only pipeline → returns a plain value
- Any async input/step → returns a Promise
- Optional single-point error handling (never throws) with `safePipe`
- Works with values, Promises, or initial thunks (() => value | Promise)
- Works with or without an initial value
- Strong TypeScript types; no wrapper objects

## Install

```bash
pnpm add @jesscss/awaitable-pipe
# or npm i @jesscss/awaitable-pipe
```

## Quick Start

```ts
import { pipe, safePipe } from '@jesscss/awaitable-pipe';

// Sync stays sync
const upper = (s: string) => s.toUpperCase();
const exclaim = (s: string) => s + '!';
const out = pipe('ok', upper, exclaim);   // string: 'OK!'

// Mixed becomes Promise
const load = async (s: string) => s + '!';
const outP = pipe('ok', upper, load);     // Promise<string>
const result = await outP;                // 'OK!'

// Start without an initial value
const s2 = pipe((x?: number) => (x ?? 2) * 3); // number -> 6

// Single-point error handling (never throws)
const boom = () => { throw new Error('nope'); };
const safe = safePipe('ok', { onError: console.error, fallback: 'X' }, boom, upper);
// safe is string 'X'
```

## API

### pipe(input?, ...steps)
- Returns a plain value if everything is sync
- Returns a Promise if input or any step is async
- Errors propagate naturally (sync throws; async rejects)

Input can be:
- a value
- a Promise
- an initial thunk (() => value | Promise)
- omitted (first step receives `undefined`)

```ts
// compose sync functions → returns string
const a = pipe('hi', (s) => s.trim(), (s) => s.toUpperCase());

// compose with async → returns Promise<string>
const b = pipe('hi', async (s) => s + '!', (s) => s + '?');

// no initial value
const c = pipe((x?: number) => (x ?? 1) + 1, (n) => n * 10); // 20
```

### safePipe(inputOrOptions, optionsOrStep, ...steps)
- Single, centralized error handler
- Never throws; returns fallback (or undefined) on error
- Still preserves sync/async result shape

```ts
// Sync-only path
const r1 = safePipe('ok', { onError: console.warn, fallback: 'X' }, (s: string) => s.toUpperCase()); // 'OK'

// Sync error → fallback
const r2 = safePipe('ok', { onError: console.warn, fallback: 'X' },
  () => { throw new Error('boom'); },
  (s: string) => s.toUpperCase()
); // 'X'

// Async path → Promise<string>
const r3 = await safePipe('ok', { onError: console.warn, fallback: 'X' },
  async (s: string) => s + '!',
  (s: string) => s + '?'
); // 'ok!?'
```

## Composing pipes
You can pipe the output of one pipe/safePipe into another. Types preserve sync/async.

```ts
const p1 = pipe('hi', (s: string) => s.toUpperCase()); // string
const p2 = pipe(p1, (s) => s + '!');                   // string → 'HI!'

const p3 = pipe('hi', async s => s + '!');             // Promise<string>
const p4 = pipe(p3, (s) => s + '?');                   // Promise<string>
const fin = await p4;                                  // 'hi!?'
```

## Why not wrap in Result?
We optimize for ergonomics: sync returns a value, async returns a Promise. Error handling via `safePipe` is optional, small, and centralized when you want it.

## License
MIT
