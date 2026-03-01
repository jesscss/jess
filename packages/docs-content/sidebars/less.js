export default {
  docs: [
    {
      type: 'doc',
      id: 'Home',
      label: 'Overview'
    },
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'home/getting-started',
        'home/download-options',
        'about/history',
        'about/learn-more'
      ]
    },
    {
      type: 'doc',
      id: 'usage/migrating-to-v5',
      label: 'Migrating to v5'
    },
    {
      type: 'category',
      label: 'Language and Features',
      items: [
        'features-overview',
        'features/variables',
        'features/mixins',
        'features/nested',
        'features/parent-selectors',
        'features/imports',
        'features/extend',
        'features/maps',
        'features/merge',
        'features/scope',
        'features/comments',
        'features/css-guards',
        'features/detached-rulesets',
        'features/plugins',
        'features/strictmath'
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
      label: 'Usage and Tooling',
      items: [
        'usage/using-less',
        'usage/using-less-in-the-browser',
        'usage/less-options',
        'usage/tooling',
        'usage/advanced-reference'
      ]
    }
  ]
};
