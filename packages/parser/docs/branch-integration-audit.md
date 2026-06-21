# Scanner-First Branch Integration Audit

This document records the branch cleanup decision after parser/core work was
accidentally advanced on `feature/less-v5-alpha-readiness` while the canonical
scanner-first worktree is `feature/scanner-first-parser-docs`.

The purpose is not to bless the current implementation. The purpose is to stop
silent branch drift: every parser/core commit that exists only on the alpha
branch must be either ported, mined for tests, marked as already represented, or
rejected.

## Branch Facts

- Canonical scanner-first branch:
  `feature/scanner-first-parser-docs`
- Canonical scanner-first worktree:
  `/Users/matthew/.config/superpowers/worktrees/jess/scanner-first-parser-docs`
- Accidental branch:
  `feature/less-v5-alpha-readiness`
- Alpha-only parser/core commits:
  56
- Alpha-only commits total:
  57
- Scanner-first-only parser/core commits:
  83

Both worktrees were clean when this audit was created.

`git checkout feature/scanner-first-parser-docs` from `/Users/matthew/git/oss/jess`
will fail with "already used by worktree" because the branch is already checked
out in the canonical scanner-first worktree. That is expected. Agents should
work in the scanner-first worktree directly instead of moving the main checkout.

## Decision Labels

- `port`: reimplement the behavior on scanner-first.
- `mine-tests`: do not cherry-pick the implementation, but port useful proof
  cases or corpus gates.
- `represented`: scanner-first already has a newer implementation or stronger
  documented direction.
- `partial`: scanner-first contains part of the intent, but the remaining code
  still has source-of-truth or object-shape debt.
- `reject-shape`: the commit points in a direction now rejected by
  [requirements-and-scope.md](requirements-and-scope.md) or
  [implementation-map.md](implementation-map.md).
- `split`: the commit mixed scanner-first-relevant proof with release or alpha
  scaffolding; inspect and port only the relevant pieces.
- `binding-audit`: classify in the binding/lookup lane, not in parser-shape
  cleanup.

## Alpha-Only Commit Decisions

| Commit | Subject | Decision | Notes |
| --- | --- | --- | --- |
| `97b947b14` | Prepare Less v5 alpha readiness guards | `split` | Mostly alpha release/API scaffolding, but it also touches parser/core tests and node files. Do not cherry-pick; inspect and port only scanner-first-relevant proof or API decisions. |
| `1e840ab9e` | Cut duplicate ruleset namespace lookup paths | `binding-audit` | Must be checked against scanner-first binding commits and tests before port/reject. |
| `ab2910a81` | Cut array-path namespace union dedupe | `binding-audit` | Same binding lane. |
| `b04e1a93d` | Cut frame-owned ruleset namespace bucket fallback | `binding-audit` | Same binding lane. |
| `927edf3e6` | Cut framed namespace broad-start fallback | `binding-audit` | Same binding lane. |
| `1e1691130` | Keep local namespace lookup on frames | `binding-audit` | Same binding lane. |
| `bdfb4e571` | Keep targeted namespace lookup on frames | `binding-audit` | Same binding lane. |
| `f434af73f` | Close binding lookup inventory | `binding-audit` | This was missed by the initial parser/core path filter because it only changes binding docs. Include it in the binding lane audit. |
| `46621336a` | Restore collapsed render frames on empty children | `binding-audit` | Render/eval behavior, not parser-shape work. |
| `43188192a` | Document parser scanner-first requirements | `represented` | Superseded by current parser docs, especially requirements/scope and implementation map. |
| `c83aec1c9` | Add slim stylesheet root node | `represented` | Scanner-first has `Stylesheet extends Rules`; continue cutting it if root state grows. |
| `e47ee8c82` | Prove string-backed CSS AST parse path | `represented` | Scanner-first has CSS AST proof and offset-span proof. Keep checking code against docs. |
| `74ff093bb` | Extract shared source scanner helpers | `represented` | Scanner/source helpers exist on scanner-first. |
| `177e8efd0` | Refine parser AST ownership strategy | `represented` | Superseded by current docs requiring AST-owned deferred fields where possible. |
| `7e398f828` | Add scanner source parse result | `represented` | Scanner-first has source/scanner/structure pieces; compile path still must avoid structural facades. |
| `0d1d595f4` | Add scanner CSS corpus gate | `mine-tests` | Verify whether scanner-first has an equivalent CSS corpus gate; add if missing. |
| `38728d8ea` | Add core at-rule statement node | `represented` | `AtRuleStatement` exists on scanner-first. Continue removing raw-name/raw-prelude storage. |
| `6b8e23602` | Materialize cheap CSS selectors | `mine-tests` | Selector tests are useful, but direct port risks older shape. Scanner-first needs explicit `RelativeSelector`, not "complex means maybe relative." |
| `2dad76083` | Add Less scanner corpus gate | `mine-tests` | Useful gate. Verify scanner-first corpus coverage and port missing coverage only. |
| `2d2c020b9` | Add flat Less AST proof | `mine-tests` | Useful examples; implementation shape may conflict with current package layout. |
| `a3859448d` | Parse nested Less AST rulesets | `mine-tests` | Same. |
| `7674ad11f` | Parse Less detached ruleset variables | `mine-tests` | Same. |
| `d1181b1de` | Unify Less AST block parsing | `mine-tests` | Same; do not port helper architecture blindly. |
| `59575933c` | Parse Less block at-rules as string-backed AST | `mine-tests` | Useful expected shape; must avoid `raw*` fields. |
| `db15f22cd` | Parse simple Less at-rule preludes | `mine-tests` | Useful expected shape; at-rule prelude should be semantic field storage. |
| `f94f6137d` | Share cheap at-rule prelude parsing | `mine-tests` | Reuse scanner logic only if it remains smaller than direct parser code. |
| `8d3f52990` | Cut Rules value payload | `port` | Scanner-first still has `Rules extends Node<Value>` and `super((value ?? body)...)`. This needs a real direct-field cut, not compatibility. |
| `07f3a956b` | Use string tokens in cheap selectors | `mine-tests` | Direction is right for simple selector atoms/combinators, but current scanner-first must use real selector node types where structure is present. |
| `1ff2ec9e7` | Parse parameterless Less mixins | `mine-tests` | Useful Less proof. Port as direct AST shape, not alpha-only parser file layout. |
| `ccedeeb67` | Parse cheap Less mixin params | `mine-tests` | Same. |
| `8d62791a2` | Cut Declaration base value payload | `partial` | Declaration has direct fields but still uses `value` as the semantic declaration value and inherits from `Node<...>`. Cut only the base-payload confusion, not the semantic declaration `value` field. |
| `43eb8acf8` | Move cheap prelude scanning into parser | `mine-tests` | Reevaluate after at-rule prelude storage is semantic and direct. |
| `4a9f5ea73` | Parse parameterless Less mixin calls | `mine-tests` | Useful Less proof. |
| `d18394d83` | Cut implicit node value child fallback | `port` | Supports the direct-field model; must be done with `childKeys`, not one-off compatibility. |
| `4ebf1d971` | Share cheap Less mixin name parsing | `mine-tests` | Useful if it deletes duplication; reject if it creates helper ladders. |
| `09feec58d` | Gate Less scanner AST corpus | `mine-tests` | Must exist as a scanner-first gate before claiming Less coverage. |
| `95104a8ee` | Parse plain Less ampersand scopes | `mine-tests` | Useful proof; must not confuse literal `&` with plain scope-isolation blocks. |
| `176ba12ec` | Parse cheap Less mixin call args | `mine-tests` | Useful proof. |
| `e9e8544f7` | Parse cheap Less at-rule prelude lists | `mine-tests` | Useful proof; avoid raw-prelude fields. |
| `ac8eee053` | Parse cheap CSS at-rule prelude lists | `mine-tests` | Useful proof; avoid raw-prelude fields. |
| `bce89f40a` | Parse cheap Less mixin defaults | `mine-tests` | Useful proof. |
| `6e854e34e` | Parse cheap Less named call args | `mine-tests` | Useful proof. |
| `8592de91a` | Parse cheap Less guarded blocks | `mine-tests` | Useful proof. |
| `d60b685c8` | Parse namespaced Less mixin calls | `mine-tests` | Useful proof. |
| `abe8d413f` | Parse cheap Less selector lists | `mine-tests` | Useful proof; selector list must not be a full raw complex string. |
| `44b489cc8` | Parse Less mixin rest parameters | `mine-tests` | Useful proof. |
| `51652df37` | Parse cheap selector atoms | `mine-tests` | Useful proof; validate against string atom requirements. |
| `7e9412da9` | Use child keys for ruleset selector bits | `port` | Matches the field-owned/direct-field direction. Verify current scanner-first behavior before patching. |
| `6d184e993` | Defer Less at-rule preludes as strings | `mine-tests` | Desired field shape, but not raw field names. |
| `7e4a431b0` | Defer Less interpolated selectors as strings | `mine-tests` | Desired only where strings remain structurally honest. |
| `2986fcca4` | Defer Less ampersand suffix selectors as strings | `mine-tests` | Must be checked against extend/ampersand semantics; may need typed hydration on demand. |
| `22827cf70` | Parse Less keyframe selectors as strings | `mine-tests` | Useful proof. |
| `5cd319e02` | Remove unused Less at-rule parse context | `mine-tests` | Port only if the same dead context exists on scanner-first. |
| `a9bfedae0` | Parse Less namespace mixin calls as references | `mine-tests` | Useful proof; verify against lookup/binding lane. |
| `3d38b58f6` | Parse Less spread mixin call arguments | `mine-tests` | Useful proof. |
| `fe0cc92bf` | Parse Less root function call statements | `mine-tests` | Useful proof. |
| `05c9e7ded` | Tighten Less function argument parsing | `mine-tests` | Useful proof. |

## Immediate Port Queue

1. Port the binding/lookup intent only after a focused binding audit against
   alpha commits `1e840ab9e`, `ab2910a81`, `b04e1a93d`, `927edf3e6`,
   `1e1691130`, `bdfb4e571`, `f434af73f`, and `46621336a`, plus
   scanner-first commits `4773cd95c`, `15440ba83`, `0bd0ba5e1`, and
   `b8d961740`.
2. Cut `Rules` base-value payload usage. `Rules.rules` is the semantic body;
   the inherited base `value` payload is not the source of truth.
3. Cut implicit `Node.value` child fallback and use explicit `childKeys` for
   direct-field nodes.
4. Make relative selectors explicit. A selector surface that starts with a
   combinator should materialize as `RelativeSelector`, not as a `ComplexSelector`
   with a note saying it might be relative.
5. Verify CSS and Less scanner corpus gates on scanner-first. Add missing gates
   from alpha as tests only, not as alpha implementation shape.

## Rejected Direct Ports

Do not directly cherry-pick alpha commits that introduce or preserve:

- parallel `Progressive*` nodes
- `RawIslandNode` as a durable public/parser result concept
- `rawName`, `rawPrelude`, `rawValue`, `rawValueSegments`, or `valueNode` fields
  where semantic fields should exist
- a separate structural compiler result when existing AST nodes can carry string
  fields and deferred state
- package layouts that do not exist on scanner-first, such as alpha-only
  `packages/less-parser/src/ast.ts`

Do not treat `feature/less-v5-alpha-readiness` as disposable. Its unique commits
are recorded here because some contain real proof cases, tests, and binding
cleanup intent. The rejection is against direct cherry-picking bad shapes or
release-scaffolding into scanner-first, not against preserving useful work.

## Next Verification Gates

After the first port slice:

- run focused core/parser tests for the touched node family
- run the scanner corpus gates if the slice affects scanner structure
- run `pnpm run verify:aggressive-cutting-review` before committing any
  eval/render/lookup/direct-field work
- request a sub-agent review of the audit and the port slice before commit when
  an agent slot is available
