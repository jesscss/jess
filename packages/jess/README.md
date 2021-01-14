<p style="text-align: center"><img width="184" src="https://github.com/matthew-dean/jess/raw/master/simple-hawk-drawing-1.jpg"></p>

_Note: this project is very much a WIP! DON'T USE YET!_
# Project Jess
JavaScript Evaluated Style Sheets

Why is the logo a hawk? A jess is defined as _a short leather strap that is fastened around each leg of a hawk, usually also having a ring or swivel to which a leash may be attached_.

## The Elevator Pitch
"Just like React updates the DOM, Jess updates the CSS OM."

## The Theory
Frameworks like Svelte compile HTML-like syntax into framework-less runtime libs. Jess would do the same for CSS by compiling a CSS-like language into a framework-less runtime that _creates_ CSS, rather than outputting only CSS.

## The Need
One of the biggest needs is a declarative / cross-framework design language that handles things like:
1. Changing styles due to position (using an IntersectionObserver polyfill)
2. Changing styles due to available width (called element or container queries - polyfilled with ResizeObserver)
3. Generating/inserting only used styles based on used components.
4. Generating local (non-global) styles

## Design
_TODO: Rewrite_
1. The Jess compiler would output a combination of runtime-ready, polyfillable CSS and a JS model of that CSS with all of the dynamic pieces. Think of this as Vue/React SSR where a "first-paint" version of HTML is created that can be "hydrated". Not sure how much this is possible -- will require testing.
2. The Jess compiler would either include or have an implementation of the Typed CSS OM as a polyfill, and would directly interact with that to do the most efficient updates to styles as possible. Right now, even Less, which runs in the browser and can have variables changed on-the-fly.
3. The runtime format should become a replacement for CSS Modules and solve local / component scoping, but in a more powerful way.

## Language
The Jess language format should conform to these specs:
1. It should be CSS compliant as much as possible (except nesting?). That is, the syntax should more closely match parseable, supported CSS (if possible).
2. The file format should be: `.jess` -- this monorepo should have some supported code-coloring tools

## Contributing
As this is a WIP, file issues with your ideas/concerns/wants!
