/*
 * Run by deno-net-denial.test.ts under `deno run --allow-net=allowed.invalid,127.0.0.1`.
 * Prints one JSON line saying, per probe, whether the Deno runtime denied it.
 *
 * The plugin's own allow list admits BOTH hosts here, so the app-level check is
 * out of the way: whatever still stops `denied.invalid` is the runtime.
 */
import { RemoteImportPlugin } from '../../src/index.ts';

type Outcome = 'runtime-denied' | 'reached-network' | 'resolved';

/** NotCapable (Deno 2; PermissionDenied before it) from fetch, or EPERM from a permission-checked DNS lookup. */
const deniedByRuntime = (error: unknown): boolean =>
  error instanceof Deno.errors.NotCapable
  || error instanceof Deno.errors.PermissionDenied
  || (error instanceof Error && 'code' in error && error.code === 'EPERM');

const probe = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return 'resolved';
  } catch (error) {
    return deniedByRuntime(error) ? 'runtime-denied' : 'reached-network';
  }
};

const allow = ['allowed.invalid', 'denied.invalid'];

/** Deno's own fetch as the transport: no app-level DNS guard either. */
const raw = new RemoteImportPlugin({ allow, timeout: 3000, fetch: (url, init) => fetch(url, init) });

/** The shipped default transport. */
const guarded = new RemoteImportPlugin({ allow, timeout: 3000 });

/** A loopback server that redirects off the list; fetch follows it inside the runtime. */
const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, () =>
  new Response(null, { status: 302, headers: { location: 'https://denied.invalid/next.less' } }));
const { port } = server.addr;

const report = {
  denied: await probe(() => raw.getSource('https://denied.invalid/x.less')),
  allowed: await probe(() => raw.getSource('https://allowed.invalid/x.less')),
  guardedDenied: await probe(() => guarded.getSource('https://denied.invalid/x.less')),
  guardedAllowed: await probe(() => guarded.getSource('https://allowed.invalid/x.less')),
  redirectHop: await probe(() => fetch(`http://127.0.0.1:${port}/start.less`, { signal: AbortSignal.timeout(3000) }))
};
await server.shutdown();
console.log(JSON.stringify(report));
