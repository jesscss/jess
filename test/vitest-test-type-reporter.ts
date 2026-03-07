// Custom Vitest reporter that prints a single ✓/✗ line per “test type”.
// In practice right now, that means:
// - `scss-parser (baseline)`
// - `sass-spec smoke (parse-only) > feature: <name>`
//
// This complements (not replaces) the default `verbose` reporter.

type Task = {
  type?: string;
  name?: string;
  tasks?: Task[];
  result?: { state?: 'pass' | 'fail' | 'skip' | 'todo' | string };
};

function collectSuites(root: Task, predicate: (suiteName: string, fullName: string) => boolean) {
  type SuiteInfo = { fullName: string; suite: Task; counts: Record<string, number> };
  const out: SuiteInfo[] = [];

  const walk = (task: Task, parents: string[]) => {
    const name = task.name ?? '';
    const nextParents = name ? [...parents, name] : parents;

    if (task.type === 'suite' && name) {
      const fullName = nextParents.join(' > ');
      if (predicate(name, fullName)) {
        out.push({ fullName, suite: task, counts: { pass: 0, fail: 0, skip: 0, todo: 0, other: 0 } });
      }
    }

    for (const child of task.tasks ?? []) {
      walk(child, nextParents);
    }
  };

  walk(root, []);
  return out;
}

function countTestsIntoSuite(suite: Task, counts: Record<string, number>) {
  const walk = (t: Task) => {
    if (t.type === 'test') {
      const state = t.result?.state ?? 'other';
      if (state in counts) counts[state] += 1;
      else counts.other += 1;
      return;
    }
    for (const child of t.tasks ?? []) walk(child);
  };
  walk(suite);
}

export class TestTypeReporter {
  onFinished(files: unknown) {
    const fileTasks = Array.isArray(files) ? (files as Task[]) : [];

    /** wrap all files into a synthetic suite root for traversal */
    const root: Task = { type: 'suite', name: '', tasks: fileTasks };

    const suites = [
      ...collectSuites(root, (name) => name === 'scss-parser (baseline)'),
      ...collectSuites(root, (name, full) => name.startsWith('feature: ') && full.includes('sass-spec smoke (parse-only)'))
    ];

    if (suites.length === 0) return;

    for (const s of suites) {
      countTestsIntoSuite(s.suite, s.counts);
      const failed = s.counts.fail > 0;
      const prefix = failed ? '✗' : '✓';
      // Keep the line short + stable.
      // Example:
      // ✓ sass-spec feature: map (312 passed, 0 failed, 120 skipped)
      const label = s.fullName
        .replace(/^sass-spec smoke \(parse-only\)\s*>\s*/i, 'sass-spec ')
        .replace(/^feature:\s*/i, 'feature: ')
        .replace(/^scss-parser \(baseline\)$/i, 'scss baseline');
      // eslint-disable-next-line no-console
      console.log(`${prefix} ${label} (${s.counts.pass} passed, ${s.counts.fail} failed, ${s.counts.skip} skipped)`);
    }
  }
}

