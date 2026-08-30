export default {
  docs: [
    {
      type: 'doc',
      id: 'overview',
      label: 'Overview'
    },
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'home/getting-started',
        'home/download-options',
        'home/cdn-options'
      ]
    },
    {
      type: 'category',
      label: 'Upgrade to Less 5',
      items: [
        {
          type: 'doc',
          id: 'usage/migrating-to-v5',
          label: 'Migration walkthrough'
        },
        {
          type: 'doc',
          id: 'usage/less-v5-breaking-changes',
          label: 'Breaking changes'
        }
      ]
    },
    {
      type: 'category',
      label: 'Language',
      items: [
        {
          type: 'doc',
          id: 'features-overview',
          label: 'Language tour'
        },
        {
          type: 'category',
          label: 'Core language',
          items: [
            'features/variables',
            'features/nested',
            'features/parent-selectors',
            'features/comments',
            'features/strictmath'
          ]
        },
        {
          type: 'category',
          label: 'Reuse and composition',
          items: [
            'features/mixins',
            'features/selector-capture',
            'features/imports',
            'features/modules-and-imports',
            'features/maps',
            'features/extend',
            'features/merge'
          ]
        },
        {
          type: 'category',
          label: 'Advanced language',
          items: [
            'features/scope',
            'features/css-guards',
            'features/detached-rulesets',
            'features/plugins'
          ]
        }
      ]
    },
    {
      type: 'category',
      label: 'Functions',
      items: [
        'functions/math-functions',
        'functions/logical-functions',
        'functions/string-functions',
        'functions/list-functions',
        'functions/type-functions',
        'functions/misc-functions',
        'functions/color-definition',
        'functions/color-channel',
        'functions/color-operations',
        'functions/color-blending',
        'functions/examples/examples'
      ]
    },
    {
      type: 'category',
      label: 'Less 5 Advanced',
      items: [
        'advanced/overview',
        'advanced/output-model',
        'advanced/selector-compaction',
        'advanced/extend-is-wrapping',
        'advanced/extend-semantics',
        'advanced/merge-anchoring',
        'advanced/verbatim-values',
        'advanced/value-formatting',
        'advanced/number-precision',
        'advanced/color-output',
        'advanced/string-format',
        'advanced/inline-javascript',
        'advanced/output-and-eval-cheatsheet'
      ]
    },
    {
      type: 'category',
      label: 'Build and Tooling',
      items: [
        'usage/using-less',
        'usage/command-line-usage',
        'usage/programmatic-usage',
        'usage/api',
        'usage/using-less-in-the-browser',
        'usage/browser-support',
        'usage/less-options',
        'usage/sourcemaps',
        'usage/plugins',
        'usage/tooling',
        'usage/advanced-reference'
      ]
    },
    {
      type: 'category',
      label: 'Ecosystem and Project',
      items: [
        'tools/editors-and-plugins',
        'tools/guis-for-less',
        'tools/online-less-compilers',
        'tools/plugins',
        'tools/third-party-compilers',
        'tools/frameworks-using-less',
        'tools/ports',
        'examples/example',
        'examples/data-URI',
        'usage/developing-less',
        'about/history',
        'about/learn-more'
      ]
    }
  ]
};
