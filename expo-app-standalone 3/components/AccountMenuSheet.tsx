import React from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccountMenuContent } from '@/components/AccountMenuContent';
import { useColors } from '@/hooks/useColors';

/**
 * The avatar menu as a bottom sheet — the touch version of the web topbar's
 * profile dropdown, opened from the avatar in the header on Home, Communities
 * and Jobs.
 *
 * The rows themselves live in AccountMenuContent, shared with the Profile
 * header's side menu, so Settings and Sign out behave identically there.
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AccountMenuSheet({ open, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent animationType="fade" visible={open} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <AccountMenuContent onNavigate={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
});
