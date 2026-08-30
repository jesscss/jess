/**
 * The identity report: digesting a corpus, comparing two reports, printing one.
 *
 * ## Where the line is
 *
 * `parseman/oracle` keeps exactly one thing: {@link digestInto}, the
 * deterministic serialization of ONE parse result. That is the part only
 * parseman can write, because it is parseman's node shapes that decide which
 * distinctions are semantically meaningful, and it is the part every grammar
 * author wants regardless of what they are building.
 *
 * Everything wrapped around it — walking a corpus, folding per-entry digests
 * into an aggregate, the three-way verdict, the report formatting — lives here,
 * because it only makes sense with jess's corpus and jess's committed baseline
 * in hand.
 *
 * ## Two failure channels, never one
 *
 * A corpus entry can fail in two completely different ways and the old harness
 * spelled them the same:
 *
 *  1. **The grammar rejected the input.** `surface.parse` threw. This is a fact
 *     ABOUT THE GRAMMAR and it belongs in the digest: a change that turns a
 *     hard rejection into a silent accept has moved the contract as surely as
 *     one that renames a node. Counted in `threw`, hashed under the `ERR:`
 *     discriminator so it can never collide with a successful parse that
 *     happens to return the projected error shape.
 *
 *  2. **The digest could not be computed.** The projection ran out of visit
 *     budget, or blew up. This is a fact ABOUT THE TOOL, and it is the exact
 *     opposite of a fact about the grammar. It gets its own channel: the entry
 *     is listed in `undigested`, NO report is produced, and the run exits
 *     without a verdict.
 *
 * Folding (2) into (1) is why an unknown share of the committed baseline's
 * `threw: 120` is uninterpretable — some of those entries may be a grammar
 * rejection and some may be the tool giving up, and nothing recorded which.
 * They are separate here so that never recurs.
 *
 * Note what channel (2) is NOT: it is not a verdict, not a `moved`, and not a
 * pass. A run with even one undigested entry answers "I could not answer".
 *
 * An EMPTY parse result — `undefined`, `null`, `{}`, `[]` — is none of the
 * above. It digests normally under `OK:`, and the projection gives each of
 * those a distinct token, so an empty result is never representable the same
 * way as a failure.
 *
 * ## Nothing is materialised and nothing is retained
 *
 * The canonical projection is streamed straight into a `node:crypto` hash by
 * {@link digestInto}, so no canonical string is ever built — there is no
 * maximum-string-length ceiling and no corpus size at which the digest stops
 * being takeable. Per entry the report keeps a 16-hex fingerprint; the full
 * 64-hex digest is retained ONLY for the entries the determinism re-check will
 * actually re-read. The version of this that kept every entry's canonical TEXT
 * in order to sample 1-in-32 of them is what turned a slow gate into an OOM.
 */
import { createHash } from 'node:crypto';
import { DIGEST_FORMAT, digestInto } from 'parseman/oracle';

/**
 * Per-entry fingerprint width, in hex chars. 64 bits over a corpus of this size
 * is far below the collision floor, and a report a human has to read stays
 * readable. This is a jess report-format decision, so it lives here.
 */
const FINGERPRINT_HEX = 16;

/**
 * How many entries to re-parse to prove the grammar is deterministic. Sampled
 * evenly across the corpus, not from the front. Do not lower it to get a green
 * run: a grammar whose output depends on `Map` iteration over object identity,
 * a timestamp or a counter produces a digest that moves every run, which reads
 * exactly like a regression.
 */
const DEFAULT_DETERMINISM_SAMPLE = 32;

/** Full 64-hex sha256 of a string. */
function hash(payload) {
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Default projection of a thrown value. Keeps an `Error`'s name and message;
 * anything else is wrapped so a bare `throw 'x'` cannot collide with a real
 * error whose message is `'x'`.
 */
function defaultProjectError(thrown) {
  return thrown instanceof Error ? { name: thrown.name, message: thrown.message } : { thrown };
}

/**
 * Digest one (entry, surface) pair.
 *
 * The `OK:` / `ERR:` discriminator is not decoration and is not droppable: it
 * keeps a successful parse and a thrown error in disjoint hash spaces.
 *
 * Digesting happens OUTSIDE the `try` that guards the parse, deliberately.
 * Inside it, a failure of the PROJECTION was caught here and recorded as `ERR:`
 * with `threw++` — the tool failing to answer became indistinguishable from the
 * grammar rejecting the input, which is the one distinction this gate exists to
 * make. Here it returns on the `undigested` channel instead.
 *
 * `options.projectValue` runs in the SAME place, and for the same reason. It is
 * the caller's chance to reshape a parse result before it is projected, and it
 * is emphatically not part of the parse: a caller-supplied transform that
 * throws is the tool failing, not the grammar rejecting anything. Putting it
 * inside the parse `try` would re-open the hole this function exists to close,
 * one call site away from where it is documented.
 *
 * @returns {{ digest: string, threw: boolean } | { undigested: Error }}
 */
function digestPair(surface, id, source, options) {
  let value;
  let threw = false;
  try {
    value = surface.parse(source, id);
  } catch (thrown) {
    threw = true;
    value = (options.projectError ?? defaultProjectError)(thrown, id, surface.name);
  }

  const sha = createHash('sha256');
  try {
    const projected = options.projectValue === undefined ? value : options.projectValue(value, id, surface.name);
    digestInto(sha, projected, threw ? 'ERR:' : 'OK:', { maxVisits: options.maxVisits });
  } catch (failed) {
    return { undigested: failed instanceof Error ? failed : new Error(String(failed)) };
  }
  return { digest: sha.digest('hex'), threw };
}

const fingerprint = digest => digest.slice(0, FINGERPRINT_HEX);

/**
 * The surface aggregate.
 *
 * The surface NAME is inside its own aggregate, so two surfaces that happen to
 * agree on every entry still have distinct aggregates and a report that swapped
 * them cannot compare equal. The ids are in it too, so a corpus that quietly
 * SHRANK moves the aggregate instead of producing a smaller, greener gate.
 */
function aggregateOf(name, ids, perEntry) {
  return hash([`surface:${name}`, ...ids.map(id => `${id}:${perEntry[id][name]}`)].join('\n'));
}

/**
 * Run every surface over every corpus id and produce the report.
 *
 * @param {readonly { name: string, parse: (source: string, id: string) => unknown }[]} surfaces
 * @param {{ ids: readonly string[], read: (id: string) => string }} corpus
 * @param {{
 *   projectError?: Function,
 *   projectValue?: Function,
 *   determinismSample?: number,
 *   maxVisits?: number
 * }} [options]
 * @returns {{ report: object | null, undigested: { id: string, surface: string, error: Error }[] }}
 */
export function digestCorpus(surfaces, corpus, options = {}) {
  if (surfaces.length === 0) {
    throw new Error('digestCorpus: no surfaces — there is nothing to compare.');
  }
  const names = new Set();
  for (const s of surfaces) {
    if (names.has(s.name)) {
      throw new Error(`digestCorpus: duplicate surface name ${JSON.stringify(s.name)}.`);
    }
    names.add(s.name);
  }

  const ids = [...corpus.ids].sort();
  for (let n = 1; n < ids.length; n++) {
    if (ids[n] === ids[n - 1]) {
      throw new Error(`digestCorpus: duplicate corpus id ${JSON.stringify(ids[n])}.`);
    }
  }

  /*
   * The determinism sample is decided UP FRONT, from the corpus size alone, so
   * full digests are retained only for the entries that will actually be
   * re-read. Every other entry contributes its 16-hex fingerprint and nothing
   * else.
   */
  const sample = sampleIndices(ids.length, options.determinismSample ?? DEFAULT_DETERMINISM_SAMPLE);

  const perEntry = {};
  const threw = {};
  const undigested = [];
  const retained = new Map();
  const retainedSource = new Map();
  for (const s of surfaces) {
    threw[s.name] = 0;
  }

  for (let n = 0; n < ids.length; n++) {
    const id = ids[n];
    const source = corpus.read(id);
    const row = {};
    for (const s of surfaces) {
      const result = digestPair(s, id, source, options);
      if (result.undigested !== undefined) {
        undigested.push({ id, surface: s.name, error: result.undigested });
        continue;
      }
      if (result.threw) {
        threw[s.name]++;
      }
      row[s.name] = fingerprint(result.digest);
      if (sample.has(n)) {
        retained.set(`${n}:${s.name}`, result.digest);
      }
    }
    perEntry[id] = row;

    /*
     * Hold the SOURCE for the sampled entries, not just the digest. Re-reading
     * the file for the determinism check would let an edit landing mid-run
     * report as grammar nondeterminism, which is the loudest wrong answer this
     * gate can give.
     */
    if (sample.has(n)) {
      retainedSource.set(n, source);
    }
  }

  /*
   * A report with a hole in it is not a report. Returning one that simply omits
   * the entries the tool could not digest would produce a smaller, greener
   * gate — the precise failure the id-bearing aggregate exists to prevent — so
   * the run answers "I could not answer" instead.
   */
  if (undigested.length > 0) {
    return { report: null, undigested };
  }

  const late = verifyDeterminism(surfaces, ids, sample, retained, retainedSource, options);
  if (late.length > 0) {
    return { report: null, undigested: late };
  }

  return {
    report: {
      format: DIGEST_FORMAT,
      harness: HARNESS_DIGEST,
      entries: ids.length,
      surfaces: surfaces.map(s => ({
        name: s.name,
        aggregate: aggregateOf(s.name, ids, perEntry),
        threw: threw[s.name]
      })),
      perEntry
    },
    undigested
  };
}

/** Evenly spaced indices, not the front of the corpus. */
function sampleIndices(total, want) {
  const picked = new Set();
  if (want <= 0 || total === 0) {
    return picked;
  }
  const stride = Math.max(1, Math.floor(total / Math.min(want, total)));
  for (let n = 0; n < total; n += stride) {
    picked.add(n);
  }
  return picked;
}

/**
 * Re-digest the sample and prove it reproduces.
 *
 * A projection failure on the SECOND pass is not nondeterminism — it is the
 * tool giving up, again — so it is returned on the `undigested` channel rather
 * than asserted as a fact about the grammar.
 *
 * @returns {{ id: string, surface: string, error: Error }[]}
 */
function verifyDeterminism(surfaces, ids, sample, retained, retainedSource, options) {
  const late = [];
  for (const n of sample) {
    const id = ids[n];
    const source = retainedSource.get(n);
    for (const s of surfaces) {
      const again = digestPair(s, id, source, options);
      if (again.undigested !== undefined) {
        late.push({ id, surface: s.name, error: again.undigested });
        continue;
      }
      if (again.digest === retained.get(`${n}:${s.name}`)) {
        continue;
      }
      throw new Error(
        `digestCorpus: surface ${JSON.stringify(s.name)} is NOT DETERMINISTIC on ${JSON.stringify(id)} — `
        + 'two parses of the same source produced different output. Every digest from this grammar would move on '
        + 'its own, so a comparison against it cannot mean anything. Usual causes: a timestamp or counter in the '
        + 'output, iteration over a keyed-by-object Map, or a node carrying a reference to mutable shared state.'
      );
    }
  }
  return late;
}

/**
 * Compare two reports.
 *
 * Refuses — `incomparable`, with a reason — when the two were not produced by
 * the same harness over comparable inputs. That is the whole point: the failure
 * mode this guards against is a harness change that quietly re-baselines every
 * recorded digest, and the only defence is that mismatched provenance can never
 * come out as a verdict about the grammar.
 *
 * A corpus that gained or lost entries is reported but is NOT by itself
 * incomparable — the surviving entries still carry a real signal, and telling
 * you "5 entries appeared, the other 709 are unchanged" is more useful than
 * refusing. The verdict still reflects the difference.
 */
export function compareReports(before, after) {
  /*
   * A report that is not shaped like one is `incomparable`, not a crash. The
   * thing on the other side of this call is usually a JSON file someone
   * hand-edited or truncated, and `TypeError: cannot read slice of undefined`
   * is a worse answer than the refusal this function already knows how to give.
   */
  for (const [which, r] of [['baseline', before], ['current', after]]) {
    if (typeof r?.harness !== 'string' || typeof r?.format !== 'number' || typeof r?.perEntry !== 'object'
      || r.perEntry === null || !Array.isArray(r?.surfaces)) {
      return incomparable(
        `the ${which} report is not a report: it is missing or has the wrong type for one of `
        + '`harness`, `format`, `surfaces`, `perEntry`.'
      );
    }
  }
  if (before.harness !== after.harness) {
    return incomparable(
      'harness drift: reports were produced by DIFFERENT versions of the identity harness '
      + `(${before.harness.slice(0, 12)}… vs ${after.harness.slice(0, 12)}…). Their digests are not comparable, `
      + 'and treating them as such would either invent a regression or hide one. Re-run BOTH sides on one harness.'
    );
  }
  if (before.format !== after.format) {
    return incomparable(`digest format ${before.format} vs ${after.format} — re-run both sides on one version.`);
  }

  const beforeIds = new Set(Object.keys(before.perEntry));
  const afterIds = new Set(Object.keys(after.perEntry));
  const addedEntries = [...afterIds].filter(id => !beforeIds.has(id)).sort();
  const removedEntries = [...beforeIds].filter(id => !afterIds.has(id)).sort();
  const shared = [...beforeIds].filter(id => afterIds.has(id)).sort();

  const byName = new Map();
  for (const s of before.surfaces) {
    byName.set(s.name, { ...byName.get(s.name), before: s });
  }
  for (const s of after.surfaces) {
    byName.set(s.name, { ...byName.get(s.name), after: s });
  }

  const surfaces = [...byName.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, pair]) => ({
      name,
      before: pair.before?.aggregate ?? null,
      after: pair.after?.aggregate ?? null,
      equal: pair.before !== undefined && pair.after !== undefined && pair.before.aggregate === pair.after.aggregate,
      moved: pair.before && pair.after
        ? shared.filter(id => before.perEntry[id][name] !== after.perEntry[id][name])
        : [],
      shared: shared.length,
      beforeThrew: pair.before?.threw ?? null,
      afterThrew: pair.after?.threw ?? null
    }));

  const identical = addedEntries.length === 0 && removedEntries.length === 0 && surfaces.every(s => s.equal);
  return { verdict: identical ? 'identical' : 'moved', reason: null, addedEntries, removedEntries, surfaces };
}

function incomparable(reason) {
  return { verdict: 'incomparable', reason, addedEntries: [], removedEntries: [], surfaces: [] };
}

/** Human-readable rendering of a comparison, for a CLI or a CI log. */
export function formatComparison(c, options = {}) {
  if (c.verdict === 'incomparable') {
    return `INCOMPARABLE — ${c.reason ?? 'unknown reason'}`;
  }
  const max = options.maxMoved ?? 10;
  const lines = [];
  for (const s of c.surfaces) {
    if (s.before === null) {
      lines.push(`  + surface ${s.name} (added)`);
    } else if (s.after === null) {
      lines.push(`  - surface ${s.name} (removed)`);
    } else if (s.equal) {
      lines.push(`  = ${s.name}  ${s.before.slice(0, 16)}…  threw=${s.afterThrew}`);
    } else {
      lines.push(
        `  ! ${s.name}  ${s.before.slice(0, 16)}… -> ${s.after.slice(0, 16)}…  `
        + `threw ${s.beforeThrew} -> ${s.afterThrew}  (${s.moved.length}/${s.shared} shared entries moved)`
      );
      for (const id of s.moved.slice(0, max)) {
        lines.push(`      ${id}`);
      }
      if (s.moved.length > max) {
        lines.push(`      … and ${s.moved.length - max} more`);
      }
    }
  }
  if (c.addedEntries.length > 0) {
    lines.push(`  corpus GAINED ${c.addedEntries.length} entries`);
  }
  if (c.removedEntries.length > 0) {
    lines.push(
      `  corpus LOST ${c.removedEntries.length} entries — a differential over a SMALLER corpus is a weaker gate, `
      + 'not a passing one'
    );
  }
  return [c.verdict === 'identical' ? 'IDENTICAL — output-neutral' : 'MOVED — this is not a refactor', ...lines]
    .join('\n');
}

/** Render the undigested channel. Never a verdict — see the module header. */
export function formatUndigested(undigested, options = {}) {
  const max = options.maxListed ?? 10;
  const bySurface = new Map();
  for (const u of undigested) {
    bySurface.set(u.surface, (bySurface.get(u.surface) ?? 0) + 1);
  }
  const lines = [
    `UNDIGESTABLE — the projection could not be computed for ${undigested.length} (entry, surface) pair(s).`,
    '  This is NOT a grammar verdict. The tool could not answer; it is not saying the grammar moved.',
    `  by surface: ${[...bySurface].map(([n, c]) => `${n}=${c}`).join(' ')}`
  ];
  for (const u of undigested.slice(0, max)) {
    lines.push(`  ${u.surface}  ${u.id}`);
    lines.push(`      ${u.error.name}: ${u.error.message.split('\n')[0]}`);
  }
  if (undigested.length > max) {
    lines.push(`  … and ${undigested.length - max} more`);
  }
  return lines.join('\n');
}

/**
 * The frozen canary, and the behavioural fingerprint computed from it.
 *
 * One entry per decision the projection and {@link digestPair} make. Any edit
 * that changes what this harness produces for ANY input changes what it
 * produces for one of these, and therefore changes {@link HARNESS_DIGEST} —
 * which {@link compareReports} refuses to compare across. A drifted harness
 * produces an error, not a verdict.
 *
 * It deliberately builds its values by hand rather than by parsing anything:
 * the fingerprint must move when the HARNESS moves and at no other time. If it
 * ran a real grammar, every grammar edit in this repo would re-baseline it, and
 * a fingerprint that moves for unrelated reasons is one people learn to update
 * without reading.
 *
 * The canary is byte-identical to the one `parseman/oracle` carried when the
 * committed baseline was taken, and `HARNESS_DIGEST` therefore still equals the
 * value recorded in it. That equality is the proof this move did not change the
 * projection: same canary in, same fingerprint out. parseman has since added a
 * canary entry of its own and moved ITS fingerprint; that is now parseman's to
 * move, and jess pinning this one is what keeps the committed baseline
 * comparable rather than `incomparable`.
 *
 * What a frozen canary cannot cover is the ONE decision that has no
 * fingerprint: whether a projection failure lands on `threw` or on
 * `undigested`. Every canary entry that exercised it would have to be
 * digestable to contribute a fingerprint, and by definition it is not. It is
 * asserted directly instead — see {@link assertFailureChannelsAreDisjoint} —
 * so folding the digest back inside the parse `try` fails at import rather than
 * quietly reporting itself as a grammar move.
 */
function canaryReport() {
  class Tagged {
    constructor(x) {
      this.x = x;
    }
  }
  const shared = { shared: true };
  const cyclic = { name: 'root' };
  cyclic.self = cyclic;
  cyclic.child = { up: cyclic };

  const values = {
    'a/scalars': [0, -0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 10n, true, false, null],
    'b/absent': [{ a: undefined }, {}, { a: null }, [undefined], []],
    'c/key-order': [{ a: 1, b: 2 }, { b: 2, a: 1 }],
    'd/collections': [new Map([['k', 1], ['j', 2]]), new Set([1, 2]), new Date(0), /ab+c/giu],
    'e/tagged': [new Tagged(1), { x: 1 }],
    'f/sharing': { left: shared, right: shared },
    'g/cycle': cyclic,
    'h/text': ['', 'a\u0000b', 'a b', '"quoted"', '\\'],
    'i/callable': [function named() {}, Symbol('sym')]
  };

  const surfaces = [
    { name: 'value', parse: (_source, id) => values[id] },
    {
      name: 'thrower',
      parse: (_source, id) => {
        if (id === 'a/scalars') {
          throw new TypeError('canary');
        }
        if (id === 'b/absent') {
          throw 'a bare string';
        }
        return { id };
      }
    }
  ];

  const perEntry = {};
  const threw = { value: 0, thrower: 0 };
  for (const id of Object.keys(values).sort()) {
    const row = {};
    for (const s of surfaces) {
      const result = digestPair(s, id, id, {});
      if (result.undigested !== undefined) {
        throw new Error(`identity harness: the canary failed to digest on ${JSON.stringify(id)}.`);
      }
      if (result.threw) {
        threw[s.name]++;
      }
      row[s.name] = fingerprint(result.digest);
    }
    perEntry[id] = row;
  }

  const ids = Object.keys(perEntry).sort();
  return surfaces.map(s => ({ name: s.name, aggregate: aggregateOf(s.name, ids, perEntry), threw: threw[s.name] }));
}

/**
 * The one guarantee the fingerprint cannot carry: a grammar rejection and a
 * projection failure must never arrive on the same channel.
 *
 * Both cases are checked, because either direction is a silent lie. A parse
 * that throws must still produce a digest (error behaviour IS behaviour); a
 * value the projection cannot walk must produce NO digest and no `threw`.
 * Run at import, so there is no way to load this module with the two conflated.
 */
function assertFailureChannelsAreDisjoint() {
  // `maxVisits: 0` makes the projection refuse the first object it is handed.
  const undigestable = digestPair({ name: 'canary', parse: () => ({ a: 1 }) }, 'x', 'x', { maxVisits: 0 });
  if (undigestable.undigested === undefined) {
    throw new Error(
      'identity harness: a value the projection REFUSED came back with a digest. The two failure channels are '
      + 'conflated, which means "the grammar rejected this file" and "the digest could not be computed" are being '
      + 'reported as the same thing — the one distinction this gate exists to make.'
    );
  }

  const rejected = digestPair({ name: 'canary', parse: () => {
    throw new TypeError('rejected');
  } }, 'x', 'x', {});
  if (rejected.undigested !== undefined || rejected.threw !== true || typeof rejected.digest !== 'string') {
    throw new Error(
      'identity harness: a parse that THREW did not produce an `ERR:` digest. Error behaviour is behaviour and '
      + 'has to stay in the hash, or a change that turns a hard rejection into a silent accept stops being visible.'
    );
  }
}

assertFailureChannelsAreDisjoint();

/** Behavioural fingerprint of this harness, embedded in every report it makes. */
export const HARNESS_DIGEST = hash(
  [`format:${DIGEST_FORMAT}`, ...canaryReport().map(s => `${s.name}:${s.aggregate}:${s.threw}`)].join('\n')
);
