import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDocsDir = path.resolve(packageDir, '..', 'docs-content', 'docs', 'less');
const sourceSidebarPath = path.resolve(packageDir, '..', 'docs-content', 'sidebars', 'less.js');
const legacyBrowserUsagePath = path.resolve(
  packageDir,
  'scripts',
  'legacy-using-less-in-the-browser-4x.md'
);
const legacyUsingLessPath = path.resolve(
  packageDir,
  'scripts',
  'legacy-using-less-4x.md'
);
const legacyDownloadOptionsPath = path.resolve(
  packageDir,
  'scripts',
  'legacy-download-options-4x.md'
);
const versionName = '4.x';
const versionDocsDir = path.join(packageDir, 'versioned_docs', `version-${versionName}`);
const versionedSidebarPath = path.join(packageDir, 'versioned_sidebars', `version-${versionName}-sidebars.json`);
const versionsFilePath = path.join(packageDir, 'versions.json');
const currentOnlyDocs = [
  'usage/migrating-to-v5.md'
];
const currentOnlyHomeLine =
  '- **Clear upgrade runway**: when you are ready, Less 5.x lets teams migrate seamlessly to the Jess language without rewriting everything at once.';
const currentOnlyPluginWarnings = [
  `:::warning 5.x+ status
In the 5.x+ track, \`@plugin\` is **deprecated** and **experimentally supported**.

Prefer \`@use\` / \`@-use\` for new script integration when compiling \`.less\` through the Less CLI compatibility path.
Dedicated script-module documentation is not published yet and will be added in a follow-up docs update.
:::
`,
  `:::warning 5.x+ status
In the 5.x+ track, \`@plugin\` is **deprecated** and currently **experimental**.

Prefer \`@use\` / \`@-use\` for new script integration when compiling \`.less\` through the Less CLI compatibility path.
We have not published dedicated script-module documentation yet.
:::
`
];

const walkFiles = (dirPath, out = []) => {
  if (!fs.existsSync(dirPath)) {
    return out;
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, out);
      continue;
    }
    out.push(fullPath);
  }
  return out;
};

const copyTree = (sourceDir, targetDir) => {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const sourcePath of walkFiles(sourceDir)) {
    const rel = path.relative(sourceDir, sourcePath);
    const targetPath = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
};

const targets = [
  versionsFilePath,
  versionDocsDir,
  versionedSidebarPath
];

for (const target of targets) {
  fs.rmSync(target, { recursive: true, force: true });
}

copyTree(sourceDocsDir, versionDocsDir);
for (const relPath of currentOnlyDocs) {
  fs.rmSync(path.join(versionDocsDir, relPath), { recursive: true, force: true });
}
const versionBrowserUsagePath = path.join(versionDocsDir, 'usage', 'using-less-in-the-browser.md');
if (fs.existsSync(legacyBrowserUsagePath)) {
  fs.mkdirSync(path.dirname(versionBrowserUsagePath), { recursive: true });
  fs.copyFileSync(legacyBrowserUsagePath, versionBrowserUsagePath);
}
const versionUsingLessPath = path.join(versionDocsDir, 'usage', 'using-less.md');
if (fs.existsSync(legacyUsingLessPath)) {
  fs.mkdirSync(path.dirname(versionUsingLessPath), { recursive: true });
  fs.copyFileSync(legacyUsingLessPath, versionUsingLessPath);
}
const versionDownloadOptionsPath = path.join(versionDocsDir, 'home', 'download-options.md');
if (fs.existsSync(legacyDownloadOptionsPath)) {
  fs.mkdirSync(path.dirname(versionDownloadOptionsPath), { recursive: true });
  fs.copyFileSync(legacyDownloadOptionsPath, versionDownloadOptionsPath);
}
const versionExtendPath = path.join(versionDocsDir, 'features', 'extend.md');
if (fs.existsSync(versionExtendPath)) {
  const extendContent = fs.readFileSync(versionExtendPath, 'utf8');
  const legacyExtendContent = extendContent.replaceAll('!all', 'all');
  fs.writeFileSync(versionExtendPath, legacyExtendContent, 'utf8');
}
const versionHomePath = path.join(versionDocsDir, 'Home.md');
if (fs.existsSync(versionHomePath)) {
  const homeContent = fs.readFileSync(versionHomePath, 'utf8');
  const nextHomeContent = homeContent
    .replace(`${currentOnlyHomeLine}\n`, '')
    .replace(currentOnlyHomeLine, '');
  fs.writeFileSync(versionHomePath, nextHomeContent, 'utf8');
}
for (const relPath of ['features/plugins.md', 'usage/plugins.md']) {
  const pluginDocPath = path.join(versionDocsDir, relPath);
  if (!fs.existsSync(pluginDocPath)) {
    continue;
  }
  let pluginDocContent = fs.readFileSync(pluginDocPath, 'utf8');
  for (const warningBlock of currentOnlyPluginWarnings) {
    pluginDocContent = pluginDocContent.replace(warningBlock, '');
  }
  fs.writeFileSync(pluginDocPath, pluginDocContent, 'utf8');
}
fs.mkdirSync(path.dirname(versionedSidebarPath), { recursive: true });
const sidebarModule = await import(`file://${sourceSidebarPath}`);
const sidebar = sidebarModule.default ?? {};

const pruneCurrentOnlySidebarItems = (items) => {
  return items
    .filter((item) => {
      if (typeof item === 'string') {
        return item !== 'usage/migrating-to-v5';
      }
      if (
        item?.type === 'doc'
        && item?.id === 'usage/migrating-to-v5'
      ) {
        return false;
      }
      return true;
    })
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if (Array.isArray(item?.items)) {
        return {
          ...item,
          items: pruneCurrentOnlySidebarItems(item.items)
        };
      }
      return item;
    });
};

const ensureLegacyCdnOptionsInGettingStarted = (items) => {
  return items.map((item) => {
    if (typeof item === 'string') {
      return item;
    }
    if (item?.type === 'category' && item?.label === 'Getting Started' && Array.isArray(item.items)) {
      const nextItems = [...item.items];
      if (!nextItems.includes('home/cdn-options')) {
        const downloadIndex = nextItems.indexOf('home/download-options');
        if (downloadIndex >= 0) {
          nextItems.splice(downloadIndex + 1, 0, 'home/cdn-options');
        } else {
          nextItems.push('home/cdn-options');
        }
      }
      return { ...item, items: nextItems };
    }
    if (Array.isArray(item?.items)) {
      return {
        ...item,
        items: ensureLegacyCdnOptionsInGettingStarted(item.items)
      };
    }
    return item;
  });
};

const versionedSidebar = {
  ...sidebar,
  docs: ensureLegacyCdnOptionsInGettingStarted(
    pruneCurrentOnlySidebarItems(sidebar.docs ?? [])
  )
};

fs.writeFileSync(versionsFilePath, JSON.stringify([versionName], null, 2) + '\n', 'utf8');
fs.writeFileSync(versionedSidebarPath, JSON.stringify(versionedSidebar, null, 2) + '\n', 'utf8');

console.log(`Refreshed pinned docs version ${versionName}.`);
