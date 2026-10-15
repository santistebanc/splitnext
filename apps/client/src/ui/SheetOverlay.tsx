import type { ReactNode } from 'react';
import { Modal } from 'react-native';

export type SheetOverlayProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
};

/** The layer sheets open in; native uses Modal, the web SheetOverlay.web.tsx. */
export function SheetOverlay(props: SheetOverlayProps) {
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
    >
      {props.children}
    </Modal>
  );
}
