import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './styles.module.css';

export default function Home(): React.JSX.Element {
  const tickerItems = useMemo(
    () => ['Less', 'Sass', 'Styled Components', 'CSS Modules', 'PostCSS'],
    []
  );
  const [tickerIndex, setTickerIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [frameWidth, setFrameWidth] = useState<number | null>(null);
  const [tickerWidths, setTickerWidths] = useState<number[]>([]);
  const tickerMeasureRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const tickerIndexRef = useRef(0);

  const measureTickerWidths = useCallback(() => {
    const nextWidths = tickerItems.map((_, index) => {
      const width = tickerMeasureRefs.current[index]?.getBoundingClientRect().width ?? 0;
      // Keep a small safety buffer for subpixel/font rendering differences.
      return Math.ceil(width) + 4;
    });

    if (nextWidths.every(width => width > 0)) {
      setTickerWidths(nextWidths);
      setFrameWidth(nextWidths[tickerIndexRef.current]);
    }
  }, [tickerItems]);

  useLayoutEffect(() => {
    measureTickerWidths();
  }, [measureTickerWidths]);

  useEffect(() => {
    tickerIndexRef.current = tickerIndex;
  }, [tickerIndex]);

  useEffect(() => {
    const onResize = () => measureTickerWidths();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureTickerWidths]);

  useEffect(() => {
    // Re-measure after webfonts load, otherwise first pass can clip wider labels.
    void document.fonts.ready.then(() => {
      measureTickerWidths();
    });
  }, [measureTickerWidths]);

  useEffect(() => {
    if (tickerWidths.length !== tickerItems.length) {
      return undefined;
    }

    let preSwapTimer: number | null = null;
    let swapTimer: number | null = null;

    const rotateTimer = window.setInterval(() => {
      const nextIndex = (tickerIndexRef.current + 1) % tickerItems.length;
      const nextWidth = tickerWidths[nextIndex];

      if (nextWidth > 0) {
        setFrameWidth(nextWidth);
      }

      preSwapTimer = window.setTimeout(() => {
        setIsAnimating(true);
        swapTimer = window.setTimeout(() => {
          setTickerIndex(nextIndex);
          setIsAnimating(false);
        }, 220);
      }, 190);
    }, 2300);

    return () => {
      window.clearInterval(rotateTimer);
      if (preSwapTimer !== null) {
        window.clearTimeout(preSwapTimer);
      }
      if (swapTimer !== null) {
        window.clearTimeout(swapTimer);
      }
    };
  }, [tickerItems.length, tickerWidths]);

  return (
    <Layout>
      <main>
        <section className={styles.heroBanner}>
          <div className="container">
            <img className={styles.heroLogo} src="/img/logo.svg" alt="Jess logo" />
            <h1>Jess Documentation</h1>
            <p className={styles.successorLine}>
              The spiritual successor to
              {' '}
              <span
                className={styles.tickerFrame}
                aria-live="polite"
                aria-atomic="true"
                style={frameWidth ? { width: `${frameWidth}px` } : undefined}
              >
                <span className={`${styles.tickerWord} ${isAnimating ? styles.tickerWordExit : styles.tickerWordEnter}`}>
                  {tickerItems[tickerIndex]}
                </span>
              </span>
            </p>
            <span className={styles.tickerMeasureRack} aria-hidden="true">
              {tickerItems.map((item, index) => (
                <span
                  key={item}
                  ref={(element) => {
                    tickerMeasureRefs.current[index] = element;
                  }}
                  className={styles.tickerMeasureWord}
                >
                  {item}
                </span>
              ))}
            </span>
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
              <article className={`${styles.card} ${styles.cardCore}`}>
                <h2>Core Concepts</h2>
                <p>Learn Jess language features, compiler behavior, and compatibility goals.</p>
                <Link className={styles.cardCta} to="/docs/Language/overview">
                  Read language overview
                </Link>
              </article>
              <article className={`${styles.card} ${styles.cardTooling}`}>
                <h2>Tooling</h2>
                <p>Use package workflows and docs tooling for productive day-to-day work.</p>
                <Link className={styles.cardCta} to="/docs/getting-started/config">
                  Open tooling setup
                </Link>
              </article>
              <article className={`${styles.card} ${styles.cardRefs}`}>
                <h2>References</h2>
                <p>Find migration notes, APIs, and practical references for implementation details.</p>
                <Link className={styles.cardCta} to="/docs/Functions/about">
                  Browse references
                </Link>
              </article>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
