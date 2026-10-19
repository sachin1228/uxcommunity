import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { prepareImageForUpload } from '@/lib/prepareImage';
import { isVideoAsset, uploadShowcaseVideo } from '@/lib/showcaseVideo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  CommunityContent, ContentKind, LinkPreviewData, RESOURCE_TYPE_LABELS, SHOWCASE_CATEGORY_OPTIONS,
  SHOWCASE_MEDIA_MAX, THREAD_BODY_MAX_LENGTH, THREAD_CATEGORY_LABELS, THREAD_CATEGORY_OPTIONS,
  THREAD_IMAGE_MAX, ThreadAttachment, contentLabel, createCommunityContent,
  getLinkPreview, linkPreviewDomain, updateCommunityContent, uploadContentImage,
} from '@/lib/communityContent';
import {
  deviceOffsetMinutes,
  deviceTimeZone,
  wallClockInZone,
  wallClockToIso,
  zoneOffsetMinutes,
} from '@/lib/eventTimezone';
import {
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  POLL_QUESTION_MAX_LENGTH,
  emptyPollDraft,
  pollDraftFromPoll,
  pollOptionLetter,
  serializePollDraft,
  validatePollDraft,
  type ThreadPoll,
  type ThreadPollDraft,
} from '@/lib/communityPoll';
import { getCities, type CityOption } from '@/lib/cities';
import { getOwnProfile } from '@/lib/profile';
import { CityPickerSheet } from './CityPickerSheet';
import {
  EventDatePickerSheet,
  EventTimePickerSheet,
  addDaysToStamp,
  daysBetweenStamps,
  formatDateStamp,
  formatTimeValue,
} from './EventDateTimePicker';
import { DEFAULT_EVENT_ACCENT, EventAccentPicker } from './EventAccentPicker';

interface Props {
  visible: boolean;
  communityId: string;
  kind: ContentKind;
  item?: CommunityContent | null;
  onClose: () => void;
  onSaved: (item: CommunityContent) => void;
}

/** Category/detail chips per kind. Showcase categories are already labels. */
const OPTIONS: Record<string, readonly string[]> = {
  // The web composer and the API both accept only these four.
  threads: THREAD_CATEGORY_OPTIONS.map((option) => option.value),
  // Same order as the web `RESOURCE_TYPES`.
  resources: ['figma', 'article', 'tool', 'video', 'book', 'font', 'icon_pack', 'color', 'template', 'inspiration', 'other'],
  showcase: SHOWCASE_CATEGORY_OPTIONS.map((option) => option.value),
};

/** The icon beside each thread category — the web `CATEGORY_ICONS` set. */
const THREAD_CATEGORY_ICONS: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  question: 'help-circle',
  discussion: 'message-circle',
  idea: 'zap',
  feedback: 'thumbs-up',
};

/** The web `RESOURCE_TYPE_ICONS`, on Feather's glyphs. */
const RESOURCE_TYPE_ICONS: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  figma: 'pen-tool',
  article: 'file-text',
  tool: 'tool',
  video: 'play',
  book: 'book-open',
  font: 'type',
  icon_pack: 'layers',
  color: 'droplet',
  template: 'layout',
  inspiration: 'star',
  other: 'package',
};

/** The display label for one chip, whichever kind is composing. */
function optionLabel(kind: ContentKind, value: string): string {
  if (kind === 'threads') return THREAD_CATEGORY_LABELS[value] ?? value;
  if (kind === 'resources') return RESOURCE_TYPE_LABELS[value] ?? value;
  return SHOWCASE_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/** Kinds whose composer offers direct media uploads (showcase adds videos). */
const UPLOAD_KINDS: ContentKind[] = ['threads', 'showcase'];

/**
 * What an edited post already carries. Legacy showcase rows predate
 * `attachments` and hold only `image_url`, so that cover is treated as one
 * image attachment — otherwise editing one would silently drop its image on
 * save.
 */
function initialAttachments(kind: ContentKind, item: CommunityContent | null | undefined): ThreadAttachment[] {
  if (!item || !('attachments' in item)) return [];
  if (kind !== 'showcase') return item.attachments ?? [];
  if (item.attachments?.length) return item.attachments;
  return 'image_url' in item && item.image_url
    ? [{ name: item.title, url: item.image_url, type: 'image/jpeg', size: 0 }]
    : [];
}

const DEFAULT_TYPE: Partial<Record<ContentKind, string>> = {
  threads: 'question',
  showcase: 'product_design',
};

/** The web `ResourceFormModal` only previews URLs it can actually open. */
function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function CommunityContentEditor({ visible, communityId, kind, item, onClose, onSaved }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // Read once: a phone's zone doesn't change mid-compose, and this is the
  // value every label and hint is compared against.
  const [deviceZone] = useState(() => deviceTimeZone());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Thread composers build either a plain post or a poll, exactly like the web.
  const [tab, setTab] = useState<'post' | 'poll'>('post');
  const [pollDraft, setPollDraft] = useState<ThreadPollDraft | null>(null);
  // Threads start with no category — the author has to pick one, as on the web.
  const [type, setType] = useState<string | null>(DEFAULT_TYPE[kind] ?? null);
  const [tags, setTags] = useState('');
  const [url, setUrl] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [endTime, setEndTime] = useState('');
  // A legacy event whose end lands on a later day keeps that distance, so the
  // single date field (the web form's own shape) doesn't shorten it on save.
  const [endDayOffset, setEndDayOffset] = useState(0);
  // Which clock the typed times are read on. The web form has no zone field:
  // the phone's own zone is the reading, and it rides along with the event so
  // the card can show the host's clock to other members.
  const [hostZone, setHostZone] = useState<string | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [accentColor, setAccentColor] = useState(DEFAULT_EVENT_ACCENT);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [cityId, setCityId] = useState<string | null>(null);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePicker, setTimePicker] = useState<'start' | 'end' | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [location, setLocation] = useState('');
  const [meetLink, setMeetLink] = useState('');
  const [maxAttendees, setMaxAttendees] = useState('');
  const [allowReplies, setAllowReplies] = useState(true);
  const [isPublic, setIsPublic] = useState(false);
  const [attachments, setAttachments] = useState<ThreadAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  // The video currently in flight, e.g. "clip.mp4 — 42%" — videos are large
  // enough that a silent spinner reads as a hang.
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  // Resource URL metadata — the web composer's link preview card. Typing a
  // URL debounces into one lookup; a dismissed card stays down until the URL
  // changes again.
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDismissed, setPreviewDismissed] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUpload = UPLOAD_KINDS.includes(kind);
  const isShowcase = kind === 'showcase';
  const mediaLimit = isShowcase
    ? SHOWCASE_MEDIA_MAX
    : kind === 'threads'
      ? THREAD_IMAGE_MAX
      : 5;

  useEffect(() => {
    if (!visible) return;
    setTitle(item?.title ?? '');
    setDescription(
      kind === 'threads' && item
        ? threadToBody(item.title, item.description)
        : kind === 'resources' && item
          // The web resource form owns one description — legacy mobile rows
          // that only carry a title still open with their text.
          ? item.description || item.title
          : item?.description ?? '',
    );
    setTags('tags' in (item ?? {}) ? ((item as { tags: string[] }).tags ?? []).join(', ') : '');
    setIsPublic(Boolean(item?.is_public));
    setAttachments(initialAttachments(kind, item));
    setUploadStatus(null);
    setPreview(null);
    setPreviewLoading(false);
    setPreviewDismissed(false);
    setType(DEFAULT_TYPE[kind] ?? null);
    setTab('post');
    setPollDraft(null);

    if (kind === 'threads') {
      // A legacy mobile category (`referral` / `collaboration`) is not one the
      // web or the API accepts, so it comes back as "nothing chosen yet".
      const category = item && 'category' in item ? item.category : null;
      setType(
        THREAD_CATEGORY_OPTIONS.some((option) => option.value === category) ? category : null,
      );
      setAllowReplies(item && 'allow_replies' in item ? item.allow_replies ?? true : true);
      // Editing keeps the thread's type, as on the web: a poll edits its poll,
      // a post edits its text.
      const poll = item && 'poll' in item ? item.poll : null;
      if (poll) {
        setTab('poll');
        setPollDraft(pollDraftFromPoll(poll));
      }
    } else if (kind === 'resources') {
      // No default: the web form requires the author to pick a type.
      setType(item && 'resource_type' in item ? item.resource_type : null);
      setUrl(item && 'url' in item ? item.url : '');
      setAllowReplies(item && 'allow_replies' in item ? item.allow_replies ?? true : true);
    } else if (kind === 'showcase') {
      setType(item && 'category' in item ? item.category : 'product_design');
      setAllowReplies(item && 'allow_replies' in item ? item.allow_replies ?? true : true);
    } else {
      // The zone starts as the one the event was created in, and the phone's
      // own for a new event. Prefilling from anywhere else would read the times
      // back in another zone and shift the event on an untouched save.
      const zone = (item && 'host_timezone' in item ? item.host_timezone : null) || deviceZone;
      setHostZone(zone);
      const inZone = (iso: string | null | undefined) =>
        iso && zone ? wallClockInZone(iso, zone) : null;
      const startWall = item && 'event_date' in item
        ? inZone(item.event_date) ?? toLocalDateTime(item.event_date)
        : '';
      const endWall = item && 'end_date' in item && item.end_date
        ? inZone(item.end_date) ?? toLocalDateTime(item.end_date)
        : '';
      setEventDate(startWall ? startWall.slice(0, 10) : '');
      setEventTime(startWall ? startWall.slice(11, 16) : '');
      setEndTime(endWall ? endWall.slice(11, 16) : '');
      setEndDayOffset(
        startWall && endWall
          ? daysBetweenStamps(startWall.slice(0, 10), endWall.slice(0, 10))
          : 0,
      );
      setCoverImageUrl(item && 'cover_image_url' in item ? item.cover_image_url : null);
      setCoverUploading(false);
      setAccentColor(
        item && 'accent_color' in item && item.accent_color
          ? item.accent_color
          : DEFAULT_EVENT_ACCENT,
      );
      setCityId(item && 'city_id' in item ? item.city_id ?? null : null);
      setDatePickerOpen(false);
      setTimePicker(null);
      setCityPickerOpen(false);
      setIsOnline(Boolean(item && 'is_online' in item && item.is_online));
      setLocation(item && 'location' in item ? item.location ?? '' : '');
      setMeetLink(item && 'meet_link' in item ? item.meet_link ?? '' : '');
      setMaxAttendees(
        item && 'max_attendees' in item && item.max_attendees ? String(item.max_attendees) : '',
      );
    }
    setError(null);
  }, [item, kind, visible, deviceZone]);

  // The city list and, for a new event, the member's own city as the prefill —
  // the same two reads the web form makes when it opens.
  useEffect(() => {
    if (!visible || kind !== 'events') return;
    let cancelled = false;
    getCities()
      .then((list) => { if (!cancelled) setCities(list); })
      .catch(() => { /* The picker stays empty; the rest of the form works. */ });
    if (!item) {
      getOwnProfile()
        .then((profile) => {
          if (!cancelled) setCityId((current) => current ?? profile.profile?.cities?.id ?? null);
        })
        .catch(() => { /* City can still be picked by hand. */ });
    }
    return () => { cancelled = true; };
  }, [visible, kind, item]);

  const pickCover = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') return setError('Photo library permission is required.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets.length) return;
    setCoverUploading(true);
    setError(null);
    try {
      const asset = result.assets[0];
      // Animated GIFs pass through untouched — re-encoding flattens the
      // animation into a still frame, as the web upload also avoids.
      const isGif = (asset.mimeType ?? '').toLowerCase() === 'image/gif';
      const prepared = isGif
        ? {
            uri: asset.uri,
            name: asset.fileName ?? `event-cover-${Date.now()}.gif`,
            mimeType: 'image/gif',
          }
        : await prepareImageForUpload(asset, `event-cover-${Date.now()}`);
      const attachment = await uploadContentImage(communityId, 'events', {
        uri: prepared.uri,
        name: prepared.name,
        type: prepared.mimeType,
      });
      setCoverImageUrl(attachment.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the cover image.');
    } finally {
      setCoverUploading(false);
    }
  };

  // URL → metadata card, exactly the web composer's contract: only http(s)
  // URLs preview, typing debounces 700ms, and the in-flight lookup is dropped
  // the moment the URL changes or the editor closes.
  useEffect(() => {
    if (!visible || kind !== 'resources') {
      previewAbortRef.current?.abort();
      return;
    }
    const trimmed = url.trim();
    if (!isValidHttpUrl(trimmed)) {
      previewAbortRef.current?.abort();
      previewAbortRef.current = null;
      setPreview(null);
      setPreviewLoading(false);
      setPreviewDismissed(false);
      return;
    }
    setPreviewDismissed(false);
    const timer = setTimeout(() => {
      previewAbortRef.current?.abort();
      const controller = new AbortController();
      previewAbortRef.current = controller;
      setPreviewLoading(true);
      setPreview(null);
      getLinkPreview(trimmed, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setPreview(data);
        })
        // A preview is a bonus — a failed lookup leaves the card off.
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setPreviewLoading(false);
        });
    }, 700);
    return () => {
      clearTimeout(timer);
      previewAbortRef.current?.abort();
    };
  }, [url, visible, kind]);

  const pickMedia = async () => {
    const remaining = mediaLimit - attachments.length;
    if (remaining <= 0) {
      return setError(`You can add up to ${mediaLimit} ${isShowcase ? 'images or videos' : 'images'}.`);
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') return setError('Photo library permission is required.');
    const result = await ImagePicker.launchImageLibraryAsync({
      // The web showcase composer accepts images and videos; threads stay images.
      mediaTypes: isShowcase ? ['images', 'videos'] : ['images'],
      quality: 1,
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (result.canceled || !result.assets.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const asset of result.assets) {
        if (isShowcase && isVideoAsset(asset)) {
          const label = asset.fileName?.trim() || 'video';
          setUploadStatus(`Uploading ${label} — 0%`);
          const attachment = await uploadShowcaseVideo(communityId, asset, (percent) => {
            setUploadStatus(`Uploading ${label} — ${percent}%`);
          });
          setAttachments((current) => [...current, attachment]);
        } else {
          // Native WebP encode (quality 0.90, ≤ 2560px) — same contract as the web app.
          const prepared = await prepareImageForUpload(asset, `${kind}-image-${Date.now()}`);
          const attachment = await uploadContentImage(communityId, kind, {
            uri: prepared.uri,
            name: prepared.name,
            type: prepared.mimeType,
          });
          setAttachments((current) => [...current, attachment]);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload media.');
    } finally {
      setUploadStatus(null);
      setUploading(false);
    }
  };

  /** Switch the composer between a text post and a poll. */
  function selectTab(next: 'post' | 'poll') {
    setTab(next);
    // Seed the draft on first entry so the composer opens on the question.
    if (next === 'poll') setPollDraft((current) => current ?? emptyPollDraft());
  }

  const submit = async () => {
    const cleanTags = tags
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 3);
    const imageAttachments = attachments.filter((attachment) => attachment.type.startsWith('image/'));

    let body: Record<string, unknown>;
    if (kind === 'threads') {
      let threadTitle: string;
      let poll: ThreadPoll | null = null;

      if (tab === 'poll') {
        if (!pollDraft) return setError('Add a question for your poll.');
        const invalid = validatePollDraft(pollDraft);
        if (invalid) return setError(invalid);
        const serialized = serializePollDraft(pollDraft);
        const existingPoll = item && 'poll' in item ? item.poll : null;
        // Polls created as standalone posts use the question as the thread
        // text; keep any separate caption on older thread rows untouched.
        const pollIsContent = Boolean(
          item && existingPoll && item.title.trim() === existingPoll.question.trim(),
        );
        threadTitle = item && existingPoll && !pollIsContent ? item.title : serialized.question;
        poll = serialized;
      } else {
        if (!description.trim()) {
          return setError(item ? 'Write something before saving.' : 'Write something before posting.');
        }
        threadTitle = bodyToThread(description).title;
      }

      if (!type) return setError('Pick a category for your thread.');
      body = {
        title: threadTitle,
        category: type,
        tags: cleanTags,
        attachments,
        links: extractLinks(description),
        allow_replies: allowReplies,
        is_public: isPublic,
        poll,
      };
    } else if (kind === 'resources') {
      // Same contract as the web form: one description, the title derived
      // from it, and an explicitly chosen type.
      const trimmedDescription = description.trim();
      if (!trimmedDescription) return setError('Description is required.');
      if (!type) return setError('Pick a resource type.');
      if (!/^https?:\/\//i.test(url.trim())) {
        return setError('Enter a URL beginning with http:// or https://.');
      }
      body = {
        title: trimmedDescription.slice(0, 120),
        description: trimmedDescription,
        resource_type: type,
        url: url.trim(),
        is_public: isPublic,
        allow_replies: allowReplies,
      };
    } else if (kind === 'showcase') {
      if (!title.trim()) return setError('Add a title for your work.');
      if (!type) return setError('Pick a category.');
      body = {
        title: title.trim(),
        category: type,
        attachments,
        // The API derives the cover from the first image attachment.
        image_url: imageAttachments[0]?.url ?? '',
        is_public: isPublic,
        allow_replies: allowReplies,
      };
    } else {
      // The web form's field rules, in its own order: description, cover and
      // the schedule are required, and a public event must name its city.
      if (!title.trim()) return setError('Title is required.');
      if (!description.trim()) return setError('Description is required.');
      if (!coverImageUrl) return setError('Cover image is required.');
      if (!eventDate || !eventTime) return setError('Event date and time are required.');
      const zone = hostZone ?? deviceZone;
      const start = toInstant(`${eventDate} ${eventTime}`, zone);
      if (!start) return setError('Event start is not a valid time.');
      // An existing event whose start already passed stays editable — a
      // description fix must not require inventing a new date. Its date and
      // time fields are locked, so the start cannot move under this check.
      const storedStart = item && 'event_date' in item ? item.event_date : null;
      const startIsPast = storedStart ? new Date(storedStart).getTime() < Date.now() : false;
      const startMoved = !storedStart ||
        Math.abs(new Date(storedStart).getTime() - new Date(start).getTime()) >= 60_000;
      if (!startIsPast && startMoved && new Date(start).getTime() < Date.now() - 60_000) {
        return setError("Start time can't be in the past. Pick a time from now onward.");
      }
      if (!endTime) return setError('End time is required.');
      // The end rides the start's date — one date field covers both — with a
      // legacy multi-day end keeping its offset.
      const end = toInstant(`${addDaysToStamp(eventDate, endDayOffset)} ${endTime}`, zone);
      if (!end) return setError('End time is not a valid time.');
      if (new Date(end).getTime() <= new Date(start).getTime()) {
        return setError('End time must be after the start time.');
      }
      if (isPublic && !cityId) return setError('City is required.');
      body = {
        title: title.trim(),
        description: description.trim() || null,
        event_date: start,
        end_date: end,
        is_online: isOnline,
        location: location.trim() || null,
        meet_link: meetLink.trim() || null,
        city_id: cityId,
        max_attendees: maxAttendees ? Number(maxAttendees) : null,
        cover_image_url: coverImageUrl,
        accent_color: accentColor,
        is_public: isPublic,
        // The host's own side of the schedule, so a card can show the time
        // they actually set beside each member's reading of it.
        host_timezone: zone,
        host_utc_offset_minutes: startOffsetMinutes(start, zone),
      };
    }

    setSaving(true);
    setError(null);
    try {
      const saved = item
        ? await updateCommunityContent(communityId, kind, item.id, body)
        : await createCommunityContent(communityId, kind, body);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [
    styles.input,
    { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.borderSubtle },
  ];
  const choices = OPTIONS[kind] ?? [];
  const label = contentLabel(kind);

  // The web edit form locks the date and start of an event that has already
  // begun; everything else stays editable.
  const eventStartIsPast = Boolean(
    item && 'event_date' in item && new Date(item.event_date).getTime() < Date.now(),
  );
  const minEventDate = eventStartIsPast ? undefined : todayStamp();
  const selectedCity = cities.find((city) => city.id === cityId) ?? null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.root, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.borderSubtle }]}>
          <Pressable onPress={onClose} style={styles.iconButton} accessibilityLabel="Close editor">
            <Feather name="x" size={24} color={colors.foreground} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text
              style={[styles.title, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {item
                ? isShowcase ? 'Edit showcase' : `Edit ${label}`
                : isShowcase ? 'Share your work' : kind === 'resources' ? 'Share a Resource' : 'Create'}
            </Text>
            {kind === 'threads' || isShowcase || kind === 'resources' ? (
              <Text
                style={[styles.subtitle, { color: colors.foregroundMuted }]}
                numberOfLines={2}
              >
                {isShowcase
                  ? item
                    ? 'Update the details of your showcase post'
                    : 'Give the community a closer look at what you’re making'
                  : kind === 'resources'
                    ? item
                      ? 'Update the details of your resource.'
                      : 'Share something useful with your community.'
                    : item
                      ? 'Update the content, images, or privacy of this thread'
                      : 'Share your thoughts, ask a question, or start a discussion'}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={submit}
            disabled={saving || uploading}
            style={[styles.save, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator color={colors.accentForeground} />
            ) : (
              <Text style={[styles.saveText, { color: colors.accentForeground }]}>
                {item ? 'Save' : isShowcase ? 'Share' : kind === 'threads' ? 'Post' : 'Save'}
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

          {/* Create-only: a thread can be a post or a poll. Editing keeps the
              thread's existing type, so no tabs are needed there. */}
          {kind === 'threads' && !item ? (
            <ComposerTabs value={tab} onChange={selectTab} colors={colors} />
          ) : null}

          {isShowcase ? (
            <Field label="Title *">
              <View>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  style={[inputStyle, styles.multiline, styles.showcaseTitle]}
                  multiline
                  maxLength={THREAD_BODY_MAX_LENGTH}
                  textAlignVertical="top"
                  placeholder="What did you make? Walk us through it…"
                  placeholderTextColor={colors.foregroundSubtle}
                />
                <Text style={[styles.counter, { color: colors.foregroundSubtle }]}>
                  {title.length}/{THREAD_BODY_MAX_LENGTH}
                </Text>
              </View>
            </Field>
          ) : null}

          {kind === 'resources' ? (
            <>
              {/* The web resource form's exact fields and order: description,
                  type, URL, then the preview card the URL resolves to. */}
              <Field label="Description *">
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  style={[inputStyle, styles.multiline]}
                  multiline
                  maxLength={2000}
                  textAlignVertical="top"
                  placeholder="What makes this resource worth sharing?"
                  placeholderTextColor={colors.foregroundSubtle}
                />
              </Field>

              <Field label="Type *">
                <View style={styles.chips}>
                  {choices.map((choice) => {
                    const active = type === choice;
                    return (
                      <Pressable
                        key={choice}
                        onPress={() => setType(choice)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={[
                          styles.chip,
                          { backgroundColor: active ? colors.accentSoft : colors.surfaceRaised },
                        ]}
                      >
                        <Feather
                          name={RESOURCE_TYPE_ICONS[choice] ?? 'package'}
                          size={11}
                          color={active ? colors.foreground : colors.foregroundMuted}
                        />
                        <Text
                          style={[
                            styles.chipText,
                            { color: active ? colors.foreground : colors.foregroundMuted },
                          ]}
                        >
                          {optionLabel(kind, choice)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Field>

              <Field label="URL *">
                <View>
                  <TextInput
                    value={url}
                    onChangeText={setUrl}
                    style={[inputStyle, styles.urlInput]}
                    placeholder="https://..."
                    placeholderTextColor={colors.foregroundSubtle}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                  <View style={styles.urlAccessory} pointerEvents="none">
                    {previewLoading ? (
                      <ActivityIndicator size="small" color={colors.foregroundSubtle} />
                    ) : isValidHttpUrl(url) && !preview ? (
                      <Feather name="globe" size={14} color={colors.foregroundSubtle} />
                    ) : null}
                  </View>
                </View>
              </Field>

              {!previewDismissed && (previewLoading || preview) ? (
                previewLoading && !preview ? (
                  <View
                    style={[
                      styles.previewLoading,
                      { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
                    ]}
                  >
                    <ActivityIndicator size="small" color={colors.foregroundSubtle} />
                    <Text style={[styles.previewLoadingText, { color: colors.foregroundSubtle }]}>
                      Loading preview…
                    </Text>
                  </View>
                ) : preview ? (
                  <ResourceLinkPreview
                    data={preview}
                    colors={colors}
                    onDismiss={() => setPreviewDismissed(true)}
                  />
                ) : null
              ) : null}
            </>
          ) : null}

          {kind === 'threads' ? (
            tab === 'poll' ? (
              pollDraft ? (
                <PollComposer value={pollDraft} onChange={setPollDraft} colors={colors} />
              ) : null
            ) : (
              <Field label={null}>
                <View>
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    style={[inputStyle, styles.multiline, styles.threadBody]}
                    multiline
                    maxLength={THREAD_BODY_MAX_LENGTH}
                    textAlignVertical="top"
                    placeholder="What do you want to talk about?"
                    placeholderTextColor={colors.foregroundSubtle}
                  />
                  <Text style={[styles.counter, { color: colors.foregroundSubtle }]}>
                    {description.length}/{THREAD_BODY_MAX_LENGTH}
                  </Text>
                </View>
              </Field>
            )
          ) : null}

          {canUpload ? (
            <Field
              label={
                isShowcase
                  ? `Media — images & videos (up to ${mediaLimit})`
                  : `Images (up to ${mediaLimit})`
              }
            >
              <View style={styles.imageList}>
                {attachments.map((attachment) => {
                  const isVideo = attachment.type.startsWith('video/');
                  return (
                    <View key={attachment.url} style={styles.imagePreviewShell}>
                      {isVideo ? (
                        attachment.poster ? (
                          <Image source={{ uri: attachment.poster }} style={styles.imagePreview} />
                        ) : (
                          <View style={[styles.imagePreview, styles.videoTile]}>
                            <Feather name="film" size={20} color={colors.foregroundMuted} />
                          </View>
                        )
                      ) : (
                        <Image source={{ uri: attachment.url }} style={styles.imagePreview} />
                      )}
                      {isVideo ? (
                        <View style={styles.videoBadge}>
                          <Feather name="play" size={11} color="#FFFFFF" />
                        </View>
                      ) : null}
                      <Pressable
                        onPress={() =>
                          setAttachments((current) =>
                            current.filter((entry) => entry.url !== attachment.url),
                          )
                        }
                        style={[styles.removeImage, { backgroundColor: colors.surface }]}
                        accessibilityLabel={isVideo ? 'Remove video' : 'Remove image'}
                      >
                        <Feather name="x" size={16} color={colors.foreground} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
              <Pressable
                onPress={pickMedia}
                disabled={uploading || attachments.length >= mediaLimit}
                style={[styles.addImage, { backgroundColor: colors.surfaceRaised }]}
              >
                {uploading ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <Feather name="image" size={19} color={colors.accent} />
                )}
                <Text style={[styles.addImageText, { color: colors.accent }]} numberOfLines={1}>
                  {uploadStatus ??
                    (uploading
                      ? 'Uploading…'
                      : isShowcase
                        ? 'Add image or video'
                        : 'Add image')}
                </Text>
              </Pressable>
            </Field>
          ) : null}

          {choices.length && kind !== 'resources' ? (
            <Field label="Category *">
              <View style={styles.chips}>
                {choices.map((choice) => {
                  const active = type === choice;
                  return (
                    <Pressable
                      key={choice}
                      onPress={() => setType(choice)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.chip,
                        { backgroundColor: active ? colors.accentSoft : colors.surfaceRaised },
                      ]}
                    >
                      {kind === 'threads' ? (
                        <Feather
                          name={THREAD_CATEGORY_ICONS[choice] ?? 'message-circle'}
                          size={14}
                          color={active ? colors.foreground : colors.foregroundMuted}
                        />
                      ) : null}
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? colors.foreground : colors.foregroundMuted },
                        ]}
                      >
                        {optionLabel(kind, choice)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>
          ) : null}

          {kind === 'threads' || kind === 'resources' || isShowcase ? (
            <Toggle
              label="Allow replies"
              description={
                isShowcase
                  ? 'Other members can comment on this showcase.'
                  : kind === 'resources'
                    ? 'Other members can comment on this resource.'
                    : 'Other members can reply to this thread.'
              }
              value={allowReplies}
              onValueChange={setAllowReplies}
              colors={colors}
            />
          ) : null}

          {kind === 'events' ? (
            <>
              {/* The web form's exact fields and order: description, cover,
                  name, the schedule, type, place and cap, then the ticket's
                  color, visibility and city. */}
              <Field label="Description *">
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  style={[inputStyle, styles.multiline]}
                  multiline
                  maxLength={5000}
                  textAlignVertical="top"
                  placeholder="Tell people what to expect…"
                  placeholderTextColor={colors.foregroundSubtle}
                />
              </Field>

              <Field label="Cover image *">
                {coverImageUrl ? (
                  <View style={styles.coverPreviewWrap}>
                    <Image source={{ uri: coverImageUrl }} style={styles.coverPreview} />
                    <Pressable
                      onPress={() => setCoverImageUrl(null)}
                      style={styles.coverRemove}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Remove cover image"
                    >
                      <Feather name="x" size={14} color="#FFFFFF" />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={pickCover}
                    disabled={coverUploading}
                    style={[
                      styles.coverPick,
                      { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Upload a cover image"
                  >
                    {coverUploading ? (
                      <ActivityIndicator color={colors.accent} />
                    ) : (
                      <Feather name="image" size={20} color={colors.foregroundMuted} />
                    )}
                    <Text style={[styles.coverPickTitle, { color: colors.foregroundMuted }]}>
                      {coverUploading ? 'Uploading…' : 'Tap to upload a cover image'}
                    </Text>
                    <Text style={[styles.fieldHint, { color: colors.foregroundSubtle }]}>
                      JPEG, PNG, WebP, GIF or AVIF · max 5 MB
                    </Text>
                  </Pressable>
                )}
              </Field>

              <Field label="Event name *">
                <View>
                  <TextInput
                    value={title}
                    onChangeText={setTitle}
                    style={[inputStyle, styles.eventName]}
                    maxLength={120}
                    placeholder="What's the event called?"
                    placeholderTextColor={colors.foregroundSubtle}
                  />
                  <Text style={[styles.counter, { color: colors.foregroundSubtle }]}>
                    {title.length}/120
                  </Text>
                </View>
              </Field>

              <Field label="Date *">
                <Pressable
                  onPress={() => setDatePickerOpen(true)}
                  disabled={eventStartIsPast}
                  style={[
                    styles.input,
                    styles.pickerTrigger,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.borderSubtle,
                      opacity: eventStartIsPast ? 0.5 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={eventDate ? `Date, ${formatDateStamp(eventDate)}` : 'Select date'}
                  accessibilityState={{ disabled: eventStartIsPast }}
                >
                  <Feather name="calendar" size={16} color={colors.foregroundMuted} />
                  <Text
                    style={[
                      styles.pickerText,
                      { color: eventDate ? colors.foreground : colors.foregroundSubtle },
                    ]}
                    numberOfLines={1}
                  >
                    {eventDate ? formatDateStamp(eventDate) : 'Select date'}
                  </Text>
                </Pressable>
              </Field>

              <View style={styles.timeRow}>
                <View style={styles.timeHalf}>
                  <Field label="Start time *">
                    <Pressable
                      onPress={() => setTimePicker('start')}
                      disabled={eventStartIsPast}
                      style={[
                        styles.input,
                        styles.pickerTrigger,
                        {
                          backgroundColor: colors.inputBackground,
                          borderColor: colors.borderSubtle,
                          opacity: eventStartIsPast ? 0.5 : 1,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={eventTime ? `Start time, ${formatTimeValue(eventTime)}` : 'Select start time'}
                      accessibilityState={{ disabled: eventStartIsPast }}
                    >
                      <Feather name="clock" size={16} color={colors.foregroundMuted} />
                      <Text
                        style={[
                          styles.pickerText,
                          { color: eventTime ? colors.foreground : colors.foregroundSubtle },
                        ]}
                        numberOfLines={1}
                      >
                        {eventTime ? formatTimeValue(eventTime) : 'Select time'}
                      </Text>
                    </Pressable>
                  </Field>
                </View>
                <View style={styles.timeHalf}>
                  <Field label="End time *">
                    <Pressable
                      onPress={() => setTimePicker('end')}
                      style={[
                        styles.input,
                        styles.pickerTrigger,
                        { backgroundColor: colors.inputBackground, borderColor: colors.borderSubtle },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={endTime ? `End time, ${formatTimeValue(endTime)}` : 'Select end time'}
                    >
                      <Feather name="clock" size={16} color={colors.foregroundMuted} />
                      <Text
                        style={[
                          styles.pickerText,
                          { color: endTime ? colors.foreground : colors.foregroundSubtle },
                        ]}
                        numberOfLines={1}
                      >
                        {endTime ? formatTimeValue(endTime) : 'Select time'}
                      </Text>
                    </Pressable>
                  </Field>
                </View>
              </View>
              {eventStartIsPast ? (
                <Text style={[styles.fieldHint, { color: colors.foregroundMuted }]}>
                  The start of an event that has already happened can&apos;t be changed.
                </Text>
              ) : null}

              <Field label="Event type">
                <View style={styles.chips}>
                  <Pressable
                    onPress={() => setIsOnline(true)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isOnline }}
                    style={[
                      styles.chip,
                      { backgroundColor: isOnline ? colors.accentSoft : colors.surfaceRaised },
                    ]}
                  >
                    <Feather
                      name="video"
                      size={14}
                      color={isOnline ? colors.foreground : colors.foregroundMuted}
                    />
                    <Text
                      style={[
                        styles.chipText,
                        { color: isOnline ? colors.foreground : colors.foregroundMuted },
                      ]}
                    >
                      Online
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setIsOnline(false)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: !isOnline }}
                    style={[
                      styles.chip,
                      { backgroundColor: !isOnline ? colors.accentSoft : colors.surfaceRaised },
                    ]}
                  >
                    <Feather
                      name="map-pin"
                      size={14}
                      color={!isOnline ? colors.foreground : colors.foregroundMuted}
                    />
                    <Text
                      style={[
                        styles.chipText,
                        { color: !isOnline ? colors.foreground : colors.foregroundMuted },
                      ]}
                    >
                      In person
                    </Text>
                  </Pressable>
                </View>
              </Field>

              <Field label={isOnline ? 'Meeting link (optional)' : 'Location (optional)'}>
                <TextInput
                  value={isOnline ? meetLink : location}
                  onChangeText={isOnline ? setMeetLink : setLocation}
                  style={inputStyle}
                  autoCapitalize="none"
                  placeholder={isOnline ? 'https://meet.google.com/…' : 'Address or venue name'}
                  placeholderTextColor={colors.foregroundSubtle}
                />
              </Field>

              <Field label="Max attendees (optional)">
                <TextInput
                  value={maxAttendees}
                  onChangeText={setMaxAttendees}
                  style={inputStyle}
                  keyboardType="number-pad"
                  placeholder="Leave blank for unlimited"
                  placeholderTextColor={colors.foregroundSubtle}
                />
              </Field>

              <Field label="Card color">
                <EventAccentPicker value={accentColor} onChange={setAccentColor} />
                <Text style={[styles.fieldHint, { color: colors.foregroundSubtle }]}>
                  The main color of this event&apos;s ticket.
                </Text>
              </Field>

              <Toggle
                label="Share publicly"
                description="This event will appear on the home feed for all members."
                value={isPublic}
                onValueChange={setIsPublic}
                colors={colors}
              />

              {isPublic ? (
                <Field label="City *">
                  <Pressable
                    onPress={() => setCityPickerOpen(true)}
                    style={[
                      styles.input,
                      styles.pickerTrigger,
                      { backgroundColor: colors.inputBackground, borderColor: colors.borderSubtle },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={selectedCity ? `City, ${selectedCity.name}` : 'Select city'}
                  >
                    <Feather name="map-pin" size={16} color={colors.foregroundMuted} />
                    <Text
                      style={[
                        styles.pickerText,
                        { color: selectedCity ? colors.foreground : colors.foregroundSubtle },
                      ]}
                      numberOfLines={1}
                    >
                      {selectedCity?.name ?? 'Select a city…'}
                    </Text>
                    <Feather name="chevron-down" size={18} color={colors.foregroundMuted} />
                  </Pressable>
                  <Text style={[styles.fieldHint, { color: colors.foregroundSubtle }]}>
                    Shown on this city&apos;s Events page, so people there can discover and join it.
                  </Text>
                </Field>
              ) : null}
            </>
          ) : null}

          {kind !== 'events' ? (
            <Toggle
              label="Share publicly"
              description={
                kind === 'threads' || isShowcase
                  ? 'Visible to everyone, not just community members.'
                  : 'Also show this post in the public community feed.'
              }
              value={isPublic}
              onValueChange={setIsPublic}
              colors={colors}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {kind === 'events' ? (
        <>
          <EventDatePickerSheet
            visible={datePickerOpen}
            value={eventDate}
            min={minEventDate}
            onSelect={(next) => {
              setEventDate(next);
              setDatePickerOpen(false);
            }}
            onClose={() => setDatePickerOpen(false)}
          />
          <EventTimePickerSheet
            visible={timePicker !== null}
            value={timePicker === 'end' ? endTime : eventTime}
            title={timePicker === 'end' ? 'Select end time' : 'Select start time'}
            onSelect={(next) => {
              if (timePicker === 'end') setEndTime(next);
              else setEventTime(next);
              setTimePicker(null);
            }}
            onClose={() => setTimePicker(null)}
          />
          <CityPickerSheet
            visible={cityPickerOpen}
            cities={cities}
            value={cityId}
            onSelect={(next) => {
              setCityId(next);
              setCityPickerOpen(false);
            }}
            onClose={() => setCityPickerOpen(false)}
          />
        </>
      ) : null}
    </Modal>
  );
}

function Field({ label, children }: { label: string | null; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      {label ? (
        <Text style={[styles.label, { color: colors.foregroundMuted }]}>{label}</Text>
      ) : null}
      {children}
    </View>
  );
}

function Toggle({
  label,
  description,
  value,
  onValueChange,
  colors,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.toggle}>
      <View style={styles.toggleCopy}>
        <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{label}</Text>
        {description ? (
          <Text style={[styles.toggleDescription, { color: colors.foregroundMuted }]}>{description}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.chatOwnBubble }}
        thumbColor={value ? '#FFFFFF' : colors.foregroundSubtle}
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

/**
 * The web `LinkPreviewCard`: a quiet raised tile with the page's own title,
 * description and social image, credited to its domain. Dismissible, because
 * a bad upstream preview shouldn't sit in the author's way.
 */
function ResourceLinkPreview({
  data,
  colors,
  onDismiss,
}: {
  data: LinkPreviewData;
  colors: ReturnType<typeof useColors>;
  onDismiss: () => void;
}) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const domain = linkPreviewDomain(data.url);

  return (
    <View
      style={[
        styles.previewCard,
        { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
      ]}
    >
      <View style={styles.previewCopy}>
        {data.title ? (
          <Text
            numberOfLines={2}
            style={[styles.previewTitle, { color: colors.foreground }]}
          >
            {data.title}
          </Text>
        ) : null}
        {data.description ? (
          <Text
            numberOfLines={3}
            style={[styles.previewDescription, { color: colors.foregroundMuted }]}
          >
            {data.description}
          </Text>
        ) : null}
        <View style={styles.previewDomainRow}>
          {faviconFailed ? (
            <Feather name="globe" size={11} color={colors.foregroundSubtle} />
          ) : (
            <Image
              source={{ uri: `https://www.google.com/s2/favicons?domain=${domain}&sz=32` }}
              style={styles.previewFavicon}
              onError={() => setFaviconFailed(true)}
            />
          )}
          <Text
            numberOfLines={1}
            style={[styles.previewDomain, { color: colors.foregroundSubtle }]}
          >
            {domain}
          </Text>
        </View>
      </View>

      {data.image ? (
        <Image
          source={{ uri: data.image }}
          style={[styles.previewImage, { backgroundColor: colors.surface }]}
          resizeMode="cover"
        />
      ) : null}

      <Pressable
        onPress={onDismiss}
        style={styles.previewDismiss}
        hitSlop={8}
        accessibilityLabel="Remove preview"
      >
        <Feather name="x" size={12} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

/**
 * The web composer's Post / Poll tabs, with the same underline treatment.
 * `tab` decides what gets posted; the thread's other fields are shared.
 */
function ComposerTabs({
  value,
  onChange,
  colors,
}: {
  value: 'post' | 'poll';
  onChange: (value: 'post' | 'poll') => void;
  colors: ReturnType<typeof useColors>;
}) {
  const tabs: Array<{
    value: 'post' | 'poll';
    label: string;
    icon: React.ComponentProps<typeof Feather>['name'];
  }> = [
    { value: 'post', label: 'Post', icon: 'edit-3' },
    { value: 'poll', label: 'Poll', icon: 'bar-chart-2' },
  ];

  return (
    <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
      {tabs.map((entry) => {
        const active = value === entry.value;
        return (
          <Pressable
            key={entry.value}
            onPress={() => onChange(entry.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.tab, { borderBottomColor: active ? colors.accent : 'transparent' }]}
          >
            <Feather
              name={entry.icon}
              size={14}
              color={active ? colors.foreground : colors.foregroundMuted}
            />
            <Text
              style={[
                styles.tabText,
                { color: active ? colors.foreground : colors.foregroundMuted },
              ]}
            >
              {entry.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The poll draft editor, ported from the web `PollComposer`: one question and
 * 2–6 lettered options, with add/remove controls. Validation runs on submit so
 * the composer never nags while the author is still typing.
 */
function PollComposer({
  value,
  onChange,
  colors,
}: {
  value: ThreadPollDraft;
  onChange: (draft: ThreadPollDraft) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const { question, options } = value;
  const filled = options.filter((option) => option.trim()).length;

  function setQuestion(next: string) {
    onChange({ ...value, question: next });
  }

  function setOption(index: number, text: string) {
    onChange({
      ...value,
      options: options.map((option, i) => (i === index ? text : option)),
    });
  }

  function addOption() {
    if (options.length >= POLL_MAX_OPTIONS) return;
    onChange({ ...value, options: [...options, ''] });
  }

  function removeOption(index: number) {
    if (options.length <= POLL_MIN_OPTIONS) return;
    onChange({ ...value, options: options.filter((_, i) => i !== index) });
  }

  return (
    <View
      style={[
        styles.pollCard,
        { borderColor: colors.border, backgroundColor: colors.background },
      ]}
    >
      <View style={styles.pollHeader}>
        <Feather name="bar-chart-2" size={13} color={colors.foregroundMuted} />
        <Text style={[styles.pollHeaderText, { color: colors.foregroundMuted }]}>Poll</Text>
      </View>

      <Field label="Question">
        <TextInput
          value={question}
          onChangeText={setQuestion}
          maxLength={POLL_QUESTION_MAX_LENGTH}
          placeholder="Ask something…"
          placeholderTextColor={colors.foregroundSubtle}
          style={inputStyleFor(colors)}
        />
      </Field>

      <View style={styles.pollOptions}>
        {options.map((option, index) => (
          <View key={index} style={styles.pollOptionRow}>
            <View
              style={[
                styles.pollOptionBadge,
                { borderColor: colors.border, backgroundColor: colors.surface },
              ]}
            >
              <Text style={[styles.pollOptionBadgeText, { color: colors.foregroundSubtle }]}>
                {pollOptionLetter(index)}
              </Text>
            </View>
            <TextInput
              value={option}
              onChangeText={(text) => setOption(index, text)}
              maxLength={POLL_OPTION_MAX_LENGTH}
              placeholder={`Option ${index + 1}`}
              placeholderTextColor={colors.foregroundSubtle}
              style={[inputStyleFor(colors), styles.pollOptionInput]}
            />
            {options.length > POLL_MIN_OPTIONS ? (
              <Pressable
                onPress={() => removeOption(index)}
                style={styles.pollRemove}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove option ${index + 1}`}
              >
                <Feather name="x" size={14} color={colors.foregroundSubtle} />
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>

      {options.length < POLL_MAX_OPTIONS ? (
        <Pressable
          onPress={addOption}
          style={[styles.pollAdd, { borderColor: colors.border }]}
          accessibilityRole="button"
        >
          <Feather name="plus" size={12} color={colors.foregroundMuted} />
          <Text style={[styles.pollAddText, { color: colors.foregroundMuted }]}>Add option</Text>
        </Pressable>
      ) : (
        <Text style={[styles.pollHint, { color: colors.foregroundSubtle }]}>
          You can add up to {POLL_MAX_OPTIONS} options.
        </Text>
      )}

      {filled < POLL_MIN_OPTIONS ? (
        <Text style={[styles.pollHint, { color: colors.foregroundSubtle }]}>
          Add at least {POLL_MIN_OPTIONS} options.
        </Text>
      ) : null}
    </View>
  );
}

/** The shared field skin, used outside the main form's closure. */
function inputStyleFor(colors: ReturnType<typeof useColors>) {
  return {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontFamily: 'Geist_400Regular' as const,
    fontSize: 15,
    color: colors.foreground,
    backgroundColor: colors.inputBackground,
    borderColor: colors.borderSubtle,
  };
}

/**
 * The typed body *is* the thread, exactly as on the web: the whole post is
 * stored in `title` (no separate description), so the card and the web page
 * show the same text.
 */
function bodyToThread(body: string) {
  const title = body.trim().slice(0, THREAD_BODY_MAX_LENGTH);
  return { title: title || 'Thread' };
}

function threadToBody(title: string, description: string | null) {
  if (description?.startsWith(title)) return description;
  return description ? `${title}\n\n${description}` : title;
}

function extractLinks(text: string) {
  return [...new Set(text.match(/https?:\/\/[^\s<>"]+/g) ?? [])];
}

function toLocalDateTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Today on the phone's own calendar, as a date-picker stamp. */
function todayStamp(now: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parseDateTime(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!match) return null;
  const d = new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]),
  );
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The typed wall clock as the instant it names in the chosen zone. Falling back
 * to the phone's own reading keeps an event editable where the runtime cannot
 * resolve a zone at all — which is exactly what this did before the host's zone
 * was recordable.
 */
function toInstant(wall: string, zone: string | null): string | null {
  return (zone ? wallClockToIso(wall, zone) : null) ?? parseDateTime(wall);
}

/** The offset to store beside the host's zone, or the phone's own as a fallback. */
function startOffsetMinutes(startIso: string, zone: string | null): number {
  const instant = new Date(startIso);
  return (zone ? zoneOffsetMinutes(zone, instant) : null) ?? deviceOffsetMinutes(instant);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontFamily: 'Geist_600SemiBold', fontSize: 19 },
  subtitle: { fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 1 },
  save: { minWidth: 68, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  saveText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  form: { padding: 20, gap: 20 },
  field: { gap: 8 },
  label: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontFamily: 'Geist_400Regular',
    fontSize: 15,
  },
  multiline: { minHeight: 124, paddingTop: 13 },
  urlInput: { paddingRight: 40 },
  urlAccessory: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  previewLoading: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previewLoadingText: { fontFamily: 'Geist_400Regular', fontSize: 14 },
  previewCard: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    overflow: 'hidden',
  },
  previewCopy: { flex: 1, minWidth: 0 },
  previewTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 12, lineHeight: 16 },
  previewDescription: {
    fontFamily: 'Geist_400Regular',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
  },
  previewDomainRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  previewFavicon: { width: 14, height: 14, borderRadius: 2 },
  previewDomain: { flexShrink: 1, fontFamily: 'Geist_400Regular', fontSize: 11 },
  previewImage: { width: 144, height: 96, borderRadius: 8 },
  previewDismiss: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  showcaseTitle: { paddingBottom: 22 },
  threadBody: { paddingBottom: 22 },
  counter: {
    position: 'absolute',
    right: 10,
    bottom: 6,
    fontFamily: 'Geist_500Medium',
    fontSize: 11,
  },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: 1 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 2,
    marginBottom: -1,
  },
  tabText: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  pollCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
  pollHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pollHeaderText: { fontFamily: 'Geist_600SemiBold', fontSize: 12 },
  pollOptions: { gap: 8 },
  pollOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pollOptionBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pollOptionBadgeText: { fontFamily: 'Geist_600SemiBold', fontSize: 11 },
  pollOptionInput: {
    flex: 1,
    height: 40,
    minHeight: 40,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  pollRemove: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  pollAdd: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pollAddText: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  pollHint: { fontFamily: 'Geist_400Regular', fontSize: 11 },
  pickerTrigger: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pickerText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 15 },
  fieldHint: { fontFamily: 'Geist_400Regular', fontSize: 12, lineHeight: 17 },
  timeRow: { flexDirection: 'row', gap: 10 },
  timeHalf: { flex: 1 },
  eventName: { paddingRight: 56 },
  coverPick: {
    minHeight: 150,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 16,
  },
  coverPickTitle: { fontFamily: 'Geist_500Medium', fontSize: 13 },
  coverPreviewWrap: { position: 'relative', borderRadius: 12, overflow: 'hidden' },
  coverPreview: { width: '100%', height: 190 },
  coverRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipText: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  toggle: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  toggleCopy: { flex: 1, gap: 3 },
  toggleLabel: { fontFamily: 'Geist_500Medium', fontSize: 15 },
  toggleDescription: { fontFamily: 'Geist_400Regular', fontSize: 12, lineHeight: 17 },
  error: { fontFamily: 'Geist_500Medium', fontSize: 14, lineHeight: 20 },
  imageList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  imagePreviewShell: { width: 86, height: 86 },
  imagePreview: { width: '100%', height: '100%', borderRadius: 10 },
  videoTile: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' },
  videoBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  removeImage: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addImage: {
    minHeight: 48,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addImageText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
});
