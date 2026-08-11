import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Linking, Pressable, RefreshControl,
  StyleSheet, Text, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useCommunityContent, communityContentKey } from '@/hooks/useCommunityContent';
import {
  CommunityContent, CommunityEvent, CommunityResource, CommunityThread, ContentKind,
  deleteCommunityContent, toggleContentAction,
} from '@/lib/communityContent';
import { CommunityContentEditor } from './CommunityContentEditor';

interface Props { communityId: string; kind: ContentKind; currentUserId: string }

export function CommunityContentView({ communityId, kind, currentUserId }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const query = useCommunityContent(communityId, kind);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editing, setEditing] = useState<CommunityContent | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const items = query.data ?? [];

  const replace = (item: CommunityContent) => queryClient.setQueryData<CommunityContent[]>(communityContentKey(communityId, kind), (old = []) => {
    const exists = old.some((entry) => entry.id === item.id);
    return exists ? old.map((entry) => entry.id === item.id ? item : entry) : [item, ...old];
  });

  const remove = (item: CommunityContent) => Alert.alert(`Delete ${singular(kind).toLowerCase()}?`, 'This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        await deleteCommunityContent(communityId, kind, item.id);
        queryClient.setQueryData<CommunityContent[]>(communityContentKey(communityId, kind), (old = []) => old.filter((entry) => entry.id !== item.id));
      } catch (e) { Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.'); }
    } },
  ]);

  const action = async (item: CommunityContent, actionName: 'vote' | 'save' | 'rsvp' | 'bookmark') => {
    try {
      await toggleContentAction(communityId, kind, item.id, actionName);
      await query.refetch();
    } catch (e) { Alert.alert('Action failed', e instanceof Error ? e.message : 'Please try again.'); }
  };

  if (query.isLoading) return <Centered><ActivityIndicator color={colors.primary} /></Centered>;
  if (query.isError) return <Centered><Feather name="wifi-off" size={28} color={colors.mutedForeground} /><Text style={[styles.stateTitle, { color: colors.foreground }]}>Couldn&apos;t load {kind}</Text><Pressable onPress={() => query.refetch()}><Text style={[styles.retry, { color: colors.primary }]}>Try again</Text></Pressable></Centered>;

  return <View style={styles.root}>
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ContentCard item={item} kind={kind} expanded={expandedId === item.id} onToggle={() => setExpandedId((id) => id === item.id ? null : item.id)} onAction={action} onEdit={() => { setEditing(item); setEditorVisible(true); }} onDelete={() => remove(item)} isOwner={item.user_id === currentUserId} />}
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 112 }]}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.primary} />}
      ListEmptyComponent={<Centered><Feather name={kind === 'threads' ? 'message-square' : kind === 'events' ? 'calendar' : 'bookmark'} size={32} color={colors.mutedForeground} /><Text style={[styles.stateTitle, { color: colors.foreground }]}>No {kind} yet</Text><Text style={[styles.stateBody, { color: colors.mutedForeground }]}>Be the first to add one for this community.</Text></Centered>}
    />
    <Pressable
      onPress={() => { setEditing(null); setEditorVisible(true); }}
      style={[styles.fab, { backgroundColor: colors.primary, bottom: insets.bottom + 20 }]}
      accessibilityRole="button"
      accessibilityLabel={`Create ${singular(kind)}`}
    >
      <Feather name="plus" size={25} color={colors.primaryForeground} />
      <Text style={[styles.fabText, { color: colors.primaryForeground }]}>{kind === 'resources' ? 'Share' : 'Create'}</Text>
    </Pressable>
    <CommunityContentEditor visible={editorVisible} communityId={communityId} kind={kind} item={editing} onClose={() => { setEditorVisible(false); setEditing(null); }} onSaved={replace} />
  </View>;
}

function ContentCard({ item, kind, expanded, onToggle, onAction, onEdit, onDelete, isOwner }: {
  item: CommunityContent; kind: ContentKind; expanded: boolean; onToggle: () => void;
  onAction: (item: CommunityContent, action: 'vote' | 'save' | 'rsvp' | 'bookmark') => void;
  onEdit: () => void; onDelete: () => void; isOwner: boolean;
}) {
  const colors = useColors();
  const thread = kind === 'threads' ? item as CommunityThread : null;
  const event = kind === 'events' ? item as CommunityEvent : null;
  const resource = kind === 'resources' ? item as CommunityResource : null;
  const date = event ? new Date(event.event_date) : new Date(item.created_at);
  return <Pressable onPress={onToggle} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    {event?.cover_image_url ? <Image source={{ uri: event.cover_image_url }} style={styles.cover} /> : null}
    <View style={styles.cardBody}>
      <View style={styles.authorRow}>
        {item.users?.avatar_url ? <Image source={{ uri: item.users.avatar_url }} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.primarySoft }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{(item.users?.name ?? 'M')[0].toUpperCase()}</Text></View>}
        <View style={styles.authorCopy}><Text style={[styles.author, { color: colors.foreground }]} numberOfLines={1}>{item.users?.name ?? 'Community member'}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>{event ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</Text></View>
        {isOwner ? <View style={styles.ownerActions}><Pressable onPress={(e) => { e.stopPropagation(); onEdit(); }} hitSlop={8} accessibilityLabel="Edit"><Feather name="edit-2" size={17} color={colors.mutedForeground} /></Pressable><Pressable onPress={(e) => { e.stopPropagation(); onDelete(); }} hitSlop={8} accessibilityLabel="Delete"><Feather name="trash-2" size={17} color={colors.destructive} /></Pressable></View> : null}
      </View>
      <Text style={[styles.cardTitle, { color: colors.foreground }]}>{item.title}</Text>
      {item.description ? <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={expanded ? undefined : 3}>{item.description}</Text> : null}
      {thread ? <View style={styles.tags}><Tag text={thread.category} />{thread.tags.map((tag) => <Tag key={tag} text={`#${tag}`} />)}</View> : null}
      {resource ? <View style={styles.tags}><Tag text={resource.resource_type.replace('_', ' ')} />{resource.tags.map((tag) => <Tag key={tag} text={`#${tag}`} />)}</View> : null}
      {event ? <View style={styles.eventMeta}><Feather name={event.is_online ? 'video' : 'map-pin'} size={15} color={colors.primary} /><Text style={[styles.eventMetaText, { color: colors.mutedForeground }]}>{event.is_online ? 'Online event' : event.location || 'Location to be announced'}</Text></View> : null}
      {expanded && resource ? <Pressable onPress={() => Linking.openURL(resource.url)} style={[styles.linkButton, { borderColor: colors.border }]}><Feather name="external-link" size={15} color={colors.primary} /><Text style={[styles.linkText, { color: colors.primary }]} numberOfLines={1}>{resource.url}</Text></Pressable> : null}
      {expanded && event?.meet_link ? <Pressable onPress={() => Linking.openURL(event.meet_link!)} style={[styles.linkButton, { borderColor: colors.border }]}><Feather name="video" size={15} color={colors.primary} /><Text style={[styles.linkText, { color: colors.primary }]}>Open meeting link</Text></Pressable> : null}
      <View style={[styles.actions, { borderTopColor: colors.border }]}>
        {thread ? <><Action icon="arrow-up" active={thread.user_voted} label={String(thread.vote_count)} onPress={() => onAction(item, 'vote')} /><Action icon="message-circle" label={String(thread.comment_count)} /><Action icon="bookmark" active={thread.user_saved} label="Save" onPress={() => onAction(item, 'save')} /></> : null}
        {event ? <><Action icon="check-circle" active={event.user_rsvped} label={`${event.rsvp_count} going`} onPress={() => onAction(item, 'rsvp')} /><Action icon="bookmark" active={event.user_saved} label="Save" onPress={() => onAction(item, 'save')} /></> : null}
        {resource ? <><Action icon="heart" active={resource.user_saved} label={String(resource.save_count)} onPress={() => onAction(item, 'save')} /><Action icon="message-circle" label={String(resource.comment_count)} /><Action icon="bookmark" active={resource.user_bookmarked} label="Bookmark" onPress={() => onAction(item, 'bookmark')} /></> : null}
      </View>
    </View>
  </Pressable>;
}

function Action({ icon, label, active, onPress }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; active?: boolean; onPress?: () => void }) { const colors = useColors(); return <Pressable onPress={(e) => { e.stopPropagation(); onPress?.(); }} disabled={!onPress} style={styles.action}><Feather name={icon} size={16} color={active ? colors.primary : colors.mutedForeground} /><Text style={[styles.actionText, { color: active ? colors.primary : colors.mutedForeground }]}>{label}</Text></Pressable>; }
function Tag({ text }: { text: string }) { const colors = useColors(); return <View style={[styles.tag, { backgroundColor: colors.primarySoft }]}><Text style={[styles.tagText, { color: colors.primary }]}>{text}</Text></View>; }
function Centered({ children }: { children: React.ReactNode }) { return <View style={styles.center}>{children}</View>; }
function singular(kind: ContentKind) { return kind === 'threads' ? 'Thread' : kind === 'events' ? 'Event' : 'Resource'; }

const styles = StyleSheet.create({
  root: { flex: 1 }, list: { padding: 12, gap: 12, flexGrow: 1 }, center: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 }, stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 17 }, stateBody: { fontFamily: 'Geist_400Regular', fontSize: 14, textAlign: 'center' }, retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' }, cover: { width: '100%', height: 150 }, cardBody: { padding: 14, gap: 11 }, authorRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, avatar: { width: 34, height: 34, borderRadius: 17 }, avatarFallback: { alignItems: 'center', justifyContent: 'center' }, avatarText: { fontFamily: 'Geist_600SemiBold', fontSize: 13 }, authorCopy: { flex: 1 }, author: { fontFamily: 'Geist_600SemiBold', fontSize: 14 }, meta: { fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 1 }, ownerActions: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 4 },
  cardTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 18, lineHeight: 24 }, description: { fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 21 }, tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, tag: { borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5 }, tagText: { fontFamily: 'Geist_500Medium', fontSize: 11, textTransform: 'capitalize' }, eventMeta: { flexDirection: 'row', alignItems: 'center', gap: 7 }, eventMetaText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 13 }, linkButton: { height: 42, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, linkText: { flex: 1, fontFamily: 'Geist_500Medium', fontSize: 13 },
  actions: { minHeight: 36, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, flexDirection: 'row', alignItems: 'center', gap: 20 }, action: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6 }, actionText: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  fab: { position: 'absolute', right: 18, height: 54, borderRadius: 27, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, elevation: 8, shadowColor: '#000000', shadowOpacity: 0.24, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } }, fabText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
});
