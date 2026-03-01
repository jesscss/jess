import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './styles.module.css';

export default function Home(): React.JSX.Element {
  return (
    <Layout title="Jess Docs">
      <main>
        <section className={styles.heroBanner}>
          <div className="container">
            <h1>Jess Documentation</h1>
            <p className={styles.tagline}>
              Language and feature docs for Jess and related stylesheet dialects.
            </p>
            <div className={styles.buttons}>
              <Link className="button button--primary button--lg" to="/docs/">
                Explore Docs
              </Link>
            </div>
          </div>
        </section>
        <section className={styles.features}>
          <div className="container">
            <div className={styles.grid}>
              <article className={styles.card}>
                <h2>Core Concepts</h2>
                <p>Learn Jess language features, compiler behavior, and compatibility goals.</p>
              </article>
              <article className={styles.card}>
                <h2>Tooling</h2>
                <p>Use package workflows and docs tooling for productive day-to-day work.</p>
              </article>
              <article className={styles.card}>
                <h2>References</h2>
                <p>Find migration notes, APIs, and practical references for implementation details.</p>
              </article>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
