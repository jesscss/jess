# @jesscss/plugin-remote-import

**Opt-in `@import` of stylesheets over https, from hosts you name.**

Without this plugin, Jess and Less 5 never download anything: an
`@import "https://…"` stays in the output as a plain CSS `@import`, and one that
cannot be CSS — `(reference)`, `(less)`, `(inline)`, `@compose` — is an error.
With it, a
URL import whose host is on your allow list is fetched and imported like a
local file. The `jess` CLI adds it with
`--allow-remote-imports cdn.example.com`.

```js
// styles.config.mjs
import { remoteImportPlugin } from '@jesscss/plugin-remote-import';

export default {
  compile: {
    plugins: [remoteImportPlugin({ allow: ['cdn.example.com'] })]
  }
};
```

What it enforces:

- **An explicit allow list** of the hosts that are fetched and inlined — not of
  the hosts a stylesheet may link to. Exact host names; no wildcards, no ports,
  and never an IP address. A host that resolves to a private, loopback or
  link-local address is refused.
- **Less decides what is CSS first.** A URL written with a `.css` path
  (`@import "@{cdn}/theme.css"` included) or marked `(css)` is never fetched.
  One spelled entirely by a variable is classified by how it is written, not
  by its value, so it is not CSS: off the list it is refused like a `.less` URL. An extensionless URL that is
  not fetched — Google Fonts' `/css?family=…` — stays a plain CSS `@import`,
  media query included. Any other URL that is not fetched — a `.less` URL, or
  an `(inline)`, `(reference)`, `(less)` or `@compose` import — is an error,
  even under `(optional)`. `(optional)` skips a URL the server answers with 404
  or 410. In an SCSS file only a `.css` URL is CSS so far: Sass's rule that
  every `http(s)://` and `url()` import is plain CSS is not applied yet, so such
  an import goes through the allow list as above.
- **https only**, **same-origin redirects only** (at most five), a **size cap**
  (`maxBytes`, default 512 KiB) and a **time limit** (`timeout`, default 5 s).
- **Every path inside a downloaded file resolves against its URL** — in
  `@import`, `@import (inline)`, `data-uri()`, `@use` and `@plugin` alike — so
  a remote file can never read a file on your disk.
- A URL on the list is fetched exactly as written, extension or not.
  `@import (inline)` of an allowed URL is fetched and inlined. `rewriteUrls`
  rebases a downloaded file's relative `url()`s onto its URL. `data-uri()`
  never fetches, and `@use` / `@plugin` load local files only.
- No lockfile or integrity pinning yet: a host that changes a file changes
  your build.

Under Deno, run with `--allow-net` set to the same hosts: the runtime then
refuses any other host even if this plugin's check were wrong. A test in this
package proves it. The plugin refuses to start under Deno with unrestricted
network access. On Node, the plugin's check is the only one.

The design and its rulings:
[`docs/design/REMOTE-IMPORTS-NETWORK-POLICY.md`](../../docs/design/REMOTE-IMPORTS-NETWORK-POLICY.md).

## Status

**Alpha.** Part of [Jess](https://github.com/jesscss/jess). License: MIT.
