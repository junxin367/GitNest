import { useLayoutEffect, useRef, useState } from "react";

const LOADING_INDICATOR_MINIMUM_MS = 500;

interface MinimumLoadingIndicatorOptions {
  minimumVisibleMs?: number;
}

export function useMinimumLoadingIndicator(
  loading: boolean,
  {
    minimumVisibleMs = LOADING_INDICATOR_MINIMUM_MS
  }: MinimumLoadingIndicatorOptions = {}
) {
  const [visible, setVisible] = useState(loading);
  const visibleRef = useRef(loading);
  const visibleSinceRef = useRef<number | null>(
    loading ? Date.now() : null
  );
  const hideTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    clearTimer(hideTimerRef);

    if (loading) {
      if (!visibleRef.current) {
        visibleRef.current = true;
        visibleSinceRef.current = Date.now();
        setVisible(true);
      }
    } else if (visibleRef.current) {
      const visibleSince = visibleSinceRef.current ?? Date.now();
      const remaining = Math.max(
        0,
        minimumVisibleMs - (Date.now() - visibleSince)
      );
      const hide = () => {
        hideTimerRef.current = null;
        visibleRef.current = false;
        visibleSinceRef.current = null;
        setVisible(false);
      };

      if (remaining === 0) {
        hide();
      } else {
        hideTimerRef.current = window.setTimeout(
          hide,
          remaining
        );
      }
    }

    return () => {
      clearTimer(hideTimerRef);
    };
  }, [loading, minimumVisibleMs]);

  return loading || visible;
}

function clearTimer(timerRef: {
  current: number | null;
}) {
  if (timerRef.current === null) {
    return;
  }
  window.clearTimeout(timerRef.current);
  timerRef.current = null;
}
