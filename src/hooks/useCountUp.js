import { useEffect, useRef, useState } from 'react';

// Animates a number from `from` → `to` over `duration`ms. Respects
// prefers-reduced-motion (jumps straight to `to`).
export function useCountUp(to, { from = 0, duration = 900 } = {}) {
  const [val, setVal] = useState(from);
  const raf = useRef(null);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setVal(to);
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (to - from) * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [to, from, duration]);
  return val;
}
