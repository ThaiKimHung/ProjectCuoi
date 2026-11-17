import { useEffect, useRef } from 'react';

// Lets the browser / mouse "Back" button close an open viewer (lightbox,
// compare…) instead of leaving the app. Each open layer adds one history
// entry; Back closes the topmost layer. Closing a layer from the UI removes
// its entry again so the history stays balanced.

const layers = [];
let ignoredPops = 0;

function handlePopState() {
  if (ignoredPops > 0) {
    ignoredPops -= 1;
    return;
  }
  const top = layers.pop();
  if (top) top.close();
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', handlePopState);
}

export function useBackToClose(isOpen, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;
    const layer = { close: () => closeRef.current?.() };
    layers.push(layer);
    window.history.pushState({ ...(window.history.state || {}), wpcLayer: layers.length }, '');

    return () => {
      const index = layers.indexOf(layer);
      if (index < 0) return; // already closed by the Back button
      layers.splice(index, 1);
      ignoredPops += 1;
      window.history.back();
    };
  }, [isOpen]);
}
