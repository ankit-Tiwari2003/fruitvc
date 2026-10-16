import { useEffect, useState } from "react";

/** True once `waiting` has stayed true for `ms`; resets as soon as it turns false. */
export function useStalled(waiting: boolean, ms = 15_000): boolean {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), ms);
    return () => clearTimeout(timer);
  }, [waiting, ms]);
  return stalled;
}
