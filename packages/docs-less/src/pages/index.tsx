import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './styles.module.css';

export default function Home(): React.JSX.Element {
  return (
    <Layout title="Less Docs">
      <header className={styles.hero}>
        <div className="container">
          <div className={styles.heroBrand}>
            <img className={styles.logo} src="/img/less_logo.png" alt="Less logo" />
            <h1>It&apos;s CSS, with just a little more.</h1>
            <p className={styles.tagline}>
              Official Less docs, with stable 4.x references and a 5.x alpha track.
            </p>
          </div>
          <div className={styles.quickstart}>
            <p>Use with Node.js:</p>
            <code>npx --yes --package less lessc styles.less styles.css</code>
            <code>pnpm --package=less dlx lessc styles.less styles.css</code>
          </div>
        </div>
      </header>
      <main className={styles.main}>
        <div className="container">
          <section className={styles.grid}>
            <article className={styles.card}>
              <h2>Get Started</h2>
              <p>Install Less, compile your first styles, and choose browser or CLI workflows.</p>
              <Link to="/docs/home/getting-started">Open Getting Started</Link>
            </article>
            <article className={styles.card}>
              <h2>Language and Features</h2>
              <p>Learn variables, mixins, imports, nesting, maps, and other core language features.</p>
              <Link to="/docs/features-overview">Open Language Guide</Link>
            </article>
            <article className={styles.card}>
              <h2>Functions Reference</h2>
              <p>Browse all Less function families with examples and usage notes.</p>
              <Link to="/docs/functions/math-functions">Open Functions</Link>
            </article>
            <article className={styles.card}>
              <h2>Usage and Tooling</h2>
              <p>Build with Node.js, then integrate outputs (including browser update scripts) into your tooling pipeline.</p>
              <Link to="/docs/usage/using-less">Open Usage Docs</Link>
            </article>
          </section>
          <section className={styles.actionsLowKey}>
            <Link className={`button button--sm ${styles.ctaPrimary}`} to="/docs/home">
              Read 4.x Docs
            </Link>
            <Link className={`button button--sm ${styles.ctaSecondary}`} to="/docs/next/home">
              Explore 5.x Alpha
            </Link>
          </section>
        </div>
      </main>
    </Layout>
  );
}
