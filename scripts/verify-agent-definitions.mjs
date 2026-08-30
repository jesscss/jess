#!/usr/bin/env node
/*
 * `pnpm verify:agents` — the agent definitions in `.cursor/agents/` are the
 * ones Claude Code will actually load from `.claude/agents/`.
 *
 * `CLAUDE.md` mandates `grammar-reviewer` for every grammar edit,
 * `perf-architecture-reviewer` before hot-path changes, and `semantics-reviewer`
 * for anything that changes emitted CSS. Cursor reads `.cursor/agents`
 * (`.cursor/README.md:30`); Claude Code reads `.claude/agents`. For a long
 * stretch only the first existed, so every one of those mandates named an agent
 * no Claude Code session could load — the instruction read as satisfied and
 * nothing enforced it.
 *
 * `.claude/agents` is a symlink to `../.cursor/agents`, so there is one source
 * of truth and nothing to drift. This gate exists because that is a property of
 * the working tree, not a guarantee: a checkout on a filesystem without symlink
 * support, a `core.symlinks=false` clone, or a well-meant "fix" that replaces
 * the link with copies all silently reintroduce two sources. It therefore
 * checks the observable requirement — the two directories expose the same
 * agents — rather than the mechanism, and so keeps working if the link is ever
 * deliberately replaced by copies.
 */

import { readdirSync, readFileSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cursorDir = join(root, '.cursor/agents');
const claudeDir = join(root, '.claude/agents');

const failures = [];

/** Agent basenames in a directory, or null when the directory is missing. */
function agentFiles(dir) {
  if (!existsSync(dir)) {
    return null;
  }
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort();
}

const cursorAgents = agentFiles(cursorDir);
const claudeAgents = agentFiles(claudeDir);

if (cursorAgents === null) {
  failures.push('.cursor/agents is missing — the agent definitions are gone.');
} else if (cursorAgents.length === 0) {
  failures.push('.cursor/agents contains no *.md agent definitions.');
}

if (claudeAgents === null) {
  failures.push(
    '.claude/agents does not exist. Claude Code reads that path, so every agent '
    + 'in .cursor/agents is unloadable and the CLAUDE.md reviewer mandates cannot '
    + 'be followed. Restore it with: ln -s ../.cursor/agents .claude/agents'
  );
}

if (cursorAgents && claudeAgents) {
  const missing = cursorAgents.filter(f => !claudeAgents.includes(f));
  const extra = claudeAgents.filter(f => !cursorAgents.includes(f));

  if (missing.length > 0) {
    failures.push(
      `Visible to Cursor but not to Claude Code: ${missing.join(', ')}. `
      + 'These agents cannot be invoked by any Claude Code session.'
    );
  }
  if (extra.length > 0) {
    failures.push(`Present in .claude/agents but not .cursor/agents: ${extra.join(', ')}.`);
  }

  /*
   * Same names is not the same content. When the two directories are one
   * symlink this is free; when someone has replaced it with copies it is the
   * whole point of the gate.
   */
  const sameDir = existsSync(claudeDir) && realpathSync(claudeDir) === realpathSync(cursorDir);
  if (!sameDir) {
    for (const file of cursorAgents.filter(f => claudeAgents.includes(f))) {
      if (readFileSync(join(cursorDir, file), 'utf8') !== readFileSync(join(claudeDir, file), 'utf8')) {
        failures.push(
          `.claude/agents/${file} has drifted from .cursor/agents/${file}. `
          + 'Two copies of an agent definition is the drift this gate exists to catch — '
          + 'replace the copies with a symlink: rm -rf .claude/agents && ln -s ../.cursor/agents .claude/agents'
        );
      }
    }
  }
}

/*
 * Claude Code requires `name` and `description` frontmatter, and dispatches on
 * `name` — a name that disagrees with its filename is invocable only under a
 * spelling nobody reading the tree would guess.
 */
for (const file of cursorAgents ?? []) {
  const text = readFileSync(join(cursorDir, file), 'utf8');
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!frontmatter) {
    failures.push(`.cursor/agents/${file} has no YAML frontmatter — Claude Code will not load it.`);
    continue;
  }
  const name = /^name:[ \t]*(\S+)[ \t]*$/m.exec(frontmatter[1])?.[1];
  const hasDescription = /^description:[ \t]*\S/m.test(frontmatter[1]);

  if (!name) {
    failures.push(`.cursor/agents/${file} frontmatter has no \`name:\`.`);
  } else if (name !== file.replace(/\.md$/, '')) {
    failures.push(`.cursor/agents/${file} declares \`name: ${name}\` — it must match the filename.`);
  }
  if (!hasDescription) {
    failures.push(`.cursor/agents/${file} frontmatter has no \`description:\`.`);
  }
}

if (failures.length > 0) {
  console.error('verify:agents FAILED\n');
  for (const failure of failures) {
    console.error(`  - ${failure}\n`);
  }
  process.exit(1);
}

const shape = lstatSync(claudeDir).isSymbolicLink() ? 'symlink' : 'copies';
console.log(`verify:agents: ${cursorAgents.length} agents loadable by Claude Code (${shape})`);
