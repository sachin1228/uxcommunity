import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Linking, Modal, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useCommunityContent, communityContentKey } from '@/hooks/useCommunityContent';
import {
  CommunityContent, CommunityEvent, CommunityResource, CommunityThread, ContentKind,
  deleteCommunityContent, getLinkPreviewImage, setContentAction, toggleContentAction,
} from '@/lib/communityContent';
import { BooleanIntentCoalescer } from '@/lib/booleanIntentCoalescer';
import { CommunityContentEditor } from './CommunityContentEditor';

interface Props { communityId: string; kind: ContentKind; currentUserId: string }
const previewCache = new Map<string, string | null>();

export function CommunityContentView({ communityId, kind, currentUserId }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const query = useCommunityContent(communityId, kind);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editing, setEditing] = useState<CommunityContent | null>(null);
  const [selected, setSelected] = useState<CommunityContent | null>(null);
  const actionCoalescersRef = useRef(new Map<string, BooleanIntentCoalescer>());
  const items = query.data ?? [];

  useEffect(() => {
    const coalescers = actionCoalescersRef.current;
    return () => {
      coalescers.forEach((coalescer) => coalescer.dispose());
      coalescers.clear();
    };
  }, []);

  const replace = (item: CommunityContent) => {
    queryClient.setQueryData<CommunityContent[]>(communityContentKey(communityId, kind), (old = []) => {
      const exists = old.some((entry) => entry.id === item.id);
      return exists ? old.map((entry) => entry.id === item.id ? item : entry) : [item, ...old];
    });
    setSelected((current) => current?.id === item.id ? item : current);
  };

  const remove = (item: CommunityContent) => Alert.alert(`Delete ${singular(kind).toLowerCase()}?`, 'This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        await deleteCommunityContent(communityId, kind, item.id);
        queryClient.setQueryData<CommunityContent[]>(communityContentKey(communityId, kind), (old = []) => old.filter((entry) => entry.id !== item.id));
        setSelected(null);
      } catch (e) { Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.'); }
    } },
  ]);

  const patchThreadAction = (itemId: string, actionName: 'like' | 'save', desired: boolean) => {
    const patch = (entry: CommunityContent): CommunityContent => {
      if (entry.id !== itemId) return entry;
      const thread = entry as CommunityThread;
      if (actionName === 'like') {
        if (thread.user_liked === desired) return thread;
        return {
          ...thread,
          user_liked: desired,
          like_count: Math.max(0, thread.like_count + (desired ? 1 : -1)),
        };
      }
      return thread.user_saved === desired ? thread : { ...thread, user_saved: desired };
    };

    queryClient.setQueryData<CommunityContent[]>(
      communityContentKey(communityId, kind),
      (old = []) => old.map(patch),
    );
    setSelected((current) => current ? patch(current) : current);
  };

  const action = async (item: CommunityContent, actionName: 'like' | 'save' | 'rsvp' | 'bookmark') => {
    if (kind === 'threads' && (actionName === 'like' || actionName === 'save')) {
      const thread = item as CommunityThread;
      const key = `${item.id}:${actionName}`;
      let coalescer = actionCoalescersRef.current.get(key);

      if (!coalescer) {
        coalescer = new BooleanIntentCoalescer({
          initialValue: actionName === 'like' ? thread.user_liked : thread.user_saved,
          onOptimisticChange: (desired) => patchThreadAction(item.id, actionName, desired),
          persist: (desired) => setContentAction(communityId, kind, item.id, actionName, desired),
          onError: (error) => Alert.alert(
            'Action failed',
            error instanceof Error ? error.message : 'Please try again.',
          ),
        });
        actionCoalescersRef.current.set(key, coalescer);
      }

      await queryClient.cancelQueries({ queryKey: communityContentKey(communityId, kind) });
      coalescer.toggle();
      return;
    }

    try {
      await toggleContentAction(communityId, kind, item.id, actionName);
      const result = await query.refetch();
      const updated = result.data?.find((entry) => entry.id === item.id);
      if (updated) setSelected((current) => current?.id === item.id ? updated : current);
    } catch (e) { Alert.alert('Action failed', e instanceof Error ? e.message : 'Please try again.'); }
  };

  if (query.isLoading) return <Centered><ActivityIndicator color={colors.primary} /></Centered>;
  if (query.isError) return <Centered><Feather name="wifi-off" size={28} color={colors.mutedForeground} /><Text style={[styles.stateTitle, { color: colors.foreground }]}>Couldn&apos;t load {kind}</Text><Pressable onPress={() => query.refetch()}><Text style={[styles.retry, { color: colors.primary }]}>Try again</Text></Pressable></Centered>;

  return <View style={styles.root}>
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ContentCard item={item} kind={kind} onOpen={() => setSelected(item)} onAction={action} onEdit={() => { setEditing(item); setEditorVisible(true); }} onDelete={() => remove(item)} isOwner={item.user_id === currentUserId} />}
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 112 }]}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.primary} />}
      ListEmptyComponent={<Centered><Feather name={kind === 'threads' ? 'message-square' : kind === 'events' ? 'calendar' : 'bookmark'} size={32} color={colors.mutedForeground} /><Text style={[styles.stateTitle, { color: colors.foreground }]}>No {kind} yet</Text><Text style={[styles.stateBody, { color: colors.mutedForeground }]}>Be the first to add one for this community.</Text></Centered>}
    />
    <Pressable onPress={() => { setEditing(null); setEditorVisible(true); }} style={[styles.fab, { backgroundColor: colors.primary, bottom: insets.bottom + 20 }]} accessibilityRole="button" accessibilityLabel={`Create ${singular(kind)}`}>
      <Feather name="plus" size={25} color={colors.primaryForeground} />
      <Text style={[styles.fabText, { color: colors.primaryForeground }]}>{kind === 'resources' ? 'Share' : 'Create'}</Text>
    </Pressable>
    <CommunityContentEditor visible={editorVisible} communityId={communityId} kind={kind} item={editing} onClose={() => { setEditorVisible(false); setEditing(null); }} onSaved={replace} />
    <ContentDetail visible={Boolean(selected)} item={selected} kind={kind} onClose={() => setSelected(null)} onAction={action} onEdit={() => { if (selected) { setEditing(selected); setEditorVisible(true); } }} onDelete={() => selected && remove(selected)} isOwner={selected?.user_id === currentUserId} />
  </View>;
}

function ContentCard({ item, kind, onOpen, onAction, onEdit, onDelete, isOwner }: {
  item: CommunityContent; kind: ContentKind; onOpen: () => void;
  onAction: (item: CommunityContent, action: 'like' | 'save' | 'rsvp' | 'bookmark') => void;
  onEdit: () => void; onDelete: () => void; isOwner: boolean;
}) {
  const colors = useColors();
  const thread = kind === 'threads' ? item as CommunityThread : null;
  const event = kind === 'events' ? item as CommunityEvent : null;
  const resource = kind === 'resources' ? item as CommunityResource : null;
  const date = event ? new Date(event.event_date) : new Date(item.created_at);
  const images = thread?.attachments.filter((attachment) => attachment.type.startsWith('image/')) ?? [];
  const previewImage = useResourcePreview(resource?.url);

  return <Pressable onPress={onOpen} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityRole="button" accessibilityLabel={`View ${singular(kind)}: ${item.title}`}>
    {event?.cover_image_url ? <Image source={{ uri: event.cover_image_url }} style={styles.cover} /> : null}
    {resource && previewImage ? <Image source={{ uri: previewImage }} style={styles.cover} /> : null}
    <View style={styles.cardBody}>
      <View style={styles.authorRow}>
        {item.users?.avatar_url ? <Image source={{ uri: item.users.avatar_url }} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.primarySoft }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{(item.users?.name ?? 'M')[0].toUpperCase()}</Text></View>}
        <View style={styles.authorCopy}><Text style={[styles.author, { color: colors.foreground }]} numberOfLines={1}>{item.users?.name ?? 'Community member'}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>{event ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</Text></View>
        <OptionsMenu isOwner={isOwner} onEdit={onEdit} onDelete={onDelete} />
      </View>
      <Text style={[styles.cardTitle, { color: colors.foreground }]}>{item.title}</Text>
      {!thread && item.description ? <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={3}>{item.description}</Text> : null}
      {images.length ? <ThreadImages images={images} /> : null}
      {thread ? <View style={styles.tags}><Tag text={thread.category} />{thread.tags.map((tag) => <Tag key={tag} text={`#${tag}`} />)}</View> : null}
      {resource ? <View style={styles.tags}><Tag text={resource.resource_type.replace('_', ' ')} />{resource.tags.map((tag) => <Tag key={tag} text={`#${tag}`} />)}</View> : null}
      {event ? <View style={styles.eventMeta}><Feather name={event.is_online ? 'video' : 'map-pin'} size={15} color={colors.primary} /><Text style={[styles.eventMetaText, { color: colors.mutedForeground }]}>{event.is_online ? 'Online event' : event.location || 'Location to be announced'}</Text></View> : null}
      <ContentActions item={item} thread={thread} event={event} resource={resource} onAction={onAction} />
    </View>
  </Pressable>;
}

function ContentDetail({ visible, item, kind, onClose, onAction, onEdit, onDelete, isOwner }: {
  visible: boolean; item: CommunityContent | null; kind: ContentKind; onClose: () => void;
  onAction: (item: CommunityContent, action: 'like' | 'save' | 'rsvp' | 'bookmark') => void;
  onEdit: () => void; onDelete: () => void; isOwner: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const previewImage = useResourcePreview(kind === 'resources' ? (item as CommunityResource | null)?.url : undefined);
  if (!item) return null;
  const thread = kind === 'threads' ? item as CommunityThread : null;
  const event = kind === 'events' ? item as CommunityEvent : null;
  const resource = kind === 'resources' ? item as CommunityResource : null;
  const images = thread?.attachments.filter((attachment) => attachment.type.startsWith('image/')) ?? [];
  const files = thread?.attachments.filter((attachment) => !attachment.type.startsWith('image/')) ?? [];
  const description = thread ? threadDescription(thread.title, thread.description) : item.description;

  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <View style={[styles.detailRoot, { backgroundColor: colors.subtle }]}>
      <View style={[styles.detailHeader, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={onClose} style={styles.headerButton} accessibilityLabel="Back"><Feather name="arrow-left" size={25} color={colors.foreground} /></Pressable>
        <Text style={[styles.detailHeaderTitle, { color: colors.foreground }]}>{singular(kind)}</Text>
        <OptionsMenu isOwner={isOwner} onEdit={onEdit} onDelete={onDelete} />
      </View>
      <ScrollView contentContainerStyle={[styles.detailContent, { paddingBottom: insets.bottom + 32 }]}>
        {event?.cover_image_url ? <Image source={{ uri: event.cover_image_url }} style={styles.detailCover} /> : null}
        {resource && previewImage ? <Image source={{ uri: previewImage }} style={styles.detailCover} /> : null}
        <View style={styles.authorRow}>
          {item.users?.avatar_url ? <Image source={{ uri: item.users.avatar_url }} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.primarySoft }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{(item.users?.name ?? 'M')[0].toUpperCase()}</Text></View>}
          <View style={styles.authorCopy}><Text style={[styles.author, { color: colors.foreground }]}>{item.users?.name ?? 'Community member'}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>{new Date(event?.event_date ?? item.created_at).toLocaleString()}</Text></View>
        </View>
        <Text style={[styles.detailTitle, { color: colors.foreground }]}>{item.title}</Text>
        {description ? <Text style={[styles.detailDescription, { color: colors.mutedForeground }]}>{description}</Text> : null}
        {images.length ? <ThreadImages images={images} /> : null}
        {files.map((file) => <Pressable key={file.url} onPress={() => Linking.openURL(file.url)} style={[styles.linkButton, { borderColor: colors.border }]}><Feather name="paperclip" size={16} color={colors.primary} /><Text style={[styles.linkText, { color: colors.primary }]} numberOfLines={1}>{file.name}</Text></Pressable>)}
        {thread ? <View style={styles.tags}><Tag text={thread.category} />{thread.tags.map((tag) => <Tag key={tag} text={`#${tag}`} />)}</View> : null}
        {event ? <View style={[styles.detailPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}><DetailRow icon="calendar" text={new Date(event.event_date).toLocaleString()} /><DetailRow icon={event.is_online ? 'video' : 'map-pin'} text={event.is_online ? 'Online event' : event.location || 'Location to be announced'} />{event.meet_link ? <Pressable onPress={() => Linking.openURL(event.meet_link!)} style={[styles.linkButton, { borderColor: colors.border }]}><Feather name="video" size={16} color={colors.primary} /><Text style={[styles.linkText, { color: colors.primary }]}>Open meeting link</Text></Pressable> : null}</View> : null}
        {resource ? <><View style={styles.tags}><Tag text={resource.resource_type.replace('_', ' ')} />{resource.tags.map((tag) => <Tag key={tag} text={`#${tag}`} />)}</View><Pressable onPress={() => Linking.openURL(resource.url)} style={[styles.primaryLink, { backgroundColor: colors.primary }]}><Feather name="external-link" size={17} color={colors.primaryForeground} /><Text style={[styles.primaryLinkText, { color: colors.primaryForeground }]}>Open resource</Text></Pressable></> : null}
        <ContentActions item={item} thread={thread} event={event} resource={resource} onAction={onAction} />
      </ScrollView>
    </View>
  </Modal>;
}

function useResourcePreview(url?: string) {
  const [image, setImage] = useState<string | null>(() => url && previewCache.has(url) ? previewCache.get(url) ?? null : null);
  useEffect(() => {
    if (!url || previewCache.has(url)) return;
    let active = true;
    getLinkPreviewImage(url).then((result) => { previewCache.set(url, result); if (active) setImage(result); }).catch(() => previewCache.set(url, null));
    return () => { active = false; };
  }, [url]);
  return image;
}

function OptionsMenu({ isOwner, onEdit, onDelete }: { isOwner: boolean; onEdit: () => void; onDelete: () => void }) {
  const colors = useColors();
  const triggerRef = useRef<View>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 12 });

  const open = () => {
    if (!isOwner) return;
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setPosition({ top: y + height, right: Math.max(12, 12 + (x < 160 ? 160 - x - width : 0)) });
      setVisible(true);
    });
  };
  const choose = (action: () => void) => {
    setVisible(false);
    action();
  };

  return <>
    <Pressable ref={triggerRef} onPress={(event) => { event.stopPropagation(); open(); }} style={styles.menuButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Post options" accessibilityState={{ expanded: visible }}>
      <Feather name="more-vertical" size={21} color={colors.mutedForeground} />
    </Pressable>
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setVisible(false)}>
      <Pressable style={styles.menuBackdrop} onPress={() => setVisible(false)} accessibilityLabel="Close post options">
        <View style={[styles.optionsPopover, { top: position.top, right: position.right, backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable onPress={() => choose(onEdit)} style={styles.optionRow} accessibilityRole="button">
            <Feather name="edit-2" size={16} color={colors.foreground} />
            <Text style={[styles.optionText, { color: colors.foreground }]}>Edit</Text>
          </Pressable>
          <View style={[styles.optionDivider, { backgroundColor: colors.border }]} />
          <Pressable onPress={() => choose(onDelete)} style={styles.optionRow} accessibilityRole="button">
            <Feather name="trash-2" size={16} color={colors.foreground} />
            <Text style={[styles.optionText, { color: colors.foreground }]}>Delete</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  </>;
}

function ThreadImages({ images }: { images: CommunityThread['attachments'] }) {
  return <View style={styles.imageGrid}>{images.slice(0, 4).map((image, index) => <Pressable key={image.url} onPress={() => Linking.openURL(image.url)} style={images.length === 1 ? styles.imageSingle : styles.imageCell}><Image source={{ uri: image.url }} style={styles.threadImage} />{index === 3 && images.length > 4 ? <View style={styles.moreImages}><Text style={styles.moreImagesText}>+{images.length - 4}</Text></View> : null}</Pressable>)}</View>;
}

function ContentActions({ item, thread, event, resource, onAction }: { item: CommunityContent; thread: CommunityThread | null; event: CommunityEvent | null; resource: CommunityResource | null; onAction: (item: CommunityContent, action: 'like' | 'save' | 'rsvp' | 'bookmark') => void }) {
  const colors = useColors();
  return <View style={[styles.actions, { borderTopColor: colors.border }]}>
    {thread ? <><Action icon="heart" active={thread.user_liked} label={String(thread.like_count)} onPress={() => onAction(item, 'like')} /><Action icon="message-circle" label={String(thread.comment_count)} /><Action icon="bookmark" active={thread.user_saved} label="Save" onPress={() => onAction(item, 'save')} /></> : null}
    {event ? <><Action icon="check-circle" active={event.user_rsvped} label={`${event.rsvp_count} going`} onPress={() => onAction(item, 'rsvp')} /><Action icon="bookmark" active={event.user_saved} label="Save" onPress={() => onAction(item, 'save')} /></> : null}
    {resource ? <><Action icon="heart" active={resource.user_saved} label={String(resource.save_count)} onPress={() => onAction(item, 'save')} /><Action icon="message-circle" label={String(resource.comment_count)} /><Action icon="bookmark" active={resource.user_bookmarked} label="Bookmark" onPress={() => onAction(item, 'bookmark')} /></> : null}
  </View>;
}

function DetailRow({ icon, text }: { icon: React.ComponentProps<typeof Feather>['name']; text: string }) { const colors = useColors(); return <View style={styles.eventMeta}><Feather name={icon} size={16} color={colors.primary} /><Text style={[styles.eventMetaText, { color: colors.mutedForeground }]}>{text}</Text></View>; }
function Action({ icon, label, active, onPress }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; active?: boolean; onPress?: () => void }) { const colors = useColors(); return <Pressable onPress={(e) => { e.stopPropagation(); onPress?.(); }} disabled={!onPress} style={styles.action}><Feather name={icon} size={16} color={active ? colors.primary : colors.mutedForeground} /><Text style={[styles.actionText, { color: active ? colors.primary : colors.mutedForeground }]}>{label}</Text></Pressable>; }
function Tag({ text }: { text: string }) { const colors = useColors(); return <View style={[styles.tag, { backgroundColor: colors.primarySoft }]}><Text style={[styles.tagText, { color: colors.primary }]}>{text}</Text></View>; }
function Centered({ children }: { children: React.ReactNode }) { return <View style={styles.center}>{children}</View>; }
function threadDescription(title: string, description: string | null) {
  const body = description?.trim();
  if (!body || body === title.trim()) return null;
  if (body.startsWith(`${title.trim()}\n`)) return body.slice(title.trim().length).trim() || null;
  return body;
}

function singular(kind: ContentKind) { return kind === 'threads' ? 'Thread' : kind === 'events' ? 'Event' : 'Resource'; }

const styles = StyleSheet.create({
  root: { flex: 1 }, list: { padding: 12, gap: 12, flexGrow: 1 }, center: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 }, stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 17 }, stateBody: { fontFamily: 'Geist_400Regular', fontSize: 14, textAlign: 'center' }, retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' }, cover: { width: '100%', height: 160 }, cardBody: { padding: 14, gap: 11 }, authorRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, avatar: { width: 34, height: 34, borderRadius: 17 }, avatarFallback: { alignItems: 'center', justifyContent: 'center' }, avatarText: { fontFamily: 'Geist_600SemiBold', fontSize: 13 }, authorCopy: { flex: 1 }, author: { fontFamily: 'Geist_600SemiBold', fontSize: 14 }, meta: { fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 1 }, menuButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }, menuBackdrop: { flex: 1 }, optionsPopover: { position: 'absolute', width: 152, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 5, elevation: 8, shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } }, optionRow: { minHeight: 44, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 }, optionText: { fontFamily: 'Geist_500Medium', fontSize: 14 }, optionDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 12 },
  cardTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15, lineHeight: 21 }, description: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19 }, tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, tag: { borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5 }, tagText: { fontFamily: 'Geist_500Medium', fontSize: 11, textTransform: 'capitalize' }, eventMeta: { flexDirection: 'row', alignItems: 'center', gap: 7 }, eventMetaText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 13 }, linkButton: { height: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, linkText: { flex: 1, fontFamily: 'Geist_500Medium', fontSize: 13 },
  actions: { minHeight: 36, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, flexDirection: 'row', alignItems: 'center', gap: 20 }, action: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6 }, actionText: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, borderRadius: 10, overflow: 'hidden' }, imageSingle: { width: '100%', height: 210 }, imageCell: { width: '49.5%', height: 130 }, threadImage: { width: '100%', height: '100%' }, moreImages: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }, moreImagesText: { color: '#FFFFFF', fontFamily: 'Geist_600SemiBold', fontSize: 22 },
  fab: { position: 'absolute', right: 18, height: 54, borderRadius: 27, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, elevation: 8, shadowColor: '#000000', shadowOpacity: 0.24, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } }, fabText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  detailRoot: { flex: 1 }, detailHeader: { minHeight: 64, paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8 }, headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, detailHeaderTitle: { flex: 1, fontFamily: 'Geist_600SemiBold', fontSize: 19 }, detailContent: { padding: 18, gap: 16 }, detailCover: { width: '100%', height: 220, borderRadius: 14 }, detailTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 25, lineHeight: 32 }, detailDescription: { fontFamily: 'Geist_400Regular', fontSize: 16, lineHeight: 25 }, detailPanel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 12 }, primaryLink: { height: 48, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, primaryLinkText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
});
