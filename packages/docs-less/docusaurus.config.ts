import type { Config } from '@docusaurus/types';
import { themes } from 'prism-react-renderer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const resolveLocalLessVersion = (): string => {
  const lessPackageJson = path.resolve(__dirname, '../../../less.js/packages/less/package.json');
  try {
    const raw = fs.readFileSync(lessPackageJson, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    const version = parsed.version ?? '';
    if (version) {
      return version;
    }
  } catch {
    // Fall through to default label when local less.js checkout is unavailable.
  }
  return '5.x-alpha';
};

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

const parseVersion = (version: string): ParsedVersion | null => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) {
    return null;
  }
  const [, major, minor, patch, prerelease = ''] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ? prerelease.split('.') : []
  };
};

const compareIdentifiers = (a: string, b: string): number => {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    return Number(a) - Number(b);
  }
  if (aNum) {
    return -1;
  }
  if (bNum) {
    return 1;
  }
  return a.localeCompare(b);
};

const compareVersions = (a: string, b: string): number => {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    return a.localeCompare(b);
  }
  if (pa.major !== pb.major) {
    return pa.major - pb.major;
  }
  if (pa.minor !== pb.minor) {
    return pa.minor - pb.minor;
  }
  if (pa.patch !== pb.patch) {
    return pa.patch - pb.patch;
  }
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) {
    return 0;
  }
  if (pa.prerelease.length === 0) {
    return 1;
  }
  if (pb.prerelease.length === 0) {
    return -1;
  }
  const maxLen = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < maxLen; i += 1) {
    const ai = pa.prerelease[i];
    const bi = pb.prerelease[i];
    if (ai === undefined) {
      return -1;
    }
    if (bi === undefined) {
      return 1;
    }
    const cmp = compareIdentifiers(ai, bi);
    if (cmp !== 0) {
      return cmp;
    }
  }
  return 0;
};

const resolveNpmLessVersions = (): { latest4x: string; latest5x: string } => {
  const fallback5x = resolveLocalLessVersion();
  try {
    const raw = execSync('npm view less versions --json', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000
    }).toString('utf8');
    const versions = JSON.parse(raw) as string[];
    const parsed = versions.filter(v => parseVersion(v) !== null);
    const v4 = parsed.filter(v => v.startsWith('4.')).sort(compareVersions).at(-1);
    const v5 = parsed.filter(v => v.startsWith('5.')).sort(compareVersions).at(-1);
    return {
      latest4x: v4 ?? '4.x',
      latest5x: v5 ?? fallback5x
    };
  } catch {
    return {
      latest4x: '4.x',
      latest5x: fallback5x
    };
  }
};

const { latest4x, latest5x } = resolveNpmLessVersions();
const pinned4xVersionKey = '4.x';

export default {
  future: {
    v4: true
  },
  title: 'Less',
  tagline: 'It\'s CSS, with just a little more.',
  url: 'https://lesscss.org',
  baseUrl: '/',
  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',
  onBrokenAnchors: 'warn',
  markdown: {
    format: 'md'
  },
  organizationName: 'less',
  projectName: 'lesscss.org',
  plugins: [],
  themeConfig: {
    colorMode: {
      disableSwitch: false,
      respectPrefersColorScheme: true
    },
    prism: {
      theme: themes.oneLight,
      darkTheme: themes.oneDark,
      additionalLanguages: ['less', 'css', 'javascript']
    },
    navbar: {
      title: 'Less',
      style: 'dark',
      logo: {
        alt: 'Less logo',
        src: 'img/less_logo.png'
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          label: 'Docs',
          position: 'left'
        },
        {
          href: 'https://github.com/less/less.js',
          label: 'GitHub',
          position: 'right'
        },
        {
          type: 'docsVersionDropdown',
          position: 'left'
        }
      ]
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Overview',
              to: 'docs/home'
            }
          ]
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/less/less.js'
            }
          ]
        }
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Less. Built with Docusaurus.`
    },
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 3
    }
  },
  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs-content/docs/less',
          sidebarPath: './sidebars.js',
          routeBasePath: 'docs',
          includeCurrentVersion: true,
          onlyIncludeVersions: ['current', '4.x'],
          lastVersion: '4.x',
          versions: {
            current: {
              label: latest5x,
              path: 'next',
              badge: false,
              banner: 'none'
            },
            [pinned4xVersionKey]: {
              label: latest4x,
              path: ''
            }
          },
          editUrl:
            'https://github.com/jesscss/jess/tree/master/packages/docs-content/docs/less/'
        },
        blog: false,
        theme: {
          customCss: ['./src/css/custom.css']
        }
      }
    ]
  ]
} satisfies Config;
