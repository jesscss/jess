// Matched-workload generator: emits equivalent Less and SCSS from one spec so
// dart-sass and Jess chew on the same feature mix and scale by construction.
//
// Only common-denominator constructs are used (variable arithmetic, deep `&`
// nesting, parametric mixins, rgba) — nothing that either engine lacks or
// handles asymmetrically. Repetition is UNROLLED here in JS so there is no
// loop-construct mismatch (Less recursive-mixin vs Sass @for) biasing eval.
//
// Two knobs control scale: COMPONENTS (top-level blocks) and VARIANTS
// (unrolled child rules per block). Defaults target ~the size of benchmark.less.

const LESS = {
  v: '@',
  mixinDef: (name, params, body) =>
    `.${name}(${params.map(p => `@${p}`).join(', ')}) {\n${body}\n}`,
  mixinCall: (name, args) => `.${name}(${args.join(', ')});`
};

const SCSS = {
  v: '$',
  mixinDef: (name, params, body) =>
    `@mixin ${name}(${params.map(p => `$${p}`).join(', ')}) {\n${body}\n}`,
  mixinCall: (name, args) => `@include ${name}(${args.join(', ')});`
};

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

export function generate(dialect, { components = 220, variants = 6 } = {}) {
  const d = dialect === 'scss' ? SCSS : LESS;
  const v = d.v;
  const out = [];

  // ── variables ────────────────────────────────────────────────────────────
  out.push(`${v}base: 10px;`);
  out.push(`${v}gap: 4px;`);
  out.push(`${v}radius: 3px;`);
  COLORS.forEach((c, i) => out.push(`${v}c${i}: ${c};`));
  out.push('');

  // ── parametric mixins (numeric params → several decls) ────────────────────
  out.push(
    d.mixinDef('box', ['n', 'c'], [
      `  padding: (${v}n * 2) ${v}n;`,
      `  margin: ${v}n (${v}n + ${v}gap);`,
      `  border: 1px solid rgba(${v}c, 0.5);`,
      `  line-height: (${v}n + 8px);`
    ].join('\n'))
  );
  out.push(
    d.mixinDef('stack', ['n'], [
      `  top: ${v}n;`,
      `  left: (${v}n + ${v}gap);`,
      `  z-index: (${v}n * 3);`
    ].join('\n'))
  );
  out.push('');

  // ── components: deep nested trees with var math + mixin calls ──────────────
  for (let i = 0; i < components; i++) {
    const c = `${v}c${i % COLORS.length}`;
    const n = `(${v}base + ${i % 9}px)`;
    const block = [];
    block.push(`.component-${i} {`);
    block.push(`  color: ${c};`);
    block.push(`  padding: ${n} ${v}gap;`);
    block.push(`  background: rgba(${c}, 0.9);`);
    block.push(`  ${d.mixinCall('box', [`${i % 5 + 1}px`, c])}`);
    block.push(`  &:hover { color: rgba(${c}, 0.7); border-radius: ${v}radius; }`);
    block.push('  .inner {');
    block.push(`    margin: (${v}base * 2) auto;`);
    block.push(`    width: (${v}base * ${(i % 8) + 2});`);
    for (let j = 0; j < variants; j++) {
      block.push(`    .v-${j} {`);
      block.push(`      font-size: (${v}base + ${j}px);`);
      block.push(`      padding: (${v}gap * ${j + 1}) 0;`);
      block.push(`      ${d.mixinCall('stack', [`${j + 1}px`])}`);
      block.push(`      &:first-child { opacity: 1; }`);
      block.push(`      &:last-child { opacity: 0; }`);
      block.push('    }');
    }
    block.push('  }');
    block.push('}');
    out.push(block.join('\n'));
  }

  return out.join('\n') + '\n';
}
