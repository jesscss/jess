
import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';
export default [
{
  path: '/',
  component: ComponentCreator('/','deb'),
  exact: true,
},
{
  path: '/blog',
  component: ComponentCreator('/blog','11e'),
  exact: true,
},
{
  path: '/blog/hello-world',
  component: ComponentCreator('/blog/hello-world','5bc'),
  exact: true,
},
{
  path: '/blog/hola',
  component: ComponentCreator('/blog/hola','dc2'),
  exact: true,
},
{
  path: '/blog/tags',
  component: ComponentCreator('/blog/tags','6d3'),
  exact: true,
},
{
  path: '/blog/tags/docusaurus',
  component: ComponentCreator('/blog/tags/docusaurus','a2e'),
  exact: true,
},
{
  path: '/blog/tags/facebook',
  component: ComponentCreator('/blog/tags/facebook','a04'),
  exact: true,
},
{
  path: '/blog/tags/hello',
  component: ComponentCreator('/blog/tags/hello','e94'),
  exact: true,
},
{
  path: '/blog/tags/hola',
  component: ComponentCreator('/blog/tags/hola','6fd'),
  exact: true,
},
{
  path: '/blog/welcome',
  component: ComponentCreator('/blog/welcome','c9c'),
  exact: true,
},
{
  path: '/docs',
  component: ComponentCreator('/docs','9f3'),
  
  routes: [
{
  path: '/docs/',
  component: ComponentCreator('/docs/','6d6'),
  exact: true,
},
{
  path: '/docs/install',
  component: ComponentCreator('/docs/install','7fe'),
  exact: true,
},
{
  path: '/docs/js',
  component: ComponentCreator('/docs/js','7fd'),
  exact: true,
},
{
  path: '/docs/migrating',
  component: ComponentCreator('/docs/migrating','57a'),
  exact: true,
},
{
  path: '/docs/mixins',
  component: ComponentCreator('/docs/mixins','f31'),
  exact: true,
},
{
  path: '/docs/style',
  component: ComponentCreator('/docs/style','dbe'),
  exact: true,
},
{
  path: '/docs/variables',
  component: ComponentCreator('/docs/variables','6c8'),
  exact: true,
},
]
},
{
  path: '*',
  component: ComponentCreator('*')
}
];
