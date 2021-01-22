# patch-css

Conditionally attach a `<style>` tag if it differs from what's in the current stack of stylesheets. This currently seems to be the best way to "hydrate" and patch stylesheets based on input.

This package will do the following:

1. Check that we're in a browser.
2. Check to see that the document is loaded (or wait for the load event)
3. Gather a Collection of all stylesheets, and stringify their content to store in the map. Now we have a content map.

Given a CSS string and identifier, it will:

1. Construct a StyleSheet in the browser from the CSS string.
2. Stringify the content. (We do this to normalize strings for comparison.)
3. Find first and last line from CSS input in the Collection. (If the Collection has an identifier that matches the lookup identifier, then only search that item in the Collection.)
4. If we find exactly one match, compare entire block between first / last in CSS to first / last in the Collection stylesheet. If they differ, inject a new `<style>` tag using the StyleSheet, and add a relationship between the identifier and the content. (If the `<style>` tag was previously injected, then replace its content instead of injecting a new one.)
5. If we find no matches in step 3, inject a new `<style>` tag (and add to Collection)
6. If we find multiple matches in step 3, inject a new `<style>` tag (and add to Collection)
7. Do a dance.

_Note: the `<style>` tag should be injected immediately following the location in the DOM of the stylesheet._

_Second Note: If the input CSS has a generic first / last line, it's likely the content will always be different!_

_Third Note: If we're not in a browser, this package / function should do nothing when called!_

We mark the first and last line with:
```less
#__start { content: "identifier"; }
```
```less
#__end { content: "identifier"; }
```

_TODO: because we need to normalize the start, then either `@charset` should be disallowed, or it should be removed._

_TODO: some research is needed to see if we should only re-inject / replace the diffed rules, based on browser performance re: style re-calculation._