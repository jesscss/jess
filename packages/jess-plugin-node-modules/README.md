# @jesscss/plugin-node-modules

**Import resolver that loads npm packages from `node_modules` — a seed of the
JavaScript-execution / CSS-in-JS story.**

This plugin gives Jess's language plugins a way to resolve and load npm packages
by name, using Node's module resolution (`require.resolve` /
`createRequire`). Other plugins use it to pull in packages referenced from a
stylesheet — for example [`@jesscss/plugin-less-compat`](../syntax/less/jess-plugin-less-compat)
resolving a Less `@plugin "package-name"` off `node_modules`.

## Why it exists — the convergence angle

One of the four tools [Jess](https://github.com/jesscss/jess) aims to converge is
**CSS-in-JS**: running real JavaScript inside your stylesheets (`@use` /
`@plugin`) so styles can be dynamic without leaving CSS files. Reaching npm
packages is a building block of that story. Paired with
[`@jesscss/plugin-js`](../jess-plugin-js) (which executes the modules), it lets a
stylesheet pull logic and data from the JS ecosystem.

That convergence is **roadmap — being proven through the alpha, not claimed as
done.** What ships here today is just the resolver seam; don't read it as a
finished CSS-in-JS system.

## Status

**Alpha.** Part of Jess. The programmatic plugin/compiler API is **not yet
stabilized** — the `jess` CLI is the documented public surface for the alpha.
Watch the
[docs site](https://jesscss.github.io/) for the API once it settles.

- Project overview & positioning: <https://github.com/jesscss/jess#readme>
- Docs: <https://jesscss.github.io/> (currently pre-alpha content)
- Issues: <https://github.com/jesscss/jess/issues>
- License: MIT
