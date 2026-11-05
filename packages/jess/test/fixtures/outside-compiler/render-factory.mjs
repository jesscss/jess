/* A plugin whose recorded factory is argv[3] of `commonjs-only.cjs`, for what the sandbox does with that name. */
import { recordPluginModule } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { OutsideCompiler } from './outside-compiler.mjs';
import { report } from './report.mjs';

const plugin = recordPluginModule({ name: 'commonjs-only' }, new URL('./commonjs-only.cjs', import.meta.url).href, process.argv[3], []);
await report(new OutsideCompiler({ compile: { plugins: [lessPlugin({}), lessCompatPlugin({ plugins: [] }), plugin] } }), process.argv[2]);
