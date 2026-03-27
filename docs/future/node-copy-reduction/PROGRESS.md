# Node Copy Reduction — Progress

See [STAGES.md](./STAGES.md) for detailed current state.

## Summary (2026-03-27)

EvalState architecture is implemented and wired into all production code.
EvalSession / SessionInstanceRoot / EvalPosition are deleted.

Production code compiles with zero new type errors.
Test files still reference old API and need migration.

## Branch Status

**Not merge-ready.** Tests need updating. Legacy artifacts need cleanup.
Repeated mixin/import proofs need to be written against the new subtree model.
