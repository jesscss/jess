# Pre-push Check TODOs

Generated: 2026-03-01T19:11:54.424Z

These checks failed during `--mode=upstream` and were treated as non-blocking.

## TODO Items
1. [ ] `packages/docs` - `pnpm --filter ./packages/docs build` (exit 1)

## Failure Details
### 1) packages/docs

- Command: `pnpm --filter ./packages/docs build`
- Exit: `1`

```
> jess-docs@2.0.0-alpha.1 build /Users/matthew/git/oss/jess/packages/docs
> docusaurus build

[INFO] [en] Creating an optimized production build...
[info] [webpackbar] Compiling Client
[info] [webpackbar] Compiling Server
[success] [webpackbar] Server: Compiled with some errors in 769.56ms
[success] [webpackbar] Client: Compiled with some errors in 1.94s
/Users/matthew/git/oss/jess/packages/docs:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  jess-docs@2.0.0-alpha.1 build: `docusaurus build`
Exit status 1

(node:73735) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
(Use `node --trace-deprecation ...` to show where the warning was created)
[WARNING] Some blog authors used in "2019-05-28-hola.md" are not defined in "authors.yml":
- {"name":"Gao Wei","title":"Docusaurus Core Team","url":"https://github.com/wgao19","imageURL":"https://avatars1.githubusercontent.com/u/2055384?v=4","key":null,"page":null}

Note that we recommend to declare authors once in a "authors.yml" file and reference them by key in blog posts front matter to avoid author info duplication.
But if you want to allow inline blog authors, you can disable this message by setting onInlineAuthors: 'ignore' in your blog plugin options.
More info at https://docusaurus.io/docs/blog

[WARNING] Some blog authors used in "2019-05-29-hello-world.md" are not defined in "authors.yml":
- {"name":"Endilie Yacop Sucipto","title":"Maintainer of Docusaurus","url":"https://github.com/endiliey","imageURL":"https://avatars1.githubusercontent.com/u/17883920?s=460&v=4","key":null,"page":null}

Note that we recommend to declare authors once in a "authors.yml" file and reference them by key in blog posts front matter to avoid author info duplication.
But if you want to allow inline blog authors, you can disable this message by setting onInlineAuthors: 'ignore' in your blog plugin options.
More info at https://docusaurus.io/docs/blog

[WARNING] Some blog authors used in "2019-05-30-welcome.md" are not defined in "authors.yml":
- {"name":"Yangshun Tay","title":"Front End Engineer @ Facebook","url":"https://github.com/yangshun","imageURL":"https://avatars0.githubusercontent.com/u/1315101?s=400&v=4","key":null,"page":null}

Note that we recommend to declare authors once in a "authors.yml" file and reference them by key in blog posts front matter to avoid author info duplication.
But if you want to allow inline blog authors, you can disable this message by setting onInlineAuthors: 'ignore' in your blog plugin options.
More info at https://docusaurus.io/docs/blog

[WARNING] Docusaurus found blog posts without truncation markers:
- "blog/2019-05-30-welcome.md"
- "blog/2019-05-28-hola.md"

We recommend using truncation markers (`<!-- truncate -->` or `{/* truncate */}`) in blog posts to create shorter previews on blog paginated lists.
Tip: turn this security off with the `onUntruncatedBlogPosts: 'ignore'` blog plugin option.
[ERROR] Client bundle compiled with errors therefore further build is impossible.
Module not found: Error: Can't resolve './AudienceGate.js' in '/Users/matthew/git/oss/jess/packages/docs/src/theme'
```

