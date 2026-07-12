# Minimal example: extend from child root → ancestor

**Rule:** When a selector inside a *child* root (e.g. `@media`) extends a selector in an *ancestor* root (e.g. document root), Less does **not** add the extending selector to the ancestor. Instead, the extending selector gets its **own** ruleset in the child root, with the **target’s declarations** copied into it.

**Files:**
- `extend-ancestor-minimal-example.less` – input
- `extend-ancestor-minimal-expected.css` – expected output (Less behavior)

**To confirm:** If you have Less installed, run:
```bash
npx lessc docs/extend-ancestor-minimal-example.less
```
and compare to `extend-ancestor-minimal-expected.css`.

**In the example:**
- `.a` at root stays `.a { color: red; }` (unchanged).
- `.b:extend(.a)` inside `@media screen` does **not** become `.a, .b` at root.
- Inside `@media screen`, `.b` gets one ruleset with both `color: red` (from `.a`) and `background: blue` (its own).
