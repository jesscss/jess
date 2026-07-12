#!/usr/bin/env node
import { incrementAlphaVersions } from './release-utils.mjs';

const rootDir = process.cwd();
const { previousVersion, nextVersion } = incrementAlphaVersions({ rootDir });
console.log(`Alpha version incremented: ${previousVersion} -> ${nextVersion}`);
