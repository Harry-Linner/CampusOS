import { useEffect, useState } from "react";

/** Refresh time-based calendar states even when no network data changes. */
export function useCalendarClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = (): void => setNow(Date.now());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  return now;
}
