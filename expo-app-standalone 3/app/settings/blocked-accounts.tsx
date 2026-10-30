import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useColors } from '@/hooks/useColors';
import { getBlockedUsers, unblockUser, type BlockedMember } from '@/lib/dmApi';

/**
 * Blocked accounts — the mobile mirror of the web Settings card. A block is
 * global: blocked members cannot message, comment on your posts or notify you.
 */
export default function BlockedAccountsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [members, setMembers] = useState<BlockedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    setLoading(true);
    try {
      setMembers(await getBlockedUsers());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUnblock = useCallback(
    (member: BlockedMember) => {
      if (pendingId) return;
      Alert.alert('Unblock member?', `You will be able to message ${member.name} again.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            setPendingId(member.id);
            try {
              await unblockUser(member.id);
              setMembers((current) => current.filter((row) => row.id !== member.id));
            } catch {
              Alert.alert('Could not unblock', 'Please try again.');
            } finally {
              setPendingId(null);
            }
          },
        },
      ]);
    },
    [pendingId],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Blocked accounts" subtitle="People who cannot message or mention you." />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : failed ? (
            <Pressable onPress={() => void load()} accessibilityRole="button">
              <Text style={[styles.empty, { color: colors.destructive }]}>
                Couldn&apos;t load your blocked accounts. Tap to retry.
              </Text>
            </Pressable>
          ) : members.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              You haven&apos;t blocked anyone.
            </Text>
          ) : (
            members.map((member, index) => (
              <View
                key={member.id}
                style={[
                  styles.row,
                  index < members.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <View style={styles.identity}>
                  <PersonAvatar
                    name={member.name}
                    url={member.avatar_url}
                    size={36}
                  />
                  <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                    {member.name}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleUnblock(member)}
                  disabled={pendingId === member.id}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.unblock,
                    {
                      borderColor: colors.border,
                      backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                      opacity: pendingId === member.id ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.unblockLabel, { color: colors.foreground }]}>
                    {pendingId === member.id ? 'Unblocking…' : 'Unblock'}
                  </Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <Text style={[styles.help, { color: colors.mutedForeground }]}>
          A block stops direct messages, comments on your posts and notifications from
          that member. You can unblock them here at any time.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 16 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
  },
  loader: { paddingVertical: 24 },
  empty: {
    paddingVertical: 24,
    textAlign: 'center',
    fontSize: 13,
    fontFamily: 'Geist_400Regular',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  name: { flex: 1, fontSize: 14, fontFamily: 'Geist_500Medium' },
  unblock: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  unblockLabel: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  help: { fontSize: 12, lineHeight: 18, fontFamily: 'Geist_400Regular' },
});
