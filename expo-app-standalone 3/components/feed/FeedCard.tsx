import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { AntDesign, Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { resolveProfilePictureUri } from '@/lib/profilePicture';
import { getLinkPreviewImage } from '@/lib/communityContent';
import { toggleFeedLike, toggleFeedSave, deleteFeedItem, reportFeedItem, parseFigmaUrl, getFigmaEmbedUrl } from '@/lib/feed';
import { useFeed } from '@/hooks/useFeed';
import type { FeedItem, FeedThread, FeedEvent, FeedResource, FeedShowcase } from '@/lib/feed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) {
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
  }
  if (diffDays === 1) return '1d';
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatEventDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date} \u2022 ${time}`;
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
}

const CATEGORY_LABELS: Record<string, string> = {
  question: 'Question', discussion: 'Discussion', idea: 'Idea',
  feedback: 'Feedback', referral: 'Referral', collaboration: 'Collaboration',
};

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  figma: 'Figma', article: 'Article', tool: 'Tool', video: 'Video',
  book: 'Book', font: 'Font', icon_pack: 'Icon Pack', color: 'Color',
  template: 'Template', inspiration: 'Inspiration', other: 'Other',
};

const SHOWCASE_TYPE_LABELS: Record<string, string> = {
  finished: 'Finished work', wip: 'Work in progress',
  case_study: 'Case study', feedback: 'Looking for feedback',
};

const GRADIENTS = [
  ['#7c3aed', '#ec4899'], ['#2563eb', '#06b6d4'],
  ['#f97316', '#f43f5e'], ['#10b981', '#14b8a6'],
];

// ---------------------------------------------------------------------------
// Options menu modal
// ---------------------------------------------------------------------------

interface OptionsMenuProps {
  visible: boolean;
  onClose: () => void;
  items: { label: string; icon: string; destructive?: boolean; onPress: () => void }[];
}

function OptionsMenu({ visible, onClose, items }: OptionsMenuProps) {
  const colors = useColors();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={menuStyles.backdrop} onPress={onClose}>
        <Pressable style={[menuStyles.container, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={(e) => e.stopPropagation()}>
          {items.map((item, i) => (
            <Pressable
              key={item.label}
              style={[menuStyles.item, i < items.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
              onPress={() => { onClose(); item.onPress(); }}
            >
              <Feather name={item.icon as any} size={14} color={item.destructive ? '#ef4444' : colors.foreground} />
              <Text style={[menuStyles.itemText, { color: item.destructive ? '#ef4444' : colors.foreground }]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const menuStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    width: 200,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  itemText: {
    fontFamily: 'Geist_500Medium',
    fontSize: 14,
  },
});

// ---------------------------------------------------------------------------
// PostAuthorMeta
// ---------------------------------------------------------------------------

function PostAuthorMeta({
  users, createdAt, secondaryLabel, right,
}: {
  users: FeedItem['users']; createdAt: string; secondaryLabel?: string; right?: React.ReactNode;
}) {
  const colors = useColors();
  const avatarUri = resolveProfilePictureUri(users?.avatar_url);
  const name = users?.name ?? 'Unknown';

  return (
    <View style={metaStyles.row}>
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={metaStyles.avatar} />
      ) : (
        <View style={[metaStyles.avatar, metaStyles.avatarFallback, { backgroundColor: colors.primary + '20' }]}>
          <Text style={[metaStyles.avatarInitial, { color: colors.primary }]}>{name[0].toUpperCase()}</Text>
        </View>
      )}
      <View style={metaStyles.textCol}>
        <View style={metaStyles.nameRow}>
          <Text style={[metaStyles.name, { color: colors.foreground }]} numberOfLines={1}>{name}</Text>
          <Text style={[metaStyles.date, { color: colors.foregroundSoft }]}>{' \u00b7 '}{formatTime(createdAt)}</Text>
        </View>
        {secondaryLabel ? (
          <Text style={[metaStyles.secondary, { color: colors.foregroundSoft }]} numberOfLines={1}>{secondaryLabel}</Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

// ---------------------------------------------------------------------------
// CommunityPostLabel
// ---------------------------------------------------------------------------

function CommunityPostLabel({ name }: { name: string | null }) {
  const colors = useColors();
  if (!name) return null;
  return (
    <View style={labelStyles.row}>
      <Text style={[labelStyles.text, { color: colors.foregroundSoft }]}>posted in </Text>
      <View style={[labelStyles.dot, { backgroundColor: colors.primary + '30' }]} />
      <Text style={[labelStyles.name, { color: colors.mutedForeground }]} numberOfLines={1}>{name}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Thread card
// ---------------------------------------------------------------------------

function ThreadCard({ item }: { item: FeedThread }) {
  const colors = useColors();
  const { user } = useAuth();
  const { refetch } = useFeed();
  const [menuVisible, setMenuVisible] = useState(false);
  const isOwner = user?.id === item.user_id;

  const handleSave = useCallback(async () => {
    try { await toggleFeedSave(item); refetch(); } catch { /* ignore */ }
  }, [item, refetch]);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete post?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteFeedItem(item); refetch(); } catch { /* ignore */ }
      }},
    ]);
  }, [item, refetch]);

  const handleReport = useCallback(async () => {
    try { await reportFeedItem(item); Alert.alert('Reported', 'Thanks for your report.'); } catch { /* ignore */ }
  }, [item]);

  const handleLike = useCallback(async () => {
    try { await toggleFeedLike(item); refetch(); } catch { /* ignore */ }
  }, [item, refetch]);

  const threadImages = (item.attachments ?? []).filter(a => a.type.startsWith('image/'));

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <PostAuthorMeta
        users={item.users} createdAt={item.created_at}
        secondaryLabel={`Threads \u00b7 ${CATEGORY_LABELS[item.category] ?? item.category}`}
        right={
          <Pressable style={optStyles.btn} onPress={() => setMenuVisible(true)}>
            <Feather name="more-horizontal" size={16} color={colors.mutedForeground} />
          </Pressable>
        }
      />

      <View style={styles.body}>
        <Text style={[styles.threadTitle, { color: colors.foreground }]} numberOfLines={2}>{item.title}</Text>
        {item.description ? (
          <Text style={[styles.threadDesc, { color: colors.mutedForeground }]} numberOfLines={3}>{item.description}</Text>
        ) : null}

        {threadImages.length > 0 ? (
          <View style={threadImages.length === 1 ? styles.threadImgSingle : styles.threadImgGrid}>
            {threadImages.slice(0, 4).map((img, i) => (
              <Image key={img.url} source={{ uri: img.url }} style={
                threadImages.length === 1
                  ? styles.threadImgFull
                  : [styles.threadImgHalf, i >= 2 && { marginTop: 2 }]
              } resizeMode="cover" />
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <Pressable style={styles.stat} onPress={handleLike}>
            {item.user_liked ? <AntDesign name="heart" size={20} color="#ef4444" /> : <Feather name="heart" size={20} color={colors.foreground} />}
            <Text style={[styles.statCount, { color: item.user_liked ? '#ef4444' : colors.foreground }]}>{item.like_count}</Text>
          </Pressable>
          <View style={styles.stat}>
            <Feather name="message-circle" size={20} color={colors.foreground} />
            <Text style={[styles.statCount, { color: colors.foreground }]}>{item.comment_count} {item.comment_count === 1 ? 'comment' : 'comments'}</Text>
          </View>
        </View>
        <CommunityPostLabel name={item.community_name} />
      </View>

      <OptionsMenu visible={menuVisible} onClose={() => setMenuVisible(false)} items={[
        { label: item.user_saved ? 'Unsave' : 'Save', icon: 'bookmark', onPress: handleSave },
        ...(isOwner ? [{ label: 'Edit', icon: 'edit-2', onPress: () => {} }] : []),
        ...(isOwner ? [{ label: 'Delete', icon: 'trash-2', destructive: true as const, onPress: handleDelete }] : []),
        ...(!isOwner ? [{ label: 'Report', icon: 'flag', destructive: true as const, onPress: handleReport }] : []),
      ]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Event card
// ---------------------------------------------------------------------------

function EventCard({ item }: { item: FeedEvent }) {
  const colors = useColors();
  const { user } = useAuth();
  const { refetch } = useFeed();
  const [menuVisible, setMenuVisible] = useState(false);
  const isOwner = user?.id === item.user_id;
  const gradientIdx = item.id.charCodeAt(0) % GRADIENTS.length;
  const [g1] = GRADIENTS[gradientIdx];
  const isPast = new Date(item.event_date) < new Date();

  const handleSave = useCallback(async () => {
    try { await toggleFeedSave(item); refetch(); } catch { /* ignore */ }
  }, [item, refetch]);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete event?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteFeedItem(item); refetch(); } catch { /* ignore */ }
      }},
    ]);
  }, [item, refetch]);

  const handleReport = useCallback(async () => {
    try { await reportFeedItem(item); Alert.alert('Reported', 'Thanks for your report.'); } catch { /* ignore */ }
  }, [item]);

  const handleLike = useCallback(async () => {
    try { await toggleFeedLike(item); refetch(); } catch { /* ignore */ }
  }, [item, refetch]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <PostAuthorMeta
        users={item.users} createdAt={item.created_at}
        secondaryLabel={`Event \u00b7 ${item.is_online ? 'Online' : item.location ?? 'Offline'}`}
        right={
          <Pressable style={optStyles.btn} onPress={() => setMenuVisible(true)}>
            <Feather name="more-horizontal" size={16} color={colors.mutedForeground} />
          </Pressable>
        }
      />

      <View style={styles.eventBody}>
        {item.cover_image_url ? (
          <Image source={{ uri: item.cover_image_url }} style={styles.eventCover} resizeMode="cover" />
        ) : (
          <View style={[styles.eventCover, styles.eventGradient, { backgroundColor: g1 }]}>
            <Feather name="calendar" size={32} color="rgba(255,255,255,0.6)" />
          </View>
        )}

        <View style={styles.eventContent}>
          <View style={styles.eventTitleRow}>
            <Text style={[styles.eventTitle, { color: colors.foreground, flex: 1 }]} numberOfLines={2}>{item.title}</Text>
            <View style={[styles.eventBadge, isPast ? { backgroundColor: colors.muted } : { backgroundColor: '#10b98125' }]}>
              <Text style={[styles.eventBadgeText, isPast ? { color: colors.mutedForeground } : { color: '#10b981' }]}>
                {isPast ? 'Past' : 'Upcoming'}
              </Text>
            </View>
          </View>

          {item.description ? (
            <Text style={[styles.eventDesc, { color: colors.mutedForeground }]} numberOfLines={2}>{item.description}</Text>
          ) : null}

          <View style={styles.eventMeta}>
            <View style={styles.eventMetaRow}>
              <Feather name="calendar" size={13} color={colors.primary} />
              <Text style={[styles.eventMetaText, { color: colors.mutedForeground }]}>{formatEventDateTime(item.event_date)}</Text>
            </View>
            <View style={styles.eventMetaRow}>
              {item.is_online ? <Feather name="video" size={12} color={colors.mutedForeground} /> : <Feather name="map-pin" size={12} color={colors.mutedForeground} />}
              <Text style={[styles.eventMetaText, { color: colors.mutedForeground }]}>{item.is_online ? 'Online' : item.location ?? 'Offline'}</Text>
            </View>
          </View>

          <View style={styles.eventBottom}>
            <View style={styles.eventBottomLeft}>
              <Text style={[styles.eventHostedLabel, { color: colors.foregroundSoft }]}>Hosted by</Text>
              <Text style={[styles.eventHostName, { color: colors.foreground }]} numberOfLines={1}>{item.users?.name ?? 'Unknown'}</Text>
            </View>
            <View style={styles.rsvpBadge}>
              <Feather name="users" size={13} color={colors.mutedForeground} />
              <Text style={[styles.rsvpText, { color: colors.mutedForeground }]}>{item.rsvp_count} {item.rsvp_count === 1 ? 'person' : 'people'} going</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <View style={styles.footerLeft}>
          <Pressable style={styles.stat} onPress={handleLike}>
            {item.user_liked ? <AntDesign name="heart" size={20} color="#ef4444" /> : <Feather name="heart" size={20} color={colors.foreground} />}
            <Text style={[styles.statCount, { color: item.user_liked ? '#ef4444' : colors.foreground }]}>{item.like_count}</Text>
          </Pressable>
        </View>
        <CommunityPostLabel name={item.community_name} />
      </View>

      <OptionsMenu visible={menuVisible} onClose={() => setMenuVisible(false)} items={[
        { label: item.user_saved ? 'Unsave' : 'Save', icon: 'bookmark', onPress: handleSave },
        ...(isOwner ? [{ label: 'Edit', icon: 'edit-2', onPress: () => {} }] : []),
        ...(isOwner ? [{ label: 'Delete', icon: 'trash-2', destructive: true as const, onPress: handleDelete }] : []),
        ...(!isOwner ? [{ label: 'Report', icon: 'flag', destructive: true as const, onPress: handleReport }] : []),
      ]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Resource card
// ---------------------------------------------------------------------------

function ResourceCard({ item }: { item: FeedResource }) {
  const colors = useColors();
  const { user } = useAuth();
  const { refetch } = useFeed();
  const [menuVisible, setMenuVisible] = useState(false);
  const isOwner = user?.id === item.user_id;
  const typeLabel = RESOURCE_TYPE_LABELS[item.resource_type] ?? item.resource_type;
  const [ogImage, setOgImage] = useState<string | null>(null);

  const figmaLink = parseFigmaUrl(item.url);
  const figmaEmbedUrl = getFigmaEmbedUrl(item.url);
  const isFigmaPrototype = figmaLink?.kind === 'prototype';

  useEffect(() => {
    if (isFigmaPrototype) return;
    let cancelled = false;
    getLinkPreviewImage(item.url).then((img) => { if (!cancelled) setOgImage(img); });
    return () => { cancelled = true; };
  }, [item.url, isFigmaPrototype]);

  const handleSave = useCallback(async () => {
    try { await toggleFeedSave(item); refetch(); } catch { /* ignore */ }
  }, [item, refetch]);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete resource?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteFeedItem(item); refetch(); } catch { /* ignore */ }
      }},
    ]);
  }, [item, refetch]);

  const handleReport = useCallback(async () => {
    try { await reportFeedItem(item); Alert.alert('Reported', 'Thanks for your report.'); } catch { /* ignore */ }
  }, [item]);

  const handleLike = useCallback(async () => {
    try { await toggleFeedLike(item); refetch(); } catch { /* ignore */ }
  }, [item, refetch]);

  const openFigma = useCallback(() => {
    WebBrowser.openBrowserAsync(item.url);
  }, [item.url]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <PostAuthorMeta
        users={item.users} createdAt={item.created_at}
        secondaryLabel={`Resources \u00b7 ${typeLabel}`}
        right={
          <Pressable style={optStyles.btn} onPress={() => setMenuVisible(true)}>
            <Feather name="more-horizontal" size={16} color={colors.mutedForeground} />
          </Pressable>
        }
      />

      <View style={styles.body}>
        <Text style={[styles.resourceTitle, { color: colors.foreground }]} numberOfLines={3}>{item.description || item.title}</Text>

        {isFigmaPrototype ? (
          <Pressable style={[styles.figmaPreview, { backgroundColor: colors.muted + '20', borderColor: colors.border }]} onPress={openFigma}>
            <View style={styles.figmaIconRow}>
              <View style={[styles.figmaIconBg, { backgroundColor: '#a259ff' }]}>
                <Text style={styles.figmaIconText}>F</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.figmaLabel, { color: colors.foreground }]}>Figma prototype</Text>
                <Text style={[styles.figmaSublabel, { color: colors.mutedForeground }]}>Tap to open interactive preview</Text>
              </View>
              <Feather name="external-link" size={16} color={colors.primary} />
            </View>
          </Pressable>
        ) : ogImage ? (
          <Image source={{ uri: ogImage }} style={styles.ogImage} resizeMode="contain" />
        ) : null}

        <View style={[styles.domainPill, { borderColor: colors.border }]}>
          <Feather name="external-link" size={11} color={colors.mutedForeground} />
          <Text style={[styles.domainText, { color: colors.mutedForeground }]} numberOfLines={1}>{getDomain(item.url)}</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <Pressable style={styles.stat} onPress={handleLike}>
            {item.user_liked ? <AntDesign name="heart" size={20} color="#ef4444" /> : <Feather name="heart" size={20} color={colors.foreground} />}
            <Text style={[styles.statCount, { color: item.user_liked ? '#ef4444' : colors.foreground }]}>{item.save_count}</Text>
          </Pressable>
        </View>
        <CommunityPostLabel name={item.community_name} />
      </View>

      <OptionsMenu visible={menuVisible} onClose={() => setMenuVisible(false)} items={[
        { label: item.user_saved ? 'Unsave' : 'Save', icon: 'bookmark', onPress: handleSave },
        ...(isOwner ? [{ label: 'Edit', icon: 'edit-2', onPress: () => {} }] : []),
        ...(isOwner ? [{ label: 'Delete', icon: 'trash-2', destructive: true as const, onPress: handleDelete }] : []),
        ...(!isOwner ? [{ label: 'Report', icon: 'flag', destructive: true as const, onPress: handleReport }] : []),
      ]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Showcase card
// ---------------------------------------------------------------------------

function ShowcaseCard({ item }: { item: FeedShowcase }) {
  const colors = useColors();
  const { user } = useAuth();
  const { refetch } = useFeed();
  const [menuVisible, setMenuVisible] = useState(false);
  const isOwner = user?.id === item.user_id;

  const handleSave = useCallback(async () => {
    try { await toggleFeedSave(item); refetch(); } catch { /* ignore */ }
  }, [item, refetch]);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete showcase?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteFeedItem(item); refetch(); } catch { /* ignore */ }
      }},
    ]);
  }, [item, refetch]);

  const handleReport = useCallback(async () => {
    try { await reportFeedItem(item); Alert.alert('Reported', 'Thanks for your report.'); } catch { /* ignore */ }
  }, [item]);

  const handleLike = useCallback(async () => {
    try { await toggleFeedLike(item); refetch(); } catch { /* ignore */ }
  }, [item, refetch]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <PostAuthorMeta
        users={item.users} createdAt={item.created_at}
        secondaryLabel={`Showcase \u00b7 ${SHOWCASE_TYPE_LABELS[item.post_type] ?? item.post_type}`}
        right={
          <Pressable style={optStyles.btn} onPress={() => setMenuVisible(true)}>
            <Feather name="more-horizontal" size={16} color={colors.mutedForeground} />
          </Pressable>
        }
      />

      <View style={styles.body}>
        <Text style={[styles.showcaseTitle, { color: colors.foreground }]} numberOfLines={2}>{item.title}</Text>
        <Text style={[styles.showcaseDesc, { color: colors.mutedForeground }]} numberOfLines={3}>{item.description}</Text>
        {item.image_url ? <Image source={{ uri: item.image_url }} style={styles.showcaseImage} resizeMode="cover" /> : null}
      </View>

      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <Pressable style={styles.stat} onPress={handleLike}>
            {item.user_liked ? <AntDesign name="heart" size={20} color="#ef4444" /> : <Feather name="heart" size={20} color={colors.foreground} />}
            <Text style={[styles.statCount, { color: item.user_liked ? '#ef4444' : colors.foreground }]}>{item.like_count}</Text>
          </Pressable>
          <View style={styles.stat}>
            <Feather name="message-circle" size={20} color={colors.foreground} />
            <Text style={[styles.statCount, { color: colors.foreground }]}>{item.comment_count}</Text>
          </View>
        </View>
        {item.project_url ? (
          <View style={styles.viewProject}>
            <Text style={[styles.viewProjectText, { color: colors.primary }]}>View project</Text>
            <Feather name="external-link" size={14} color={colors.primary} />
          </View>
        ) : (
          <CommunityPostLabel name={item.community_name} />
        )}
      </View>

      <OptionsMenu visible={menuVisible} onClose={() => setMenuVisible(false)} items={[
        { label: item.user_saved ? 'Unsave' : 'Save', icon: 'bookmark', onPress: handleSave },
        ...(isOwner ? [{ label: 'Edit', icon: 'edit-2', onPress: () => {} }] : []),
        ...(isOwner ? [{ label: 'Delete', icon: 'trash-2', destructive: true as const, onPress: handleDelete }] : []),
        ...(!isOwner ? [{ label: 'Report', icon: 'flag', destructive: true as const, onPress: handleReport }] : []),
      ]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main switcher
// ---------------------------------------------------------------------------

export function FeedCard({ item }: { item: FeedItem }) {
  switch (item._type) {
    case 'thread': return <ThreadCard item={item} />;
    case 'event': return <EventCard item={item} />;
    case 'resource': return <ResourceCard item={item} />;
    case 'showcase': return <ShowcaseCard item={item} />;
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const optStyles = StyleSheet.create({
  btn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
});

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  body: { paddingHorizontal: 20, paddingTop: 12, gap: 6 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'transparent' },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statCount: { fontFamily: 'Geist_500Medium', fontSize: 14 },

  // Thread
  threadTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 14, lineHeight: 20 },
  threadDesc: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 18, marginTop: 2 },
  threadImgSingle: { marginTop: 8, borderRadius: 10, overflow: 'hidden' },
  threadImgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginTop: 8, borderRadius: 10, overflow: 'hidden' },
  threadImgFull: { width: '100%', height: 240 },
  threadImgHalf: { width: '49.8%', height: 160 },

  // Event
  eventBody: { flexDirection: 'row', marginHorizontal: 20, marginTop: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', minHeight: 140 },
  eventCover: { width: 120, minHeight: 140 },
  eventGradient: { alignItems: 'center', justifyContent: 'center' },
  eventContent: { flex: 1, padding: 12, gap: 4 },
  eventTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  eventTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 14, lineHeight: 20 },
  eventDesc: { fontFamily: 'Geist_400Regular', fontSize: 12, lineHeight: 16, marginTop: 2 },
  eventMeta: { marginTop: 6, gap: 3 },
  eventMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  eventMetaText: { fontFamily: 'Geist_400Regular', fontSize: 11, lineHeight: 14 },
  eventBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  eventBottomLeft: { flex: 1 },
  eventHostedLabel: { fontFamily: 'Geist_400Regular', fontSize: 10 },
  eventHostName: { fontFamily: 'Geist_600SemiBold', fontSize: 12, marginTop: 1 },
  rsvpBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rsvpText: { fontFamily: 'Geist_400Regular', fontSize: 11 },
  eventBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  eventBadgeText: { fontFamily: 'Geist_600SemiBold', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Resource
  resourceTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 14, lineHeight: 20 },
  ogImage: { width: '100%', height: 200, borderRadius: 10, marginTop: 4, backgroundColor: 'rgba(255,255,255,0.05)' },
  domainPill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, marginTop: 4 },
  domainText: { fontFamily: 'Geist_400Regular', fontSize: 12 },
  figmaPreview: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginTop: 4 },
  figmaIconRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  figmaIconBg: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  figmaIconText: { color: '#fff', fontFamily: 'Geist_700Bold', fontSize: 18 },
  figmaLabel: { fontFamily: 'Geist_600SemiBold', fontSize: 13 },
  figmaSublabel: { fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 1 },

  // Showcase
  showcaseTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15, lineHeight: 22 },
  showcaseDesc: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 18, marginTop: 2 },
  showcaseImage: { width: '100%', height: 200, borderRadius: 10, marginTop: 8 },
  viewProject: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  viewProjectText: { fontFamily: 'Geist_500Medium', fontSize: 13 },
});

const metaStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: 'Geist_700Bold', fontSize: 15 },
  textCol: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { fontFamily: 'Geist_500Medium', fontSize: 15 },
  date: { fontFamily: 'Geist_400Regular', fontSize: 11 },
  secondary: { fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 1 },
});

const labelStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { fontFamily: 'Geist_400Regular', fontSize: 11 },
  dot: { width: 14, height: 14, borderRadius: 7, marginHorizontal: 3 },
  name: { fontFamily: 'Geist_500Medium', fontSize: 11, maxWidth: 120 },
});
