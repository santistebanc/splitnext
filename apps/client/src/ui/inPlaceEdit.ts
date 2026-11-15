import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';

/**
 * Whether a field is being edited in place on this screen, such as a name or
 * the join link. While one is, the screen's pinned main action steps aside:
 * the keyboard or the field's own action finishes the edit. One store per app
 * screen, so lab devices sharing a document keep their own.
 */
export type InPlaceEditStore = {
  open: () => () => void;
  subscribe: (listener: () => void) => () => void;
  editing: () => boolean;
};

export function createInPlaceEditStore(): InPlaceEditStore {
  let count = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  return {
    open() {
      count += 1;
      emit();
      let closed = false;

      return () => {
        if (closed) return;
        closed = true;
        count -= 1;
        emit();
      };
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    editing: () => count > 0,
  };
}

export const InPlaceEditContext = createContext<InPlaceEditStore | null>(null);

/** Marks an in-place edit as open for as long as `open` holds. */
export function useInPlaceEdit(open: boolean): void {
  const store = useContext(InPlaceEditContext);

  useEffect(() => (open && store ? store.open() : undefined), [open, store]);
}

/** Whether any in-place edit is open on this screen. */
export function useEditingInPlace(store: InPlaceEditStore): boolean {
  return useSyncExternalStore(store.subscribe, store.editing, () => false);
}
