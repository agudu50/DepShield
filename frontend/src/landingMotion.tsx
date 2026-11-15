import { useEffect, type RefObject } from 'react'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Elements that rise in as they scroll into view, staggered among siblings. */
const REVEAL_SELECTOR = [
  '.hb-section-head',
  '.hb-feature-copy',
  '.sw-section-head',
  '.ss-gallery-card',
  '.sw-workflow-tabs',
  '.sw-step',
  '.sw-guardrail',
  '.sw-console',
  '.hb-cta-copy',
  '.sw-footer-top',
  '.sw-footer-bottom',
].join(',')

/**
 * Tags matching elements with .ss-reveal and adds .is-in once each is visible.
 * Elements that mount later (e.g. switching tabs) are simply shown, never hidden.
 */
export function useScrollReveal(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root || prefersReducedMotion() || !('IntersectionObserver' in window)) return

    const els = Array.from(root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR))
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in')
            observer.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    )

    for (const el of els) {
      const siblings = el.parentElement ? Array.from(el.parentElement.children) : [el]
      const index = Math.max(0, siblings.indexOf(el))
      el.style.setProperty('--reveal-delay', `${Math.min(index, 6) * 70}ms`)
      el.classList.add('ss-reveal')
      observer.observe(el)
    }
    return () => {
      observer.disconnect()
      for (const el of els) el.classList.remove('ss-reveal', 'is-in')
    }
  }, [rootRef])
}
