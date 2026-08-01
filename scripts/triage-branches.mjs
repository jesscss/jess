#!/usr/bin/env node
/**
 * Triage a branch queue by CONTENT, not by SHA.
 *
 * `dev` rebases constantly, so a change that has already landed reappears on its
 * branch under a new hash. `git cherry`, "N commits ahead" and SHA comparison all
 * then report that branch as unmerged. After a 90+ commit day this made the queue
 * unreadable: 79 branches showed commits ahead and most were already shipped.
 *
 * The question "is this branch's content on dev?" is answered by trying to take it
 * back OUT: generate the branch's patch against its merge-base and reverse-apply it
 * to dev's tree. Clean => already there.
 *
 * Usage:
 *   node scripts/triage-branches.mjs                # every remote branch ahead of dev
 *   node scripts/triage-branches.mjs lane/foo fix/bar
 *   node scripts/triage-branches.mjs --base origin/main
 *   node scripts/triage-branches.mjs --json
 *   node scripts/triage-branches.mjs --all     # include alpha/archive release lines
 *
 * Outcomes:
 *   ANCESTOR      branch is contained in the base; nothing to land
 *   CONTENT_ON_DEV whole patch reverse-applies; landed, possibly under other SHAs
 *   PARTIAL       some files reverse-apply and some do not
 *   UNMERGED      nothing reverse-applies
 *   DEAD_PATHS    every file it touches ONCE EXISTED at the merge-base and is now
 *                 gone from the base -- a stale branch against a reorganised tree.
 *                 A path the merge-base also lacked is the branch ADDING a file,
 *                 which is new work; conflating the two deletes real work.
 *
 * PARTIAL and UNMERGED are NOT verdicts, they are "read this one". A branch can be
 * BEHIND on the same file it appears to add, in which case landing it is a
 * regression -- check the direction before acting.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const baseIdx = args.indexOf('--base');
const base = baseIdx >= 0 ? args[baseIdx + 1] : 'origin/dev';

/* `baseIdx + 1` is only the base's VALUE when `--base` was actually passed; with
 * `baseIdx === -1` it is index 0, which would silently drop the first branch. */
const baseValueIdx = baseIdx >= 0 ? baseIdx + 1 : -1;
const named = args.filter((a, i) => !a.startsWith('--') && i !== baseValueIdx);

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const gitOk = (...a) => {
  try {
    execFileSync('git', a, { stdio: 'ignore', maxBuffer: 1 << 28 });
    return true;
  } catch {
    return false;
  }
};

/*
 * Long-lived release/archive lines are not queue items. `alpha` sits thousands of
 * files from `dev` permanently and will never be "landed", so counting it inflates
 * the outstanding total and its PARTIAL row is meaningless. Excluding it is the
 * same correction as NOT filtering the queue down to `lane/|fix/` prefixes: both
 * are the wrong denominator, in opposite directions. Pass --all to include them.
 */
const NOT_QUEUE_ITEMS = [/^origin\/alpha$/, /^origin\/alpha-archive-/, /^origin\/main$/];

function allAheadOfBase() {
  const includeAll = args.includes('--all');
  const refs = git('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(r => r !== 'origin' && r !== 'origin/HEAD' && r !== base)
    .filter(r => includeAll || !NOT_QUEUE_ITEMS.some(re => re.test(r)));
  return refs.filter((r) => {
    const n = git('rev-list', '--count', `${base}..${r}`).trim();
    return n !== '0';
  }).map(r => r.replace(/^origin\//, ''));
}

const branches = named.length > 0 ? named : allAheadOfBase();
const tmp = mkdtempSync(join(tmpdir(), 'triage-'));
const rows = [];

for (const b of branches) {
  const ref = b.startsWith('origin/') ? b : `origin/${b}`;
  let mb;
  try {
    mb = git('merge-base', base, ref).trim();
  } catch {
    rows.push({ branch: b, outcome: 'NOREF' });
    continue;
  }

  const ahead = Number(git('rev-list', '--count', `${mb}..${ref}`).trim());
  if (ahead === 0) {
    rows.push({ branch: b, outcome: 'ANCESTOR', ahead: 0, files: 0 });
    continue;
  }

  const files = git('diff', '--name-only', mb, ref).split('\n').filter(Boolean);
  const patch = join(tmp, 'all.patch');
  writeFileSync(patch, git('diff', mb, ref));

  if (gitOk('apply', '--check', '-R', patch)) {
    rows.push({ branch: b, outcome: 'CONTENT_ON_DEV', ahead, files: files.length });
    continue;
  }

  // Per-file, so "partly landed" is distinguishable from "wholly outstanding".
  const present = [];
  const absent = [];
  let missingPaths = 0;
  for (const f of files) {
    const one = join(tmp, 'one.patch');
    writeFileSync(one, git('diff', mb, ref, '--', f));
    if (gitOk('apply', '--check', '-R', one)) {
      present.push(f);
    } else {
      absent.push(f);
    }

    /*
     * "Absent from the base" is ambiguous and conflating the two halves is how a
     * queue loses new work: a path missing from `base` is DEAD only when the base
     * once had it and dropped it (rename, delete, tree reorg). If the merge-base
     * did not have it either, the branch is ADDING it, which is new work, not rot.
     */
    const goneFromBase = !gitOk('cat-file', '-e', `${base}:${f}`);
    const existedAtMergeBase = gitOk('cat-file', '-e', `${mb}:${f}`);
    if (goneFromBase && existedAtMergeBase) {
      missingPaths++;
    }
  }

  const outcome = missingPaths === files.length
    ? 'DEAD_PATHS'
    : present.length === 0 ? 'UNMERGED' : 'PARTIAL';
  rows.push({
    branch: b, outcome, ahead, files: files.length,
    present: present.length, absent: absent.length, missingPaths,
    absentFiles: absent.slice(0, 12)
  });
}

rmSync(tmp, { recursive: true, force: true });

if (asJson) {
  console.log(JSON.stringify({ base, rows }, null, 2));
} else {
  const order = ['ANCESTOR', 'CONTENT_ON_DEV', 'DEAD_PATHS', 'PARTIAL', 'UNMERGED', 'NOREF'];
  for (const o of order) {
    const group = rows.filter(r => r.outcome === o);
    if (group.length === 0) {
      continue;
    }
    console.log(`\n=== ${o} (${group.length}) ===`);
    for (const r of group) {
      const detail = r.outcome === 'PARTIAL'
        ? `  present=${r.present} absent=${r.absent}${r.missingPaths ? ` missingPaths=${r.missingPaths}` : ''}`
        : r.files !== undefined ? `  ahead=${r.ahead} files=${r.files}` : '';
      console.log(`  ${r.branch}${detail}`);
    }
  }
  console.log(`\nbase=${base}  branches=${rows.length}`);
}
