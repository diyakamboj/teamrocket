import { useEffect, useRef } from "react";

/**
 * Reveal elements as they scroll into view.
 *
 * Returns a ref for a container; every descendant marked `.reveal` fades and
 * rises once, the first time it appears. Implemented with an
 * IntersectionObserver rather than scroll listeners so it costs nothing on
 * the main thread while scrolling, and elements are unobserved after they
 * appear so nothing keeps firing.
 *
 * Respecting reduced-motion is handled in CSS (the `.reveal` rules), so this
 * hook stays purely about *when* something becomes visible.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const targets = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    if (targets.length === 0) return;

    // Without IntersectionObserver (or in a non-browser render), show
    // everything rather than leaving the page blank.
    if (typeof IntersectionObserver === "undefined") {
      targets.forEach((el) => el.setAttribute("data-visible", "true"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.setAttribute("data-visible", "true");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return containerRef;
}
