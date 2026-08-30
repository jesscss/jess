import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './styles.module.css';

export default function Home(): React.JSX.Element {
  return (
    <Layout
      title="Less documentation"
      description="Official Less language and Less.js documentation for the stable 4.x release and the 5.x track."
    >
      <header className={styles.hero}>
        <div className="container">
          <div className={styles.heroBrand}>
            <img className={styles.logo} src="/img/less_logo.png" alt="Less logo" />
            <h1>It&apos;s CSS, with just a little more.</h1>
            <p className={styles.tagline}>
              The official language and compiler documentation, from your first
              stylesheet to the Less 5.x upgrade.
            </p>
          </div>
          <div className={styles.quickstart}>
            <p><strong>Compile with stable Less 4.x</strong></p>
            <code>npm install --save-dev less</code>
            <code>npx lessc styles.less styles.css</code>
          </div>
          <div className={styles.heroActions}>
            <Link className="button button--primary button--lg" to="/docs/home/getting-started">
              Get started
            </Link>
            <Link className="button button--secondary button--lg" to="/docs/next/usage/migrating-to-v5">
              Upgrade to Less 5
            </Link>
          </div>
        </div>
      </header>
      <main className={styles.main}>
        <div className="container">
          <section aria-labelledby="choose-your-path">
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>Choose your path</p>
              <h2 id="choose-your-path">Start with the job you need to do</h2>
              <p>Stable Less 4.x remains the default. The 5.x documentation is a separate track with an explicit migration guide.</p>
            </div>
            <div className={styles.grid}>
              <article className={styles.card}>
                <p className={styles.cardKicker}>New to Less</p>
                <h3>Compile your first file</h3>
                <p>Install Less locally, learn the CLI, and turn a small Less stylesheet into CSS.</p>
                <Link to="/docs/home/getting-started">Open Getting Started</Link>
              </article>
              <article className={styles.card}>
                <p className={styles.cardKicker}>Existing project</p>
                <h3>Build and integrate</h3>
                <p>Use the command line, JavaScript API, sourcemaps, browser workflow, and build tools.</p>
                <Link to="/docs/usage/using-less">Open Build and Tooling</Link>
              </article>
              <article className={styles.card}>
                <p className={styles.cardKicker}>Planning an upgrade</p>
                <h3>Move from Less 4.x to 5.x</h3>
                <p>Review removed syntax, changed defaults, and a practical rollout checklist.</p>
                <Link to="/docs/next/usage/migrating-to-v5">Open the Migration Guide</Link>
              </article>
            </div>
          </section>

          <section className={styles.referenceSection} aria-labelledby="browse-reference">
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>Reference</p>
              <h2 id="browse-reference">Look up the language</h2>
            </div>
            <div className={styles.referenceGrid}>
              <article className={styles.referenceCard}>
                <h3>Language</h3>
                <p>Variables, mixins, nesting, imports, maps, extend, and scope.</p>
                <Link to="/docs/features-overview">Browse Language</Link>
              </article>
              <article className={styles.referenceCard}>
                <h3>Functions</h3>
                <p>Math, color, list, string, type, and logical function families.</p>
                <Link to="/docs/functions/math-functions">Browse Functions</Link>
              </article>
              <article className={styles.referenceCard}>
                <h3>API and options</h3>
                <p>Command-line flags, programmatic usage, compiler options, and plugins.</p>
                <Link to="/docs/usage/programmatic-usage">Browse the API</Link>
              </article>
              <article className={styles.referenceCard}>
                <h3>Ecosystem</h3>
                <p>Editors, GUIs, online compilers, integrations, frameworks, and ports.</p>
                <Link to="/docs/tools/editors-and-plugins">Browse the Ecosystem</Link>
              </article>
            </div>
          </section>

          <section className={styles.trackPanel} aria-labelledby="documentation-tracks">
            <div>
              <p className={styles.cardKicker}>Production default</p>
              <h2 id="documentation-tracks">Less 4.x</h2>
              <p>Use the stable reference for today&apos;s npm release and production workflows.</p>
              <Link to="/docs/home">Read stable documentation</Link>
            </div>
            <div>
              <p className={styles.cardKicker}>Next release</p>
              <h2>Less 5.x</h2>
              <p>Explore the Jess-powered compiler track and prepare existing code for its breaking changes.</p>
              <Link to="/docs/next/">Explore Less 5 documentation</Link>
            </div>
          </section>
        </div>
      </main>
    </Layout>
  );
}
