# @jesscss/style-resolver

**Stylesheet import resolution across CSS, Less, SCSS, and Jess — include paths,
load paths, and extension/index resolution.**

`@jesscss/style-resolver` is a building block for
[Jess](https://github.com/jesscss/jess). Given a stylesheet's source and an import statement, it
figures out which file that import actually points to, applying each language's
lookup rules (Less and SCSS candidate expansion, partials, index files, search
paths).

It handles the mechanics of finding imports — extracting import statements from
source, expanding a bare import path into the ordered list of candidate files a
given language would try, and resolving that against a filesystem-like interface.

## Where it fits

Import resolution is a shared concern the compiler and tooling both need. It is
also one of the building blocks toward the broader module/scoping story on the
Jess roadmap (whose headline is the post-`.jess` minimal browser build) — but this
package is just the resolver, not that feature.

## Who uses it

This is an internal package. Most people should install
[`jess`](https://www.npmjs.com/package/jess) and use the `jess` CLI.
The JavaScript/TypeScript API is **not yet stabilized** and is intentionally
undocumented for now.

## Status

Alpha. Published to npm under both the `latest` and `alpha` dist-tags. Please
[report bugs](https://github.com/jesscss/jess/issues).

## Links

- Repository: <https://github.com/jesscss/jess>
- Documentation: <https://jesscss.github.io/> (currently pre-alpha content)

## License

[MIT](https://github.com/jesscss/jess/blob/dev/LICENSE)
