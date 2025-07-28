import type { Config } from '@docusaurus/types';
import { themes } from 'prism-react-renderer'

export default {
  future: {
    v4: true,
  },
  title: 'Jess',
  tagline: 'Jess is in alpha and currently seeking testers / collaborators!',
  url: 'https://jesscss.github.io',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.ico',
  organizationName: 'jesscss', // Usually your GitHub org/user name.
  projectName: 'jesscss.github.io', // Usually your repo name.
  // plugins: [
  //   [
  //     '@docusaurus/plugin-content-docs',
  //     {
        
  //     }
  //   ]
  // ],
  themeConfig: {
    colorMode: {
      disableSwitch: false,
      respectPrefersColorScheme: true
    },
    prism: {
      theme: themes.oneLight,
      darkTheme: themes.oneDark,
      additionalLanguages: ['javascript', 'typescript', 'scss', 'less'],
    },
    navbar: {
      title: 'Jess',
      logo: {
        alt: 'My Site Logo',
        src: 'img/logo.svg'
      },
      items: [
        {
          to: 'docs/',
          activeBasePath: 'docs',
          label: 'Docs',
          position: 'left'
        },
        // {to: 'blog', label: 'Blog', position: 'left'},
        {
          href: 'https://github.com/jesscss/jess',
          label: 'GitHub',
          position: 'right'
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
              label: 'About Jess',
              to: 'docs/'
            }
          ]
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Gitter',
              href: 'https://gitter.im/jesscss/community'
            },
            {
              label: 'Twitter',
              href: 'https://twitter.com/cssjess'
            },
            {
              label: 'Stack Overflow',
              href: 'https://stackoverflow.com/questions/tagged/jesscss'
            }
          ]
        },
        {
          title: 'More',
          items: [
            // {
            //   label: 'Blog',
            //   to: 'blog',
            // },
            {
              label: 'GitHub',
              href: 'https://github.com/jesscss/jess'
            }
          ]
        }
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Jess. Built with Docusaurus.`
    }
  },
  presets: [
    [
      'classic',
      {
        docs: {
          /** @todo - figure out path lowercasing later */
          // async sidebarItemsGenerator({defaultSidebarItemsGenerator, ...args}: any) {
          //   const sidebarItems = await defaultSidebarItemsGenerator(args);
          //   return sidebarItems.map((item: any) => {
          //     console.log(item);
          //     if (item.type === 'category') {
          //       return {
          //         ...item,
          //         label: item.label.toLowerCase()
          //       };
          //     }
          //     return item;
          //   })
          // },
          sidebarPath: './sidebars.js',
          includeCurrentVersion: true,
          lastVersion: 'current',
          versions: {
            current: {
              label: 'Next',
              path: ''
            }
          },
          // Please change this to your repo.
          editUrl:
            'https://github.com/jesscss/jess/tree/master/packages/docs/'
        },
        blog: {
          showReadingTime: true,
          // Please change this to your repo.
          editUrl:
            'https://github.com/jesscss/jess/tree/master/packages/docs/'
        },
        theme: {
          customCss: ['./src/css/custom.css']
        }
      }
    ]
  ]
} satisfies Config;