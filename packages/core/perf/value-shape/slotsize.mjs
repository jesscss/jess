/*
 * Determine bytes-per-in-object-slot for THIS runtime, by allocating the ACTUAL
 * shapes under test and diffing heapUsed. Run with --expose-gc.
 * Not an IC microbenchmark: this measures object footprint only.
 */
const N = 500000;

/** Three passes, because one scavenge does not always reach a stable heapUsed. */
function settle() {
  globalThis.gc();
  globalThis.gc();
  globalThis.gc();
}

function measure(make) {
  settle();
  const before = process.memoryUsage().heapUsed;
  const arr = new Array(N);
  for (let i = 0; i < N; i++) {
    arr[i] = make(i);
  }
  settle();
  const after = process.memoryUsage().heapUsed;
  const keep = arr[(Math.random() * N) | 0];
  return { bytes: after - before, keep };
}

/*
 * Baseline array-of-pointers cost is identical across shapes, so the DIFFERENCE
 * between two shapes isolates the per-slot cost.
 */
const shapes = {
  'n3  {a,b,c}': i => ({ a: i, b: i, c: i }),
  'n4  {a..d}': i => ({ a: i, b: i, c: i, d: i }),
  'n5  {a..e}': i => ({ a: i, b: i, c: i, d: i, e: i }),
  'n6  {a..f}': i => ({ a: i, b: i, c: i, d: i, e: i, f: i }),
  'n7  {a..g}': i => ({ a: i, b: i, c: i, d: i, e: i, f: i, g: i }),
  'n8  {a..h}': i => ({ a: i, b: i, c: i, d: i, e: i, f: i, g: i, h: i }),
  'n11 {a..k}': i => ({ a: i, b: i, c: i, d: i, e: i, f: i, g: i, h: i, j: i, k: i, l: i })
};

const res = {};
const held = [];
for (const [name, fn] of Object.entries(shapes)) {
  const r = measure(fn);
  held.push(r.keep);
  res[name] = r.bytes;
  console.log(`${name.padEnd(14)} total=${String(r.bytes).padStart(12)}  perObj=${(r.bytes / N).toFixed(2)} B`);
}
console.log('\nper-slot deltas (perObj difference between adjacent shapes):');
const names = Object.keys(shapes);
for (let i = 1; i < names.length; i++) {
  const a = res[names[i - 1]] / N, b = res[names[i]] / N;
  const slotDiff = names[i].match(/n(\d+)/)[1] - names[i - 1].match(/n(\d+)/)[1];
  console.log(`  ${names[i - 1]} -> ${names[i]}: ${(b - a).toFixed(2)} B over ${slotDiff} slot(s) = ${((b - a) / slotDiff).toFixed(2)} B/slot`);
}
console.log('held', held.length);
