/** Gerät mit Touch als Hauptbedienung (iPad, Tablet) */
export const isTouchDevice = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 1);
