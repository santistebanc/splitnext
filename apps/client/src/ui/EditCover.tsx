import type { RefObject } from 'react';

export type EditCoverProps = {
  open: boolean;
  /** The field being edited, which stays uncovered. */
  target: RefObject<unknown>;
  /** A tap on the cover, which ends the edit. */
  onPress: () => void;
};

/** Native leaves the field's own blur to end the edit; the web dims around it. */
export function EditCover(_props: EditCoverProps) {
  return null;
}
