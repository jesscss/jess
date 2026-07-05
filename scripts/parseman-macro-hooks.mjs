import { fileURLToPath } from 'node:url';
import plugin from 'parseman/plugin';

const { transformInclude, transform } = plugin.raw();

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.startsWith('file:') || result.source == null) return result;
  const id = fileURLToPath(url);
  if (!transformInclude(id)) return result;
  const out = await transform.call({}, result.source.toString(), id);
  if (out == null) return result;
  const source = typeof out === 'string' ? out : out.code;
  return source == null ? result : { ...result, source, shortCircuit: true };
}
