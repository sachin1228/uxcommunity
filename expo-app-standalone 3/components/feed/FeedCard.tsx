import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { resolveProfilePictureUri } from '@/lib/profilePicture';
import type { FeedItem, FeedThread, FeedEvent, FeedResource, FeedShowcase } from '@/lib/feed';

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatEventDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const CATEGORY_COLORS: Record<string, string> = {
  question: '#3b82f6',
  discussion: '#8b5cf6',
  idea: '#f59e0b',
  feedback: '#10b981',
  referral: '#ec4899',
  collaboration: '#06b6d4',
};

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  figma: 'Figma',
  article: 'Article',
  tool: 'Tool',
  video: 'Video',
  book: 'Book',
  font: 'Font',
  icon_pack: 'Icons',
  color: 'Colors',
  template: 'Template',
  inspiration: 'Inspiration',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// Author row
// ---------------------------------------------------------------------------

function AuthorRow({ users, createdAt, right }: { users: FeedItem['users']; createdAt: string; right?: React.ReactNode }) {
  const colors = useColors();
  const avatarUri = resolveProfilePictureUri(users?.avatar_url);

  return (
    <View style={styles.authorRow}>
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.primarySoft }]}>
          <Text style={[styles.avatarText, { color: colors.primary }]}>
            {(users?.name ?? 'U')[0].toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.authorCopy}>
        <Text style={[styles.authorName, { color: colors.foreground }]} numberOfLines={1}>
          {users?.name ?? 'Unknown'}
        </Text>
        <Text style={[styles.authorMeta, { color: colors.mutedForeground }]}>{formatTime(createdAt)}</Text>
      </View>
      {right}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Thread card
// ---------------------------------------------------------------------------

function ThreadCard({ item }: { item: FeedThread }) {
  const colors = useColors();
  const catColor = CATEGORY_COLORS[item.category] ?? colors.mutedForeground;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <AuthorRow users={item.users} createdAt={item.created_at} />
      <View style={styles.cardBody}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>{item.title}</Text>
        {item.description ? (
          <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={3}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.tagRow}>
          <View style={[styles.badge, { backgroundColor: catColor + '20' }]}>
            <Text style={[styles.badgeText, { color: catColor }]}>{item.category}</Text>
          </View>
          {item.tags.slice(0, 2).map((tag) => (
            <View key={tag} style={[styles.badge, { backgroundColor: colors.muted }]}>
              <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>{tag}</Text>
            </View>
          ))}
        </View>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Feather name="heart" size={14} color={item.user_liked ? '#ef4444' : colors.mutedForeground} />
            <Text style={[styles.statText, { color: colors.mutedForeground }]}>{item.like_count}</Text>
          </View>
          <View style={styles.stat}>
            <Feather name="message-circle" size={14} color={colors.mutedForeground} />
            <Text style={[styles.statText, { color: colors.mutedForeground }]}>{item.comment_count}</Text>
          </View>
        </View>
      </View>
      {item.community_name ? (
        <View style={[styles.communityBar, { borderTopColor: colors.border }]}>
          <Text style={[styles.communityText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {item.community_name}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Event card
// ---------------------------------------------------------------------------

function EventCard({ item }: { item: FeedEvent }) {
  const colors = useColors();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <AuthorRow users={item.users} createdAt={item.created_at} />
      <View style={styles.cardBody}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>{item.title}</Text>
        {item.description ? (
          <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={3}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.tagRow}>
          <View style={[styles.badge, { backgroundColor: '#8b5cf620' }]}>
            <Feather name="calendar" size={12} color="#8b5cf6" />
            <Text style={[styles.badgeText, { color: '#8b5cf6' }]}>{formatEventDate(item.event_date)}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: item.is_online ? '#10b98120' : '#f59e0b20' }]}>
            <Text style={[styles.badgeText, { color: item.is_online ? '#10b981' : '#f59e0b' }]}>
              {item.is_online ? 'Online' : item.location ?? 'Offline'}
            </Text>
          </View>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Feather name="users" size={14} color={colors.mutedForeground} />
            <Text style={[styles.statText, { color: colors.mutedForeground }]}>{item.rsvp_count} RSVPs</Text>
          </View>
          <View style={styles.stat}>
            <Feather name="heart" size={14} color={item.user_liked ? '#ef4444' : colors.mutedForeground} />
            <Text style={[styles.statText, { color: colors.mutedForeground }]}>{item.like_count}</Text>
          </View>
        </View>
      </View>
      {item.community_name ? (
        <View style={[styles.communityBar, { borderTopColor: colors.border }]}>
          <Text style={[styles.communityText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {item.community_name}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Resource card
// ---------------------------------------------------------------------------

function ResourceCard({ item }: { item: FeedResource }) {
  const colors = useColors();
  const typeLabel = RESOURCE_TYPE_LABELS[item.resource_type] ?? item.resource_type;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <AuthorRow users={item.users} createdAt={item.created_at} />
      <View style={styles.cardBody}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>{item.title}</Text>
        {item.description ? (
          <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={3}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.tagRow}>
          <View style={[styles.badge, { backgroundColor: '#06b6d420' }]}>
            <Feather name="external-link" size={12} color="#06b6d4" />
            <Text style={[styles.badgeText, { color: '#06b6d4' }]}>{typeLabel}</Text>
          </View>
          {item.tags.slice(0, 2).map((tag) => (
            <View key={tag} style={[styles.badge, { backgroundColor: colors.muted }]}>
              <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>{tag}</Text>
            </View>
          ))}
        </View>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Feather name="bookmark" size={14} color={item.user_bookmarked ? '#f59e0b' : colors.mutedForeground} />
            <Text style={[styles.statText, { color: colors.mutedForeground }]}>{item.bookmark_count}</Text>
          </View>
          <View style={styles.stat}>
            <Feather name="heart" size={14} color={item.user_liked ? '#ef4444' : colors.mutedForeground} />
            <Text style={[styles.statText, { color: colors.mutedForeground }]}>{item.like_count}</Text>
          </View>
        </View>
      </View>
      {item.community_name ? (
        <View style={[styles.communityBar, { borderTopColor: colors.border }]}>
          <Text style={[styles.communityText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {item.community_name}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Showcase card
// ---------------------------------------------------------------------------

function ShowcaseCard({ item }: { item: FeedShowcase }) {
  const colors = useColors();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <AuthorRow users={item.users} createdAt={item.created_at} />
      <View style={styles.cardBody}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>{item.title}</Text>
        <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={3}>
          {item.description}
        </Text>
        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={styles.showcaseImage} resizeMode="cover" />
        ) : null}
        <View style={styles.tagRow}>
          <View style={[styles.badge, { backgroundColor: '#ec489920' }]}>
            <Text style={[styles.badgeText, { color: '#ec4899' }]}>{item.post_type}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: colors.muted }]}>
            <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>{item.category}</Text>
          </View>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Feather name="heart" size={14} color={item.user_liked ? '#ef4444' : colors.mutedForeground} />
            <Text style={[styles.statText, { color: colors.mutedForeground }]}>{item.like_count}</Text>
          </View>
          <View style={styles.stat}>
            <Feather name="bookmark" size={14} color={item.user_saved ? '#f59e0b' : colors.mutedForeground} />
            <Text style={[styles.statText, { color: colors.mutedForeground }]}>{item.save_count}</Text>
          </View>
        </View>
      </View>
      {item.community_name ? (
        <View style={[styles.communityBar, { borderTopColor: colors.border }]}>
          <Text style={[styles.communityText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {item.community_name}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main card switcher
// ---------------------------------------------------------------------------

export function FeedCard({ item }: { item: FeedItem }) {
  switch (item._type) {
    case 'thread':
      return <ThreadCard item={item} />;
    case 'event':
      return <EventCard item={item} />;
    case 'resource':
      return <ResourceCard item={item} />;
    case 'showcase':
      return <ShowcaseCard item={item} />;
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingBottom: 0,
    gap: 10,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 13,
  },
  authorCopy: {
    flex: 1,
  },
  authorName: {
    fontFamily: 'Geist_500Medium',
    fontSize: 13,
  },
  authorMeta: {
    fontFamily: 'Geist_400Regular',
    fontSize: 11,
    marginTop: 1,
  },
  cardBody: {
    padding: 12,
    gap: 8,
  },
  title: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
  description: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontFamily: 'Geist_500Medium',
    fontSize: 11,
    textTransform: 'capitalize',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 2,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
  },
  communityBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  communityText: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
  },
  showcaseImage: {
    width: '100%',
    height: 160,
    borderRadius: 8,
  },
});
