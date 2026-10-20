import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import {
  MODERATOR_DEFAULT_PERMISSIONS,
  MODERATOR_PERMISSION_OPTIONS,
  type CommunityPermission,
  type CommunityPermissionGroup,
  type CommunityPermissions,
} from '@/lib/communityPermissions';

/**
 * The owner's picker for what a moderator may do — the mobile port of the web
 * ModeratorPermissionsModal. Used both when promoting a member (starts from
 * the moderator defaults) and when editing an existing moderator (starts from
 * their current grants). The parent performs the PATCH so a failed save can
 * surface here without losing the toggles.
 */

const GROUP_ORDER: CommunityPermissionGroup[] = ['Content moderation', 'Administration'];

interface Props {
  visible: boolean;
  member: { user_id: string; name: string } | null;
  mode: 'promote' | 'edit';
  initialPermissions?: CommunityPermissions;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (permissions: CommunityPermissions) => void;
}

export function ModeratorPermissionsModal({
  visible,
  member,
  mode,
  initialPermissions,
  saving,
  error,
  onClose,
  onSave,
}: Props) {
  const colors = useColors();
  const [permissions, setPermissions] = useState<CommunityPermissions>(() => ({
    ...(mode === 'edit' && initialPermissions
      ? initialPermissions
      : MODERATOR_DEFAULT_PERMISSIONS),
  }));

  // Each opening starts fresh: the promote flow from defaults, the edit flow
  // from the moderator's current grants.
  useEffect(() => {
    if (!visible) return;
    setPermissions({
      ...(mode === 'edit' && initialPermissions
        ? initialPermissions
        : MODERATOR_DEFAULT_PERMISSIONS),
    });
  }, [visible, mode, initialPermissions]);

  // In edit mode an unchanged set saves nothing, so the button rests disabled.
  const dirty = useMemo(() => {
    if (mode !== 'edit' || !initialPermissions) return true;
    return (Object.keys(permissions) as CommunityPermission[]).some(
      (key) => permissions[key] !== initialPermissions[key]
    );
  }, [permissions, initialPermissions, mode]);

  const firstName = member?.name.split(' ')[0] ?? 'This member';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={saving ? undefined : onClose}>
      <View style={styles.backdrop}>
        <View
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <Text style={[styles.title, { color: colors.foreground }]}>
              {mode === 'promote' ? `Make ${firstName} a moderator` : 'Moderator permissions'}
            </Text>
            <Text style={[styles.intro, { color: colors.mutedForeground }]}>
              {mode === 'promote'
                ? `Moderators help you run the community. Content moderation starts on and administration off — adjust anything before you promote. You can change this later from ${firstName}'s menu.`
                : `Choose what ${firstName} can do in this community. Owners always keep full control.`}
            </Text>

            {error ? (
              <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
            ) : null}

            {GROUP_ORDER.map((group) => (
              <View key={group} style={styles.group}>
                <View style={styles.groupTitleRow}>
                  {group === 'Content moderation' ? (
                    <Feather
                      name="shield"
                      size={11}
                      strokeWidth={2.5}
                      color={colors.mutedForeground}
                    />
                  ) : null}
                  <Text style={[styles.groupTitle, { color: colors.mutedForeground }]}>
                    {group.toUpperCase()}
                  </Text>
                </View>
                <View
                  style={[
                    styles.groupCard,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                >
                  {MODERATOR_PERMISSION_OPTIONS.filter((option) => option.group === group).map(
                    (option, index) => (
                      <View
                        key={option.key}
                        style={[
                          styles.optionRow,
                          index > 0 && {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: colors.border,
                          },
                        ]}
                      >
                        <View style={styles.optionText}>
                          <Text style={[styles.optionLabel, { color: colors.foreground }]}>
                            {option.label}
                          </Text>
                          <Text style={[styles.optionCopy, { color: colors.mutedForeground }]}>
                            {option.description}
                          </Text>
                        </View>
                        <Switch
                          value={permissions[option.key]}
                          onValueChange={(value) =>
                            setPermissions((prev) => ({ ...prev, [option.key]: value }))
                          }
                          disabled={saving}
                          trackColor={{ true: colors.accent, false: colors.border }}
                          thumbColor={permissions[option.key] ? colors.accentForeground : colors.foreground}
                          ios_backgroundColor={colors.border}
                          accessibilityLabel={option.label}
                        />
                      </View>
                    )
                  )}
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={[styles.actions, { borderTopColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              disabled={saving}
              style={({ pressed }) => [
                styles.secondary,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                  opacity: saving ? 0.5 : 1,
                },
              ]}
            >
              <Text style={[styles.secondaryText, { color: colors.mutedForeground }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onSave(permissions)}
              disabled={saving || !dirty}
              style={({ pressed }) => [
                styles.primary,
                {
                  backgroundColor: pressed ? colors.accentHover : colors.accent,
                  opacity: saving || !dirty ? 0.5 : 1,
                },
              ]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.accentForeground} />
              ) : (
                <Text style={[styles.primaryText, { color: colors.accentForeground }]}>
                  {mode === 'promote' ? 'Make moderator' : 'Save permissions'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '86%',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  content: { padding: 18 },
  title: { fontSize: 17, fontFamily: 'Geist_600SemiBold' },
  intro: {
    fontSize: 12,
    fontFamily: 'Geist_400Regular',
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 16,
  },
  error: {
    fontSize: 12,
    fontFamily: 'Geist_500Medium',
    marginBottom: 12,
    lineHeight: 17,
  },
  group: { marginBottom: 18 },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  groupTitle: {
    fontSize: 9.5,
    fontFamily: 'Geist_600SemiBold',
    letterSpacing: 1.2,
  },
  groupCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  optionText: { flex: 1, minWidth: 0 },
  optionLabel: { fontSize: 13.5, fontFamily: 'Geist_500Medium' },
  optionCopy: {
    fontSize: 11,
    fontFamily: 'Geist_400Regular',
    lineHeight: 15,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  secondary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 11,
    paddingVertical: 12,
  },
  secondaryText: { fontSize: 13.5, fontFamily: 'Geist_500Medium' },
  primary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    paddingVertical: 12,
  },
  primaryText: { fontSize: 13.5, fontFamily: 'Geist_600SemiBold' },
});
