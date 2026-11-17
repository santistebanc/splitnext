import { useWindowDimensions } from 'react-native';

export function useCompactLayout(): boolean { return useWindowDimensions().width < 600; }

export function useTouchInput(): boolean { return true; }

// Native resizes or avoids the keyboard at the root, rather than using a DOM viewport.
export function useVisibleViewportHeight(_enabled: boolean): number | null { return null; }
