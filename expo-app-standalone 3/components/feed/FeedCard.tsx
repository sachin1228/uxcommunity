import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { resolveProfilePictureUri } from '@/lib/profilePicture';
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
  question: 'Question',
  discussion: 'Discussion',
  idea: 'Idea',
  feedback: 'Feedback',
  referral: 'Referral',
  collaboration: 'Collaboration',
};

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  figma: 'Figma',
  article: 'Article',
  tool: 'Tool',
  video: 'Video',
  book: 'Book',
  font: 'Font',
  icon_pack: 'Icon Pack',
  color: 'Color',
  template: 'Template',
  inspiration: 'Inspiration',
  other: 'Other',
};

const SHOWCASE_TYPE_LABELS: Record<string, string> = {
  finished: 'Finished work',
  wip: 'Work in progress',
  case_study: 'Case study',
  feedback: 'Looking for feedback',
};

const GRADIENTS = [
  ['#7c3aed', '#ec4899'],
  ['#2563eb', '#06b6d4'],
  ['#f97316', '#f43f5e'],
  ['#10b981', '#14b8a6'],
];

// ---------------------------------------------------------------------------
// PostAuthorMeta — matches web app exactly
// ---------------------------------------------------------------------------

function PostAuthorMeta({
  users,
  createdAt,
  secondaryLabel,
}: {
  users: FeedItem['users'];
  createdAt: string;
  secondaryLabel?: string;
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
          <Text style={[metaStyles.avatarInitial, { color: colors.primary }]}>
            {name[0].toUpperCase()}
          </Text>
        </View>
      )}
      <View style={metaStyles.textCol}>
        <View style={metaStyles.nameRow}>
          <Text style={[metaStyles.name, { color: colors.foreground }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[metaStyles.date, { color: colors.foregroundSoft }]}>{formatTime(createdAt)}</Text>
        </View>
        {secondaryLabel ? (
          <Text style={[metaStyles.secondary, { color: colors.foregroundSoft }]} numberOfLines={1}>
            {secondaryLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// CommunityPostLabel — "posted in CommunityName"
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

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <PostAuthorMeta
        users={item.users}
        createdAt={item.created_at}
        secondaryLabel={`Threads \u00b7 ${CATEGORY_LABELS[item.category] ?? item.category}`}
      />

      <View style={styles.body}>
        <Text style={[styles.threadTitle, { color: colors.foreground }]} numberOfLines={2}>
          {item.title}
        </Text>
        {item.description ? (
          <Text style={[styles.threadDesc, { color: colors.mutedForeground }]} numberOfLines={3}>
            {item.description}
          </Text>
        ) : null}
      </View>

      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <View style={styles.stat}>
            <Feather name="heart" size={20} color={item.user_liked ? '#ef4444' : colors.foreground} />
            <Text style={[styles.statCount, { color: item.user_liked ? '#ef4444' : colors.foreground }]}>
              {item.like_count}
            </Text>
          </View>
          <View style={styles.stat}>
            <Feather name="message-circle" size={20} color={colors.foreground} />
            <Text style={[styles.statCount, { color: colors.foreground }]}>
              {item.comment_count} {item.comment_count === 1 ? 'comment' : 'comments'}
            </Text>
          </View>
        </View>
        <CommunityPostLabel name={item.community_name} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Event card
// ---------------------------------------------------------------------------

function EventCard({ item }: { item: FeedEvent }) {
  const colors = useColors();
  const gradientIdx = item.id.charCodeAt(0) % GRADIENTS.length;
  const [g1, g2] = GRADIENTS[gradientIdx];

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <PostAuthorMeta
        users={item.users}
        createdAt={item.created_at}
        secondaryLabel={`Event \u00b7 ${item.is_online ? 'Online' : item.location ?? 'Offline'}`}
      />

      <View style={styles.eventBody}>
        {/* Cover image or gradient */}
        {item.cover_image_url ? (
          <Image source={{ uri: item.cover_image_url }} style={styles.eventCover} resizeMode="cover" />
        ) : (
          <View style={[styles.eventCover, styles.eventGradient, { backgroundColor: g1 }]}>
            <Feather name="calendar" size={32} color="rgba(255,255,255,0.6)" />
          </View>
        )}

        <View style={styles.eventContent}>
          <Text style={[styles.eventTitle, { color: colors.foreground }]} numberOfLines={2}>
            {item.title}
          </Text>
          {item.description ? (
            <Text style={[styles.eventDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}

          <View style={styles.eventMeta}>
            <View style={styles.eventMetaRow}>
              <Feather name="calendar" size={13} color={colors.primary} />
              <Text style={[styles.eventMetaText, { color: colors.mutedForeground }]}>
                {formatEventDateTime(item.event_date)}
              </Text>
            </View>
            <View style={styles.eventMetaRow}>
              {item.is_online ? (
                <Feather name="video" size={12} color={colors.mutedForeground} />
              ) : (
                <Feather name="map-pin" size={12} color={colors.mutedForeground} />
              )}
              <Text style={[styles.eventMetaText, { color: colors.mutedForeground }]}>
                {item.is_online ? 'Online' : item.location ?? 'Offline'}
              </Text>
            </View>
          </View>

          <View style={styles.eventBottom}>
            <View style={styles.eventBottomLeft}>
              <Text style={[styles.eventHostedLabel, { color: colors.foregroundSoft }]}>Hosted by</Text>
              <Text style={[styles.eventHostName, { color: colors.foreground }]} numberOfLines={1}>
                {item.users?.name ?? 'Unknown'}
              </Text>
            </View>
            <View style={styles.rsvpBadge}>
              <Feather name="users" size={13} color={colors.mutedForeground} />
              <Text style={[styles.rsvpText, { color: colors.mutedForeground }]}>
                {item.rsvp_count} {item.rsvp_count === 1 ? 'person' : 'people'} going
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Upcoming / Past badge */}
      <View style={[
        styles.eventBadge,
        new Date(item.event_date) > new Date()
          ? { backgroundColor: '#10b98125' }
          : { backgroundColor: colors.muted },
      ]}>
        <Text style={[
          styles.eventBadgeText,
          new Date(item.event_date) > new Date()
            ? { color: '#10b981' }
            : { color: colors.mutedForeground },
        ]}>
          {new Date(item.event_date) > new Date() ? 'Upcoming' : 'Past'}
        </Text>
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <View style={styles.footerLeft}>
          <View style={styles.stat}>
            <Feather name="heart" size={20} color={item.user_liked ? '#ef4444' : colors.foreground} />
            <Text style={[styles.statCount, { color: item.user_liked ? '#ef4444' : colors.foreground }]}>
              {item.like_count}
            </Text>
          </View>
        </View>
        <CommunityPostLabel name={item.community_name} />
      </View>
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
      <PostAuthorMeta
        users={item.users}
        createdAt={item.created_at}
        secondaryLabel={`Resources \u00b7 ${typeLabel}`}
      />

      <View style={styles.body}>
        <Text style={[styles.resourceTitle, { color: colors.foreground }]} numberOfLines={3}>
          {item.description || item.title}
        </Text>

        {/* Domain pill */}
        <View style={[styles.domainPill, { borderColor: colors.border }]}>
          <Feather name="external-link" size={11} color={colors.mutedForeground} />
          <Text style={[styles.domainText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {getDomain(item.url)}
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <View style={styles.stat}>
            <Feather name="heart" size={20} color={item.user_liked ? '#ef4444' : colors.foreground} />
            <Text style={[styles.statCount, { color: item.user_liked ? '#ef4444' : colors.foreground }]}>
              {item.save_count}
            </Text>
          </View>
        </View>
        <CommunityPostLabel name={item.community_name} />
      </View>
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
      <PostAuthorMeta
        users={item.users}
        createdAt={item.created_at}
        secondaryLabel={`Showcase \u00b7 ${SHOWCASE_TYPE_LABELS[item.post_type] ?? item.post_type}`}
      />

      <View style={styles.body}>
        <Text style={[styles.showcaseTitle, { color: colors.foreground }]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[styles.showcaseDesc, { color: colors.mutedForeground }]} numberOfLines={3}>
          {item.description}
        </Text>

        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={styles.showcaseImage} resizeMode="cover" />
        ) : null}
      </View>

      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <View style={styles.stat}>
            <Feather name="heart" size={20} color={item.user_liked ? '#ef4444' : colors.foreground} />
            <Text style={[styles.statCount, { color: item.user_liked ? '#ef4444' : colors.foreground }]}>
              {item.like_count}
            </Text>
          </View>
          <View style={styles.stat}>
            <Feather name="message-circle" size={20} color={colors.foreground} />
            <Text style={[styles.statCount, { color: colors.foreground }]}>
              {item.comment_count}
            </Text>
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

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 6,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statCount: {
    fontFamily: 'Geist_500Medium',
    fontSize: 14,
  },

  // Thread
  threadTitle: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
  },
  threadDesc: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },

  // Event
  eventBody: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    minHeight: 140,
  },
  eventCover: {
    width: 120,
    minHeight: 140,
  },
  eventGradient: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventContent: {
    flex: 1,
    padding: 12,
    gap: 4,
  },
  eventTitle: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
  },
  eventDesc: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  eventMeta: {
    marginTop: 6,
    gap: 3,
  },
  eventMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  eventMetaText: {
    fontFamily: 'Geist_400Regular',
    fontSize: 11,
    lineHeight: 14,
  },
  eventBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  eventBottomLeft: {
    flex: 1,
  },
  eventHostedLabel: {
    fontFamily: 'Geist_400Regular',
    fontSize: 10,
  },
  eventHostName: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 12,
    marginTop: 1,
  },
  rsvpBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rsvpText: {
    fontFamily: 'Geist_400Regular',
    fontSize: 11,
  },
  eventBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
  },
  eventBadgeText: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Resource
  resourceTitle: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
  },
  domainPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  domainText: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
  },

  // Showcase
  showcaseTitle: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 15,
    lineHeight: 22,
  },
  showcaseDesc: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  showcaseImage: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    marginTop: 8,
  },
  viewProject: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewProjectText: {
    fontFamily: 'Geist_500Medium',
    fontSize: 13,
  },
});

// ---------------------------------------------------------------------------
// PostAuthorMeta styles
// ---------------------------------------------------------------------------

const metaStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: 'Geist_700Bold',
    fontSize: 15,
  },
  textCol: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontFamily: 'Geist_500Medium',
    fontSize: 15,
    flex: 1,
  },
  date: {
    fontFamily: 'Geist_400Regular',
    fontSize: 11,
  },
  secondary: {
    fontFamily: 'Geist_400Regular',
    fontSize: 11,
    marginTop: 1,
  },
});

// ---------------------------------------------------------------------------
// CommunityPostLabel styles
// ---------------------------------------------------------------------------

const labelStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontFamily: 'Geist_400Regular',
    fontSize: 11,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginHorizontal: 3,
  },
  name: {
    fontFamily: 'Geist_500Medium',
    fontSize: 11,
    maxWidth: 120,
  },
});
