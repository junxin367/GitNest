import { useCallback, useEffect, useState } from "react";

export function useWindowMaximized() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    const unsubscribe =
      window.gitnest.window.onMaximizedChanged((maximized) => {
        if (active) {
          setIsMaximized(maximized);
        }
      });

    void window.gitnest.window
      .isMaximized()
      .then((maximized) => {
        if (active) {
          setIsMaximized(maximized);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const toggleMaximize = useCallback(() => {
    void window.gitnest.window
      .toggleMaximize()
      .then(setIsMaximized)
      .catch(() => undefined);
  }, []);

  return {
    isMaximized,
    toggleMaximize
  };
}
