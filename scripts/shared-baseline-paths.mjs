export const FULL_BASELINE_PATH_PATTERNS = [
  /^scripts\/verify-baseline\.mjs$/,
  /^scripts\/precommit-changed-checks\.mjs$/,
  /^scripts\/shared-baseline-paths\.mjs$/,
  /^scripts\/verify-node-copy-frontier\.mjs$/,
  /^scripts\/verify-render-buffer-frontier\.mjs$/,
  /^scripts\/verify-materialization-frontier\.mjs$/,
  /^scripts\/verify-package-exports\.mjs$/,
  /^scripts\/verify-node-constructor-metadata\.mjs$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/
];

export function shouldRunFullBaselineForFiles(files) {
  return files.some(file =>
    FULL_BASELINE_PATH_PATTERNS.some(pattern => pattern.test(file))
  );
}
