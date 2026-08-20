import { useEffect } from "react";

/**
 * Pointer-reactive polish, mounted once by the shell.
 *
 * Publishes the cursor position as CSS custom properties so effects can be
 * written in CSS rather than re-rendering React on every mouse move:
 *
 *   --cursor-x / --cursor-y  on <html>, for a page-level glow
 *   --mx / --my              on the hovered `.spotlight` element, as a
 *                            percentage of its own box
 *
 * Updates are coalesced into one animation frame, and the whole thing is
 * skipped for coarse pointers and for anyone who asked for reduced motion —
 * a touch device has no cursor to follow.
 */
export function PointerFX() {
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || still) return;

    const root = document.documentElement;
    let frame = 0;
    let lastX = 0;
    let lastY = 0;

    const paint = () => {
      frame = 0;
      root.style.setProperty("--cursor-x", `${lastX}px`);
      root.style.setProperty("--cursor-y", `${lastY}px`);

      // Only the element under the cursor needs its local coordinates.
      const el = document.elementFromPoint(lastX, lastY)?.closest<HTMLElement>(".spotlight");
      if (el) {
        const rect = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${((lastX - rect.left) / rect.width) * 100}%`);
        el.style.setProperty("--my", `${((lastY - rect.top) / rect.height) * 100}%`);
      }
    };

    const onMove = (event: PointerEvent) => {
      lastX = event.clientX;
      lastY = event.clientY;
      if (!frame) frame = window.requestAnimationFrame(paint);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
