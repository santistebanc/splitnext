import type { ReactNode } from 'react';
import { Modal } from 'react-native';

export function ScreenModal(props: { onRequestClose: () => void; children: ReactNode }) {
  return <Modal transparent animationType="fade" visible onRequestClose={props.onRequestClose}>{props.children}</Modal>;
}
