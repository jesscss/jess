---
title: Extend docs index (canonical)
---

# Extend docs (canonical index)

This directory accumulated many “working notes” over time. To keep things navigable, the **canonical** extend documentation is intentionally small:

## Canonical docs to keep current

- **Rules of extend**: `EXTEND_RULES.md`
- **Where are the tests / where to add coverage**: `__tests__/EXTEND_TEST_INDEX.md`
- **Implementation**: `extend.ts` (header comments)

## Where to put operational/debug workflows

Operational “what commands to run / what to read first” guidance should live in Cursor-native files so it auto-loads when editing extend code:

- `.cursor/rules/subtrees/core__extend.mdc`

## Historical notes

Older audits, refactoring summaries, and one-off debugging notes were removed or archived to reduce noise. Use **git history** if you need to resurrect prior analysis.

