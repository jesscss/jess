import { appendFileSync } from 'node:fs';

const out = process.env.JESS_IMPORT_GRAPH_OUT;

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (out && url.startsWith('file:')) {
    appendFileSync(out, url + '\n');
  }
  return result;
}
