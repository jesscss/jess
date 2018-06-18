# Project Jess
Just Efficient Style Sheets (? or some other backronym?)

Right now, this work is experimental and is a work-in-progress

## The Theory
Frameworks like Svelte compile HTML-like syntax into framework-less runtime libs.

## Application
Jess would do the same for CSS by compiling a CSS-like language into a framework-less runtime that _creates_ CSS, rather than outputting only CSS.

## The Need
One of the biggest needs is a declarative / cross-framework design language that handles things like:
1. Changing styles due to position (using an IntersectionObserver polyfill)
2. Changing styles due to available with (called element or container queries - polyfilled with ResizeObserver)
3. Generating/inserting only used styles based on used components.
4. Generating local (non-global) styles

## Design
1. The Jess compiler would output a combination of runtime-ready, polyfillable CSS and a JS model of that CSS with all of the dynamic pieces. Think of this as Vue/React SSR where a "first-paint" version of HTML is created that can be "hydrated".
2. The Jess compiler would either include or have an implementation of the Typed CSS OM as a polyfill, and would directly interact with that to do the most efficient updates to styles as possible. Right now, even Less, which runs in the browser and can have variables changed on-the-fly.
3. Like CSS Modules, the CSS/JavaScript runtime should be language independent, so that, in theory, a language like Less or Sass could construct a compiler to X output format for faster live variable updates. So this project should be split out and Jess should either refer to the language or the runtime (undecided).
4. The runtime format should become a replacement for CSS Modules and solve local / component scoping, but in a more powerful way.

## Language
The Jess language format should conform to these specs:
1. Unlike Less/Sass, it should be CSS compliant as much as possible. That is, the syntax should more closely match parseable, supported CSS.
2. The file format should be something like `.jess.css`, so that code-coloring just works by default (but there may be Jess-specific constructs that could be added to the format.)
3. There should be a declarative way to refer to the browser runtime environment (live queries). But it should be done in such a way that the majority of code could be static. In fact, Jess should allow completely static output. In other words, "Live" should be a kind of feature polyfill based on what features are used. (Maybe even to the extent that no "live" queries and no JS-bindable properties produces only CSS output, not CSS/JS? Not sure.) Long and short, the runtime should make itself as minimal and invisible as possible. If you don't use container queries in your style sheets, the `ResizeObserver` polyfill shouldn't be in the bundle, etc.

## Contributing
As this is a WIP, file issues with your ideas/concerns/wants!
