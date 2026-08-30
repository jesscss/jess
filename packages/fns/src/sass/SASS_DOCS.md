# Sass function porting docs (`packages/fns/src/sass`)

This folder contains Sass function ports and supporting notes. Keep these docs **small, current, and indexable** so it’s easy to find the right place to update when adding a new function.

## Canonical docs

- `SASS_FUNCTION_PORT_PLAN.md`: the step-by-step approach + port priority list.
- `FUNCTION_CATALOG.md`: function inventory and rough complexity categorization.
- `EXPORT_STRUCTURE.md`: how exports map to Sass modules (`sass:color`, `sass:math`, etc.).
- `NAME_ALIASES.md`: intentional alias/re-export mapping between Sass and Less names.

## Design / analysis notes (dev-facing)

- `SASS_COMPATIBILITY_ANALYSIS.md`: bigger-picture AST/`defineFunction` compatibility gaps vs Sass.
- `COLOR_AND_UNIT_ANALYSIS.md`: color node structure + unit tracking notes.
- `UNIT_TRACKING_ANALYSIS.md`: argument for string-based compound units (and when arrays may be needed).

## When adding a new Sass function

- Update `FUNCTION_CATALOG.md` (catalog + complexity classification) if needed.
- Update `SASS_FUNCTION_PORT_PLAN.md` checklists if you’re working through the plan.
- Ensure exports are correct per `EXPORT_STRUCTURE.md` (global vs module export).
- Add/adjust entries in `NAME_ALIASES.md` if the Sass name is a re-export of an existing Less implementation.

