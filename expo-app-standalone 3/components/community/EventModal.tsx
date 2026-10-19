import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { KeyboardAvoidingView as KeyboardControllerAvoidingView } from 'react-native-keyboard-controller';
import { useColors } from '@/hooks/useColors';

/**
 * The shell the event's RSVP dialogs are built on — the mobile shape of the
 * web `Modal` plus its `modal-btn` footer: a title with a close mark, the
 * copy, and a hairline footer of right-aligned actions.
 *
 * `dismissable` is the web's rule that a dialog mid-request does not dismiss:
 * the backdrop, the close mark and the Cancel button all stop answering while
 * the request is in flight, so the answer the member is waiting for is the one
 * they see.
 *
 * The body scrolls and the panel is height-capped: with the keyboard up on a
 * short screen the last field has to stay reachable, not get clipped off the
 * top of a centred panel.
 */
export function EventModal({
  title,
  onClose,
  dismissable = true,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  dismissable?: boolean;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const colors = useColors();
  const dismiss = dismissable ? onClose : () => undefined;

  const panel = (
    <Pressable style={styles.backdrop} onPress={dismiss}>
      <Pressable
        style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={(e) => e.stopPropagation()}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <Pressable
            onPress={dismiss}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.bodyScroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.border }]}>{footer}</View>
      </Pressable>
    </Pressable>
  );

  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      {Platform.OS === 'android' ? (
        // A `Modal` is its own window, and on a modern Android that window no
        // longer resizes for the keyboard — the chat screens already go through
        // the keyboard controller for exactly this reason, and a dialog with
        // two text fields has to as well.
        <KeyboardControllerAvoidingView style={styles.flex} behavior="height">
          {panel}
        </KeyboardControllerAvoidingView>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          {panel}
        </KeyboardAvoidingView>
      )}
    </Modal>
  );
}

/** The web's `modal-btn-secondary`: a hairline outline that only dismisses. */
export function DialogSecondaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        {
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text style={[styles.secondaryLabel, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The web's `modal-btn-primary` + `PendingButton`: the one action that sends,
 * switched to a spinner and its `-ing` label while the request is in flight.
 */
export function DialogPrimaryButton({
  label,
  pendingLabel,
  icon,
  onPress,
  pending = false,
  disabled = false,
}: {
  label: string;
  pendingLabel: string;
  icon?: React.ReactNode;
  onPress: () => void;
  pending?: boolean;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => { if (!pending && !disabled) onPress(); }}
      disabled={pending || disabled}
      accessibilityRole="button"
      accessibilityLabel={pending ? pendingLabel : label}
      accessibilityState={{ disabled: pending || disabled, busy: pending }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: colors.primary,
          opacity: disabled && !pending ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {pending ? (
        <ActivityIndicator size="small" color={colors.primaryForeground} />
      ) : (
        icon
      )}
      <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>
        {pending ? pendingLabel : label}
      </Text>
    </Pressable>
  );
}

/** The web's `ModalError` box, in the destructive token. */
export function DialogError({ message }: { message: string }) {
  const colors = useColors();
  return (
    <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
      <Text style={[styles.errorText, { color: colors.destructive }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 16,
  },
  panel: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '86%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  title: { flex: 1, fontSize: 16, fontFamily: 'Geist_600SemiBold' },
  body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 },
  bodyScroll: { flexGrow: 0, flexShrink: 1 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryLabel: { fontSize: 13.5, fontFamily: 'Geist_500Medium' },
  primaryLabel: { fontSize: 13.5, fontFamily: 'Geist_600SemiBold' },
  errorBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 16,
  },
  errorText: { fontSize: 12.5, fontFamily: 'Geist_400Regular', lineHeight: 18 },
});
