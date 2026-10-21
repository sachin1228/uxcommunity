/**
 * Messages — the DM conversation list, the mobile rendering of the web
 * /dashboard/messages list pane: newest first, "Message request" for pending
 * incoming requests, blue unread pills (people-count), and a client-side name
 * search. Conversations start from a member profile, so this pane carries no
 * compose flow — same rule as the web.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DmIcon } from '@/components/DmIcon';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useDmTyping } from '@/hooks/useDmTyping';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import { getDmConversations } from '@/lib/dmApi';
import {
  dmConversationPreview,
  dmTimestampLabel,
  isIncomingRequest,
  unreadPillLabel,
  type DmConversation,
} from '@/lib/dm';

const REALTIME_DEBOUNCE_MS = 600;

export default function MessagesScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { typingByConversation } = useDmTyping(null);

  const [conversations, setConversations] = useState<DmConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    if (mode !== 'silent') setError(null);
    try {
      const rows = await getDmConversations();
      setConversations(rows);
      if (mode !== 'silent') setError(null);
    } catch (e) {
      if (mode !== 'silent') {
        setError(e instanceof Error ? e.message : 'Failed to load messages.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  // A DM can arrive from anywhere; re-read on return and live over the room.
  useFocusEffect(
    useCallback(() => {
      void load('silent');
    }, [load]),
  );

  useEffect(() => {
    if (!userId) return;
    realtimeClient.init({ id: userId, name: user?.name ?? null, avatar: null });
    const room = realtimeRooms.dm(userId);
    realtimeClient.connect(room);

    const schedule = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void load('silent');
      }, REALTIME_DEBOUNCE_MS);
    };

    const unsubscribers = [
      realtimeClient.on(room, 'dm-message', schedule),
      realtimeClient.on(room, 'dm-request-update', schedule),
      realtimeClient.on(room, 'dm-message-edit', schedule),
      realtimeClient.on(room, 'dm-message-delete', schedule),
      realtimeClient.on(room, 'dm-reaction-insert', schedule),
      realtimeClient.on(room, 'dm-reaction-update', schedule),
      realtimeClient.on(room, 'dm-reaction-delete', schedule),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [userId, user?.name, load]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return conversations.filter(
      (conversation) =>
        !conversation.blocked_by_me &&
        conversation.request_state !== 'rejected' &&
        (!term || conversation.peer.name.toLowerCase().includes(term)),
    );
  }, [conversations, query]);

  const openThread = useCallback(
    (conversation: DmConversation) => {
      router.push({
        pathname: '/messages/[id]',
        params: {
          id: conversation.id,
          name: conversation.peer.name,
          avatar: conversation.peer.avatar_url ?? '',
          peerId: conversation.peer.id,
        },
      });
    },
    [router],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />

      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
            paddingTop: insets.top + 8,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Messages</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            Couldn&apos;t load messages
          </Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{error}</Text>
          <Pressable onPress={() => void load('initial')} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(conversation) => conversation.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={colors.foregroundMuted}
            />
          }
          ListHeaderComponent={
            conversations.length > 0 ? (
              <View
                style={[
                  styles.searchBox,
                  { backgroundColor: colors.input, borderColor: colors.inputBorder },
                ]}
              >
                <Feather name="search" size={15} color={colors.mutedForeground} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search conversations…"
                  placeholderTextColor={colors.foregroundSubtle}
                  style={[styles.searchInput, { color: colors.foreground }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Search conversations"
                />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <ConversationRow
              conversation={item}
              userId={userId ?? ''}
              typingLabel={typingByConversation.get(item.id) ?? null}
              onPress={() => openThread(item)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <DmIcon size={28} color={colors.foregroundSubtle} />
              <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>
                {query ? 'No conversations match' : 'No conversations yet'}
              </Text>
              <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
                {query
                  ? 'Try a different name.'
                  : 'Start one from any member profile.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function ConversationRow({
  conversation,
  userId,
  typingLabel,
  onPress,
}: {
  conversation: DmConversation;
  userId: string;
  typingLabel: string | null;
  onPress: () => void;
}) {
  const colors = useColors();

  const preview = dmConversationPreview(conversation, userId);
  const incoming = isIncomingRequest(conversation, userId);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${conversation.peer.name}${
        conversation.unread_count > 0 ? `, ${conversation.unread_count} unread` : ''
      }`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border },
        pressed && { backgroundColor: colors.surfaceRaised },
      ]}
    >
      <PersonAvatar name={conversation.peer.name} url={conversation.peer.avatar_url} size={46} />

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text
            style={[
              styles.peerName,
              {
                color: colors.foreground,
                fontFamily:
                  conversation.unread_count > 0 ? 'Geist_600SemiBold' : 'Geist_500Medium',
              },
            ]}
            numberOfLines={1}
          >
            {conversation.peer.name}
          </Text>
          <Text style={[styles.time, { color: colors.foregroundSubtle }]}>
            {dmTimestampLabel(conversation.last_message_at)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text
            style={[
              styles.preview,
              {
                color: typingLabel
                  ? colors.accent
                  : incoming
                    ? colors.accent
                    : preview.muted
                      ? colors.foregroundSubtle
                      : colors.mutedForeground,
              },
            ]}
            numberOfLines={1}
          >
            {typingLabel ?? preview.text}
          </Text>
          {conversation.unread_count > 0 && (
            <View style={[styles.unreadPill, { backgroundColor: colors.chatUnreadPill }]}>
              <Text style={styles.unreadText}>
                {unreadPillLabel(conversation.unread_count)}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { padding: 2 },
  headerTitle: { flex: 1, fontFamily: 'Geist_600SemiBold', fontSize: 17, textAlign: 'center' },
  headerSpacer: { width: 26 },
  center: {
    flex: 1,
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 16, textAlign: 'center' },
  stateBody: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  list: { flexGrow: 1 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    height: 40,
    margin: 12,
    marginBottom: 4,
  },
  searchInput: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 14, padding: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  peerName: { flex: 1, fontSize: 14.5 },
  time: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preview: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 13 },
  unreadPill: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: { fontFamily: 'Geist_700Bold', fontSize: 11, color: '#FFFFFF' },
});
