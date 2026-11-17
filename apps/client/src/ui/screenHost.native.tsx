import { createContext } from 'react';
import { Keyboard, TextInput, useWindowDimensions } from 'react-native';
import type { ScreenHost } from './screenHost';

export const ScreenHostContext = createContext<ScreenHost | null>(null);

export function useScreenHost(): ScreenHost | null { return null; }

export const useScreenSize = useWindowDimensions;

export function useHomepage(): boolean { return false; }

export function useFieldFocused(): () => boolean { return () => Boolean(TextInput.State.currentlyFocusedInput()); }

export function useDismissKeyboard(): () => void { return Keyboard.dismiss; }
