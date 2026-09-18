import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { resolveProfilePictureUri } from '@/lib/profilePicture';
import type { MentionCandidate } from '@/lib/chat';

/**
 * Member picker that floats above the composer while an `@` token is being
 * typed — the React Native counterpart of the web `MentionSuggestions`
 * popover. Tapping a row inserts `@Name` into the draft.
 */
export function MentionSuggestions({
  options,
  query,
  onPick,
}: {
  options: MentionCandidate[];
  query: string;
  onPick: (candidate: MentionCandidate) => void;
}) {
  const colors = useColors();

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerText, { color: colors.mutedForeground }]}>
          {query ? `Members matching “${query}”` : 'Mention a member'}
        </Text>
      </View>

      {options.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No members match that name.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        >
          {options.map((member) => {
            const uri = resolveProfilePictureUri(member.avatar_url);
            const initials = member.name
              .split(' ')
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase() ?? '')
              .join('');
            return (
              <Pressable
                key={member.user_id}
                onPress={() => onPick(member)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: pressed ? colors.subtle : 'transparent' },
                ]}
              >
                <View style={[styles.avatar, { backgroundColor: colors.surfaceRaised }]}>
                  {uri ? (
                    <Image source={{ uri }} style={styles.avatarImage} />
                  ) : (
                    <Text style={[styles.avatarText, { color: colors.mutedForeground }]}>
                      {initials}
                    </Text>
                  )}
                </View>
                <View style={styles.rowText}>
                  <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>
                    {member.name}
                  </Text>
                  {!!member.designation && (
                    <Text
                      numberOfLines={1}
                      style={[styles.designation, { color: colors.mutedForeground }]}
                    >
                      {member.designation}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginHorizontal: 2,
    marginBottom: 6,
    maxHeight: 240,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  header: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  headerText: {
    fontSize: 10,
    fontFamily: 'Geist_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  list: { maxHeight: 200 },
  empty: { paddingHorizontal: 12, paddingVertical: 14 },
  emptyText: { fontSize: 12, fontFamily: 'Geist_400Regular' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarImage: { width: 30, height: 30 },
  avatarText: { fontSize: 11, fontFamily: 'Geist_600SemiBold' },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontFamily: 'Geist_500Medium' },
  designation: { fontSize: 11, fontFamily: 'Geist_400Regular' },
});
