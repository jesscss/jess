// Analyze a vshape-ab jsonl: mean-of-medians, per-round paired delta, win counts.
import { readFileSync } from 'node:fs';
const file = process.argv[2];
const recs = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const labels = [...new Set(recs.map(r => r.label))];
const workloads = [...new Set(recs.map(r => r.workload))];
const [A, B] = labels;
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

console.log(`file: ${file}`);
console.log(`A=${A}  B=${B}   rounds=${new Set(recs.map(r => r.round)).size}  iters/round=${recs[0].iters}`);
console.log('');
console.log('workload       A mean-of-med    B mean-of-med     delta      %       B wins   paired mean±sd    heapA/heapB MB');

for (const w of workloads) {
  const ra = recs.filter(r => r.workload === w && r.label === A);
  const rb = recs.filter(r => r.workload === w && r.label === B);
  const ma = mean(ra.map(r => r.median));
  const mb = mean(rb.map(r => r.median));
  const rounds = [...new Set(recs.map(r => r.round))];
  let winsB = 0;
  let n = 0;
  const paired = [];
  for (const rd of rounds) {
    const a = ra.find(r => r.round === rd);
    const b = rb.find(r => r.round === rd);
    if (a && b) {
      n++;
      if (b.median < a.median) {
        winsB++;
      }
      paired.push((b.median - a.median) / a.median * 100);
    }
  }
  const ha = mean(ra.map(r => r.peakHeap)) / 1048576;
  const hb = mean(rb.map(r => r.peakHeap)) / 1048576;
  const pm = mean(paired);
  const psd = Math.sqrt(mean(paired.map(x => (x - pm) ** 2)));
  const med = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s[s.length >> 1];
  };

  /*
   * Robust: median of per-round medians, and median of paired per-round deltas.
   * Mean-of-medians is badly outlier-driven on these workloads and will report
   * double-digit swings that the paired median shows to be nothing.
   */
  const rma = med(ra.map(r => r.median));
  const rmb = med(rb.map(r => r.median));
  const pmed = med(paired);

  /** Binomial coefficient, for the exact two-sided sign test below. */
  const C = (n_, k) => {
    let r = 1;
    for (let i = 0; i < k; i++) {
      r = r * (n_ - i) / (i + 1);
    }
    return r;
  };
  let tail = 0;
  const kk = Math.min(winsB, n - winsB);
  for (let i = 0; i <= kk; i++) {
    tail += C(n, i);
  }
  const p = Math.min(1, 2 * tail / 2 ** n);
  console.log(
    `${w.padEnd(13)} ${ma.toFixed(2).padStart(10)}ms ${mb.toFixed(2).padStart(13)}ms `
    + `${(mb - ma).toFixed(2).padStart(8)}ms ${((mb - ma) / ma * 100).toFixed(2).padStart(7)}%`
    + `  ${String(winsB).padStart(2)}/${n}`
    + `   ${pm.toFixed(2).padStart(6)}%±${psd.toFixed(2)}`
    + `      ${ha.toFixed(0)}/${hb.toFixed(0)}`
  );
  console.log(
    `${''.padEnd(13)} ROBUST: median-of-medians A=${rma.toFixed(2)}ms B=${rmb.toFixed(2)}ms `
    + `(${((rmb - rma) / rma * 100).toFixed(2)}%)  median paired delta=${pmed.toFixed(2)}%  sign-test p=${p.toFixed(3)}`
  );
}
