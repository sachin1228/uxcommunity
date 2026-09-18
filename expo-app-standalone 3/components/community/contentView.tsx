import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { hapticSelection, hapticToggle } from '@/lib/haptics';
import { BooleanIntentCoalescer } from '@/lib/booleanIntentCoalescer';
import {
  CommunityContent,
  CommunityEvent,
  CommunityResource,
  CommunityShowcase,
  CommunityThread,
  ContentAction,
  ContentKind,
  collapsedBodyLines,
  contentAuthor,
  contentLabel,
  contentSecondaryLabel,
  formatRelativeDate,
  getLinkPreviewImage,
  setContentAction,
} from '@/lib/communityContent';
import { resolveProfilePictureUri } from '@/lib/profilePicture';
import { HeartIcon } from './HeartIcon';

/**
 * The community card, the card detail, and the optimistic interaction state
 * behind them — shared by the community tabs and the home feed so a thread card
 * behaves and looks identical in both places.
 */

// ---------------------------------------------------------------------------
// Action definitions
// ---------------------------------------------------------------------------

export interface ActionDefinition {
  action: ContentAction;
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  /** Item property holding the confirmed boolean state. */
  field: string;
  /** Item property holding the confirmed count (omitted for plain saves). */
  countField?: string;
  /** Frames the count as a sentence ("3 going") instead of a bare number. */
  countSuffix?: string;
  /**
   * Tint when active. Only the heart uses the web `--like` pink; everything
   * else lights up in the accent colour, as it does on the web.
   */
  activeColor?: 'like' | 'accent';
}

/**
 * Every interaction a card can render, keyed by action. This table is the only
 * place the four API shapes are reconciled.
 */
const LIKE: ActionDefinition = { action: 'like', icon: 'heart', label: 'Like', field: 'user_liked', countField: 'like_count', activeColor: 'like' };
const SAVE: ActionDefinition = { action: 'save', icon: 'bookmark', label: 'Save', field: 'user_saved', activeColor: 'accent' };
const RSVP: ActionDefinition = { action: 'rsvp', icon: 'check-circle', label: 'Going', field: 'user_rsvped', countField: 'rsvp_count', countSuffix: 'going', activeColor: 'accent' };
/** The resource heart is the API's `save`, exactly as on the web. */
const RESOURCE_LIKE: ActionDefinition = { action: 'save', icon: 'heart', label: 'Like', field: 'user_saved', countField: 'save_count', activeColor: 'like' };
/** The resource menu's "Save"/"Unsave" rows are the API's bookmark. */
const BOOKMARK: ActionDefinition = { action: 'bookmark', icon: 'bookmark', label: 'Save', field: 'user_bookmarked', activeColor: 'accent' };

/**
 * What the card footer shows, per kind — the web cards keep the footer to the
 * heart and the comment count and move everything else into the ··· menu.
 * (Events additionally keep their RSVP there: the web shows it as its own wide
 * call-to-action, which the mobile footer stands in for.)
 */
export const FOOTER_ACTIONS_BY_KIND: Record<ContentKind, ActionDefinition[]> = {
  threads: [LIKE],
  showcase: [LIKE],
  events: [LIKE, RSVP],
  resources: [RESOURCE_LIKE],
};

/** The save-shaped row the ··· menu offers, per kind (null when there is none). */
const MENU_ACTION_BY_KIND: Record<ContentKind, ActionDefinition | null> = {
  threads: SAVE,
  showcase: SAVE,
  events: SAVE,
  resources: BOOKMARK,
};

export function actionDefinition(kind: ContentKind, action: ContentAction): ActionDefinition | undefined {
  const all = [...FOOTER_ACTIONS_BY_KIND[kind], MENU_ACTION_BY_KIND[kind]].filter(Boolean) as ActionDefinition[];
  return all.find((entry) => entry.action === action);
}

function fieldOf(item: CommunityContent, field: string): unknown {
  return (item as unknown as Record<string, unknown>)[field];
}

// ---------------------------------------------------------------------------
// Optimistic interaction state
// ---------------------------------------------------------------------------

interface ActionOverride { value: boolean; count?: number }

export interface ContentActionsApi {
  action: (item: CommunityContent, kind: ContentKind, action: ContentAction) => void;
  isActive: (item: CommunityContent, kind: ContentKind, action: ContentAction) => boolean;
  countFor: (item: CommunityContent, kind: ContentKind, action: ContentAction) => number;
  commentCountFor: (item: CommunityContent) => number;
  setCommentCount: (itemId: string, total: number) => void;
  /** Drop every local override — used when the server sends fresh rows. */
  reset: () => void;
  /** Alert surfaced from a failed write, for screens that render their own toast. */
  lastError: string | null;
  clearError: () => void;
}

/**
 * Owns the optimistic state of every card interaction on a screen.
 *
 * Each interaction is coalesced by `BooleanIntentCoalescer`, so rapid taps
 * collapse into one idempotent desired-state write and a stale response can
 * never overwrite a newer intent. The community is read from the item, which
 * lets the home feed mix posts from many communities in one list.
 */
export function useContentActions(): ContentActionsApi {
  const [overrides, setOverrides] = useState<Record<string, ActionOverride>>({});
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [lastError, setLastError] = useState<string | null>(null);
  const coalescersRef = useRef(new Map<string, BooleanIntentCoalescer>());

  useEffect(() => {
    const coalescers = coalescersRef.current;
    return () => {
      coalescers.forEach((coalescer) => coalescer.dispose());
      coalescers.clear();
    };
  }, []);

  const action = useCallback(
    (item: CommunityContent, kind: ContentKind, actionName: ContentAction) => {
      const definition = actionDefinition(kind, actionName);
      if (!definition || !item.community_id) return;
      const overrideKey = `${kind}:${item.id}:${actionName}`;
      const initial = Boolean(fieldOf(item, definition.field));
      const initialCount = definition.countField
        ? Number(fieldOf(item, definition.countField) ?? 0)
        : 0;

      let coalescer = coalescersRef.current.get(overrideKey);
      if (!coalescer) {
        coalescer = new BooleanIntentCoalescer({
          initialValue: initial,
          onOptimisticChange: (desired) => {
            setOverrides((current) => {
              const previous = current[overrideKey]?.value ?? initial;
              const previousCount = current[overrideKey]?.count ?? initialCount;
              const count = definition.countField
                ? Math.max(0, previousCount + (desired === previous ? 0 : desired ? 1 : -1))
                : undefined;
              return { ...current, [overrideKey]: { value: desired, count } };
            });
          },
          persist: async (desired) => {
            const result = await setContentAction(
              item.community_id,
              kind,
              item.id,
              actionName,
              desired,
            );
            if (typeof result.count === 'number') {
              setOverrides((current) => ({
                ...current,
                [overrideKey]: { value: result.value, count: result.count },
              }));
            }
            return result.value;
          },
          onError: (error) => {
            setLastError(error instanceof Error ? error.message : 'Please try again.');
          },
        });
        coalescersRef.current.set(overrideKey, coalescer);
      }

      coalescer.toggle();
    },
    [],
  );

  const isActive = useCallback(
    (item: CommunityContent, kind: ContentKind, actionName: ContentAction): boolean => {
      const override = overrides[`${kind}:${item.id}:${actionName}`];
      if (override) return override.value;
      const definition = actionDefinition(kind, actionName);
      return definition ? Boolean(fieldOf(item, definition.field)) : false;
    },
    [overrides],
  );

  const countFor = useCallback(
    (item: CommunityContent, kind: ContentKind, actionName: ContentAction): number => {
      const definition = actionDefinition(kind, actionName);
      if (!definition?.countField) return 0;
      const override = overrides[`${kind}:${item.id}:${actionName}`];
      if (override && typeof override.count === 'number') return override.count;
      return Number(fieldOf(item, definition.countField) ?? 0);
    },
    [overrides],
  );

  const commentCountFor = useCallback(
    (item: CommunityContent): number => {
      const local = commentCounts[item.id];
      if (typeof local === 'number') return local;
      return Number((item as { comment_count?: number }).comment_count ?? 0);
    },
    [commentCounts],
  );

  const setCommentCount = useCallback(
    (itemId: string, total: number) =>
      setCommentCounts((current) => ({ ...current, [itemId]: total })),
    [],
  );

  const reset = useCallback(() => {
    setOverrides({});
    setCommentCounts({});
  }, []);

  return {
    action,
    isActive,
    countFor,
    commentCountFor,
    setCommentCount,
    reset,
    lastError,
    clearError: useCallback(() => setLastError(null), []),
  };
}

// ---------------------------------------------------------------------------
// Resource link preview
// ---------------------------------------------------------------------------

const previewCache = new Map<string, string | null>();

export function useResourcePreview(url?: string) {
  const [image, setImage] = useState<string | null>(
    () => (url && previewCache.has(url) ? previewCache.get(url) ?? null : null),
  );
  useEffect(() => {
    if (!url || previewCache.has(url)) return;
    let active = true;
    getLinkPreviewImage(url)
      .then((result) => { previewCache.set(url, result); if (active) setImage(result); })
      .catch(() => previewCache.set(url, null));
    return () => { active = false; };
  }, [url]);
  return image;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface ContentCardProps {
  item: CommunityContent;
  kind: ContentKind;
  currentUserId: string;
  actions: ContentActionsApi;
  /** Feed cards show which community the post came from. */
  communityName?: string | null;
  communityImage?: string | null;
  onOpen: (item: CommunityContent) => void;
  onComments: (item: CommunityContent) => void;
  onEdit?: (item: CommunityContent) => void;
  onDelete?: (item: CommunityContent) => void;
}

export function ContentCard({
  item,
  kind,
  currentUserId,
  actions,
  communityName,
  communityImage,
  onOpen,
  onComments,
  onEdit,
  onDelete,
}: ContentCardProps) {
  const colors = useColors();
  const thread = kind === 'threads' ? item as CommunityThread : null;
  const event = kind === 'events' ? item as CommunityEvent : null;
  const resource = kind === 'resources' ? item as CommunityResource : null;
  const showcase = kind === 'showcase' ? item as CommunityShowcase : null;
  const author = contentAuthor(item);
  const images = (thread?.attachments ?? showcase?.attachments ?? [])
    .filter((attachment) => attachment.type.startsWith('image/'));
  const previewImage = useResourcePreview(resource?.url);
  const coverImage = event?.cover_image_url ?? showcase?.image_url ?? (resource ? previewImage : null);
  const isOwner = item.user_id === currentUserId;

  // The body text each kind puts on its card, mirroring the web cards: a thread
  // shows its title (which carries the whole post) collapsed behind "Read more",
  // an event shows a 2-line title plus a collapsible description, a resource
  // clamps its description to 3 lines, and a showcase title is never clamped.
  const primaryBody = resource ? resource.description || resource.title : item.title;
  const secondaryBody = kind === 'events' ? item.description : null;
  const primaryLines =
    kind === 'threads' ? collapsedBodyLines(kind, item)
      : kind === 'events' ? 2
        : kind === 'resources' ? 3
          : undefined;

  return (
    <Pressable
      onPress={() => onOpen(item)}
      style={[styles.card, { backgroundColor: colors.surface, shadowColor: '#000' }]}
      accessibilityRole="button"
      accessibilityLabel={`View ${contentLabel(kind)}: ${item.title}`}
    >
      {coverImage ? <Image source={{ uri: coverImage }} style={styles.cover} /> : null}

      <View style={styles.cardBody}>
        {/* Author meta — name and relative date on one line, the category as
            the muted second line, exactly like the web `PostAuthorMeta`. */}
        <View style={styles.authorRow}>
          {resolveProfilePictureUri(author?.avatar_url) ? (
            <Image source={{ uri: resolveProfilePictureUri(author?.avatar_url)! }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.avatarText, { color: colors.foregroundMuted }]}>
                {(author?.name ?? 'M')[0].toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.authorCopy}>
            <View style={styles.authorLine}>
              <Text style={[styles.author, { color: colors.foreground }]} numberOfLines={1}>
                {author?.name ?? 'Community member'}
              </Text>
              <Text style={[styles.meta, { color: colors.foregroundSubtle }]} numberOfLines={1}>
                {formatRelativeDate(item.created_at)}
              </Text>
            </View>
            <Text style={[styles.secondaryLabel, { color: colors.foregroundSubtle }]} numberOfLines={1}>
              {contentSecondaryLabel(kind, item)}
            </Text>
          </View>
          <ContentOptionsMenu
            item={item}
            kind={kind}
            actions={actions}
            isOwner={isOwner}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </View>

        <CollapsibleBody
          text={primaryBody}
          textStyle={styles.cardTitle}
          collapsedLines={primaryLines}
          expandable={kind === 'threads'}
        />
        {secondaryBody ? (
          <CollapsibleBody text={secondaryBody} textStyle={styles.description} collapsedLines={2} />
        ) : null}
        {images.length ? <MediaGrid images={images} /> : null}

        {event ? (
          <View style={styles.eventMeta}>
            <Feather name={event.is_online ? 'video' : 'map-pin'} size={15} color={colors.accent} />
            <Text style={[styles.eventMetaText, { color: colors.foregroundMuted }]}>
              {event.is_online ? 'Online event' : event.location || 'Location to be announced'}
            </Text>
          </View>
        ) : null}

        <ContentActionRow
          item={item}
          kind={kind}
          actions={actions}
          commentCount={actions.commentCountFor(item)}
          onComments={onComments}
          communityName={communityName}
          communityImage={communityImage}
        />
      </View>
    </Pressable>
  );
}

export function ContentActionRow({
  item,
  kind,
  actions,
  commentCount,
  onComments,
  communityName,
  communityImage,
}: {
  item: CommunityContent;
  kind: ContentKind;
  actions: ContentActionsApi;
  commentCount: number;
  onComments: (item: CommunityContent) => void;
  /** Feed rows name the community the post came from, right-aligned like the web. */
  communityName?: string | null;
  communityImage?: string | null;
}) {
  const colors = useColors();
  const communityAvatar = resolveProfilePictureUri(communityImage);
  return (
    <View style={styles.actions}>
      {FOOTER_ACTIONS_BY_KIND[kind].map((definition) => {
        const active = actions.isActive(item, kind, definition.action);
        const count = actions.countFor(item, kind, definition.action);
        // Count-less actions toggle their verb instead of showing a number,
        // exactly like the web "Save" / "Unsave" buttons.
        const label = definition.countSuffix
          ? `${count} ${definition.countSuffix}`
          : definition.countField
            ? String(count)
            : active
              ? 'Unsave'
              : definition.label;
        return (
          <Action
            key={definition.action}
            icon={definition.icon}
            label={label}
            active={active}
            activeColor={definition.activeColor}
            accessibilityLabel={`${active ? 'Remove' : 'Add'} ${definition.label}`}
            onPress={() => {
              // Every footer action is a desired-state flip: the tick follows the
              // direction the tap is about to take.
              hapticToggle(!active);
              actions.action(item, kind, definition.action);
            }}
          />
        );
      })}
      <Action
        icon="message-circle"
        label={String(commentCount)}
        accessibilityLabel="Comments"
        onPress={() => {
          hapticSelection();
          onComments(item);
        }}
      />

      {/* Community attribution — the web keeps the engagement cluster on the
          left and puts "posted in <community>" at the bottom-right. */}
      {communityName ? (
        <View style={styles.communityLabel}>
          <Text style={[styles.communityLabelText, { color: colors.foregroundSubtle }]} numberOfLines={1}>
            posted in
          </Text>
          {communityAvatar ? (
            <Image source={{ uri: communityAvatar }} style={styles.communityLabelAvatar} />
          ) : (
            <View style={[styles.communityLabelAvatar, { backgroundColor: colors.surfaceRaised }]} />
          )}
          <Text
            style={[styles.communityLabelName, { color: colors.foregroundMuted }]}
            numberOfLines={1}
          >
            {communityName}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export function ContentDetail({
  item,
  kind,
  currentUserId,
  actions,
  communityName,
  visible,
  onClose,
  onComments,
  onEdit,
  onDelete,
}: {
  item: CommunityContent | null;
  kind: ContentKind;
  currentUserId: string;
  actions: ContentActionsApi;
  communityName?: string | null;
  visible: boolean;
  onClose: () => void;
  onComments: (item: CommunityContent) => void;
  onEdit?: (item: CommunityContent) => void;
  onDelete?: (item: CommunityContent) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const resource = kind === 'resources' ? (item as CommunityResource | null) : null;
  const previewImage = useResourcePreview(resource?.url);
  if (!item) return null;

  const thread = kind === 'threads' ? item as CommunityThread : null;
  const event = kind === 'events' ? item as CommunityEvent : null;
  const showcase = kind === 'showcase' ? item as CommunityShowcase : null;
  const author = contentAuthor(item);
  const images = (thread?.attachments ?? showcase?.attachments ?? [])
    .filter((attachment) => attachment.type.startsWith('image/'));
  const files = (thread?.attachments ?? []).filter((attachment) => !attachment.type.startsWith('image/'));
  const coverImage = event?.cover_image_url ?? showcase?.image_url ?? (resource ? previewImage : null);
  const description = thread ? threadDescription(thread.title, thread.description) : item.description;
  const isOwner = item.user_id === currentUserId;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.detailRoot, { backgroundColor: colors.background }]}>
        <View style={[styles.detailHeader, { paddingTop: insets.top + 8, borderBottomColor: colors.borderSubtle }]}>
          <Pressable onPress={onClose} style={styles.headerButton} accessibilityLabel="Back">
            <Feather name="arrow-left" size={25} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.detailHeaderTitle, { color: colors.foreground }]} numberOfLines={1}>
            {communityName ?? contentLabel(kind)}
          </Text>
          <ContentOptionsMenu
            item={item}
            kind={kind}
            actions={actions}
            isOwner={isOwner}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </View>

        <ScrollView contentContainerStyle={[styles.detailContent, { paddingBottom: insets.bottom + 32 }]}>
          {coverImage ? <Image source={{ uri: coverImage }} style={styles.detailCover} /> : null}

          <View style={styles.authorRow}>
            {resolveProfilePictureUri(author?.avatar_url) ? (
              <Image source={{ uri: resolveProfilePictureUri(author?.avatar_url)! }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.surfaceRaised }]}>
                <Text style={[styles.avatarText, { color: colors.foregroundMuted }]}>
                  {(author?.name ?? 'M')[0].toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.authorCopy}>
              <View style={styles.authorLine}>
                <Text style={[styles.author, { color: colors.foreground }]} numberOfLines={1}>
                  {author?.name ?? 'Community member'}
                </Text>
                <Text style={[styles.meta, { color: colors.foregroundSubtle }]} numberOfLines={1}>
                  {formatRelativeDate(item.created_at)}
                </Text>
              </View>
              <Text style={[styles.secondaryLabel, { color: colors.foregroundSubtle }]} numberOfLines={1}>
                {contentSecondaryLabel(kind, item)}
              </Text>
            </View>
          </View>

          <Text style={[styles.detailTitle, { color: colors.foreground }]}>{item.title}</Text>
          {description ? (
            <Text style={[styles.detailDescription, { color: colors.foregroundMuted }]}>{description}</Text>
          ) : null}
          {images.length ? <MediaGrid images={images} /> : null}

          {files.map((file) => (
            <Pressable
              key={file.url}
              onPress={() => Linking.openURL(file.url)}
              style={[styles.linkButton, { backgroundColor: colors.surfaceRaised }]}
            >
              <Feather name="paperclip" size={16} color={colors.accent} />
              <Text style={[styles.linkText, { color: colors.accent }]} numberOfLines={1}>{file.name}</Text>
            </Pressable>
          ))}

          {event ? (
            <View style={[styles.detailPanel, { backgroundColor: colors.surfaceRaised }]}>
              <DetailRow icon="calendar" text={new Date(event.event_date).toLocaleString()} />
              <DetailRow
                icon={event.is_online ? 'video' : 'map-pin'}
                text={event.is_online ? 'Online event' : event.location || 'Location to be announced'}
              />
              {event.meet_link ? (
                <Pressable
                  onPress={() => Linking.openURL(event.meet_link!)}
                  style={[styles.linkButton, { backgroundColor: colors.surface }]}
                >
                  <Feather name="video" size={16} color={colors.accent} />
                  <Text style={[styles.linkText, { color: colors.accent }]}>Open meeting link</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {resource ? (
            <Pressable
              onPress={() => Linking.openURL(resource.url)}
              style={[styles.primaryLink, { backgroundColor: colors.accent }]}
            >
              <Feather name="external-link" size={17} color={colors.accentForeground} />
              <Text style={[styles.primaryLinkText, { color: colors.accentForeground }]}>Open resource</Text>
            </Pressable>
          ) : null}

          <ContentActionRow
            item={item}
            kind={kind}
            actions={actions}
            commentCount={actions.commentCountFor(item)}
            onComments={onComments}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * The ··· menu.
 *
 * Mirrors the web dropdown: Save/Unsave first (available to everyone — this is
 * where saving lives, it is deliberately not in the footer), then Edit and
 * Delete for the author.
 */
export function ContentOptionsMenu({
  item,
  kind,
  actions,
  isOwner,
  onEdit,
  onDelete,
}: {
  item: CommunityContent;
  kind: ContentKind;
  actions: ContentActionsApi;
  isOwner: boolean;
  onEdit?: (item: CommunityContent) => void;
  onDelete?: (item: CommunityContent) => void;
}) {
  const colors = useColors();
  const [visible, setVisible] = useState(false);
  const saveAction = MENU_ACTION_BY_KIND[kind];
  const saved = saveAction ? actions.isActive(item, kind, saveAction.action) : false;

  return (
    <>
      <Pressable
        onPress={(event) => {
          event.stopPropagation();
          hapticSelection();
          setVisible(true);
        }}
        style={styles.menuButton}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Post options"
      >
        <Feather name="more-vertical" size={21} color={colors.foregroundSubtle} />
      </Pressable>

      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setVisible(false)} accessibilityLabel="Close post options">
          <View style={[styles.optionsSheet, { backgroundColor: colors.overlayElevated, shadowColor: '#000' }]}>
            {saveAction ? (
              <Pressable
                onPress={() => {
                  hapticToggle(!saved);
                  setVisible(false);
                  actions.action(item, kind, saveAction.action);
                }}
                style={styles.optionRow}
                accessibilityRole="button"
                accessibilityState={{ selected: saved }}
              >
                <Feather
                  name={saveAction.icon}
                  size={16}
                  color={saved ? colors.accent : colors.foregroundMuted}
                />
                <Text style={[styles.optionText, { color: saved ? colors.accent : colors.foreground }]}>
                  {saved ? 'Unsave' : 'Save'}
                </Text>
              </Pressable>
            ) : null}

            {isOwner && onEdit && onDelete ? (
              <>
                <View style={[styles.optionDivider, { backgroundColor: colors.borderSubtle }]} />
                <Pressable
                  onPress={() => {
                    hapticSelection();
                    setVisible(false);
                    onEdit(item);
                  }}
                  style={styles.optionRow}
                  accessibilityRole="button"
                >
                  <Feather name="edit-2" size={16} color={colors.foreground} />
                  <Text style={[styles.optionText, { color: colors.foreground }]}>Edit</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    hapticSelection();
                    setVisible(false);
                    onDelete(item);
                  }}
                  style={styles.optionRow}
                  accessibilityRole="button"
                >
                  <Feather name="trash-2" size={16} color={colors.destructive} />
                  <Text style={[styles.optionText, { color: colors.destructive }]}>Delete</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * Card body text, collapsed to `collapsedLines` behind a "Read more" — the
 * mobile equivalent of the web `TruncateMarkup` + inline Read more button.
 */
export function CollapsibleBody({
  text,
  textStyle,
  collapsedLines,
  expandable = true,
}: {
  text: string | null | undefined;
  textStyle: React.ComponentProps<typeof Text>['style'];
  /** Omit to render the text in full — no clamp and no "Read more". */
  collapsedLines?: number;
  /** False renders a plain clamp with no affordance (web resource cards). */
  expandable?: boolean;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);

  if (!text) return null;

  return (
    <View>
      <Text
        style={[textStyle, { color: colors.foreground }]}
        numberOfLines={expanded || !collapsedLines ? undefined : collapsedLines}
        onTextLayout={(event) => {
          if (expanded || !collapsedLines) return;
          const lines = event.nativeEvent.lines.length;
          setTruncated(lines >= collapsedLines);
        }}
      >
        {text}
      </Text>
      {truncated && !expanded && expandable ? (
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            hapticSelection();
            setExpanded(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Read more"
          hitSlop={6}
        >
          <Text style={[styles.readMore, { color: colors.foregroundSubtle }]}>Read more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function MediaGrid({ images }: { images: Array<{ url: string }> }) {
  return (
    <View style={styles.imageGrid}>
      {images.slice(0, 4).map((image, index) => (
        <Pressable
          key={image.url}
          onPress={() => Linking.openURL(image.url)}
          style={images.length === 1 ? styles.imageSingle : styles.imageCell}
          accessibilityRole="button"
          accessibilityLabel="Open image"
        >
          <Image source={{ uri: image.url }} style={styles.threadImage} />
          {index === 3 && images.length > 4 ? (
            <View style={styles.moreImages}>
              <Text style={styles.moreImagesText}>+{images.length - 4}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function DetailRow({ icon, text }: { icon: React.ComponentProps<typeof Feather>['name']; text: string }) {
  const colors = useColors();
  return (
    <View style={styles.eventMeta}>
      <Feather name={icon} size={16} color={colors.accent} />
      <Text style={[styles.eventMetaText, { color: colors.foregroundMuted }]}>{text}</Text>
    </View>
  );
}

function Action({ icon, label, active, activeColor = 'accent', onPress, accessibilityLabel }: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  active?: boolean;
  activeColor?: 'like' | 'accent';
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const colors = useColors();
  // Inactive actions sit on the web's foreground-subtle, and the heart is the
  // only one that turns pink when it lights up.
  const tint = active
    ? activeColor === 'like'
      ? colors.like
      : colors.accent
    : colors.foregroundSubtle;
  return (
    <Pressable
      onPress={(event) => { event.stopPropagation(); onPress(); }}
      style={styles.action}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: Boolean(active) }}
    >
      {icon === 'heart' ? (
        <HeartIcon size={16} active={Boolean(active)} color={colors.foregroundSubtle} />
      ) : (
        <Feather name={icon} size={16} color={tint} />
      )}
      <Text style={[styles.actionText, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

function threadDescription(title: string, description: string | null) {
  const body = description?.trim();
  if (!body || body === title.trim()) return null;
  if (body.startsWith(`${title.trim()}\n`)) return body.slice(title.trim().length).trim() || null;
  return body;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    overflow: 'hidden',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cover: { width: '100%', height: 170 },
  cardBody: { padding: 14, gap: 11 },

  communityLabel: {
    flexShrink: 1,
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  communityLabelText: { fontFamily: 'Geist_500Medium', fontSize: 11 },
  communityLabelAvatar: { width: 16, height: 16, borderRadius: 8 },
  communityLabelName: { flexShrink: 1, fontFamily: 'Geist_500Medium', fontSize: 11 },

  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Geist_600SemiBold', fontSize: 13 },
  authorCopy: { flex: 1 },
  authorLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { flexShrink: 1, fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  meta: { fontSize: 11, fontFamily: 'Geist_600SemiBold' },
  secondaryLabel: { fontSize: 11, fontFamily: 'Geist_600SemiBold', marginTop: 1 },
  readMore: { marginTop: 2, fontSize: 13, fontFamily: 'Geist_500Medium' },

  menuButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  menuBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  optionsSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingVertical: 6,
    paddingBottom: 18,
    elevation: 12,
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
  },
  optionRow: { minHeight: 52, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 14 },
  optionText: { fontFamily: 'Geist_500Medium', fontSize: 15 },
  optionDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 18 },

  cardTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15, lineHeight: 21 },
  description: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19 },
  eventMeta: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  eventMetaText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 13 },
  linkButton: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkText: { flex: 1, fontFamily: 'Geist_500Medium', fontSize: 13 },

  // No divider above the footer: the web card runs the engagement row straight
  // off the body, separated by spacing alone.
  actions: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    // The web footer spaces the engagement cluster with gap-4 before the
    // right-aligned community attribution.
    gap: 16,
  },
  action: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { fontFamily: 'Geist_500Medium', fontSize: 12 },

  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, borderRadius: 12, overflow: 'hidden' },
  imageSingle: { width: '100%', height: 220 },
  imageCell: { width: '49.5%', height: 130 },
  threadImage: { width: '100%', height: '100%' },
  moreImages: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreImagesText: { color: '#FFFFFF', fontFamily: 'Geist_600SemiBold', fontSize: 22 },

  detailRoot: { flex: 1 },
  detailHeader: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  detailHeaderTitle: { flex: 1, fontFamily: 'Geist_600SemiBold', fontSize: 19 },
  detailContent: { padding: 18, gap: 16 },
  detailCover: { width: '100%', height: 230, borderRadius: 14 },
  detailTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 25, lineHeight: 32 },
  detailDescription: { fontFamily: 'Geist_400Regular', fontSize: 16, lineHeight: 25 },
  detailPanel: { borderRadius: 14, padding: 14, gap: 12 },
  primaryLink: {
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryLinkText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
});
