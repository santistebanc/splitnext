import { createContext, useContext } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';
import { usePathname } from 'expo-router';

/**
 * Where a screen lives when it does not own the browser window, such as a lab
 * device among others in one document. The ordinary app has no host and reads
 * the window, document and router directly; a hosted screen keeps to its box.
 */
export type ScreenHost = {
  /** The device's box: positioned, clipped, and the scope of its events. */
  frame: HTMLElement;
  /** A layer over the whole box, for what the window would otherwise show on top. */
  overlay: HTMLElement;
  size: { width: number; height: number };
  readClipboard(): Promise<string>;
};

export const ScreenHostContext = createContext<ScreenHost | null>(null);

export function useScreenHost(): ScreenHost | null {
  return useContext(ScreenHostContext);
}

/** The size layouts respond to: the device's box, or the window. */
export function useScreenSize(): { width: number; height: number } {
  const window = useWindowDimensions();

  return useScreenHost()?.size ?? window;
}

/** Public pages in the homepage's wide frame rather than the app's column. */
const publicPages = new Set(['/', '/privacy', '/terms']);

/** Whether a public page is showing; a hosted screen has no routes. */
export function useHomepage(): boolean {
  const hosted = useScreenHost() !== null;

  // A screen is hosted or not for its whole life, so the hook order never changes.
  return hosted ? false : publicPages.has(usePathname());
}

/** Whether a field of this screen has the keyboard, not one of another device. */
export function useFieldFocused(): () => boolean {
  const host = useScreenHost();

  return () => {
    const focused = document.activeElement;

    return focused instanceof HTMLInputElement && (!host || host.frame.contains(focused));
  };
}

/** Puts the keyboard away from this screen only. */
export function useDismissKeyboard(): () => void {
  const host = useScreenHost();

  return () => {
    const focused = document.activeElement;

    if (!host) Keyboard.dismiss();
    else if (focused instanceof HTMLElement && host.frame.contains(focused)) focused.blur();
  };
}
