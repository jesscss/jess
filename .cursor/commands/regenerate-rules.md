# Regenerate Rules

Use this when repo structure changes (new packages, moved directories, new hotspots) and the `.cursor/rules/**` globs need updating.

## Workflow

1. **Detect structural changes**
   - New packages under `packages/*`
   - New test layouts (new `__tests__`, `test/` folders)
   - New build/test configs

2. **Update rules incrementally**
   - Prefer adding/updating **glob-scoped** rules.
   - Avoid introducing new repo-wide always-apply rules unless absolutely necessary.

3. **Keep legacy docs scoped**
   - If older always-apply rules exist, scope them to `.cursor/**` and keep the active guardrails in the new global rules.

4. **Validate**
   - Confirm each rule’s `globs` match real paths.
   - Ensure no rule/command tells the user to “invoke the system”.

