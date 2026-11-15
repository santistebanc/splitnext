import type { RefObject } from 'react';
import { useInPlaceEdit } from './inPlaceEdit';

export type EditCoverProps = {
  open: boolean;
  /** The field being edited, which stays uncovered. */
  target: RefObject<unknown>;
  /** A tap on the cover, which ends the edit. */
  onPress: () => void;
};

/** Native leaves the field's own blur to end the edit; the pinned main action still steps aside. */
export function EditCover(props: EditCoverProps) {
  useInPlaceEdit(props.open);

  return null;
}
