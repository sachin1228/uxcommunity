import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { prepareImageForUpload } from '@/lib/prepareImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  CommunityContent, ContentKind, RESOURCE_TYPE_LABELS, SHOWCASE_CATEGORY_OPTIONS, SHOWCASE_MEDIA_MAX,
  THREAD_BODY_MAX_LENGTH, THREAD_CATEGORY_LABELS, THREAD_CATEGORY_OPTIONS, THREAD_IMAGE_MAX,
  ThreadAttachment, contentLabel, createCommunityContent,
  updateCommunityContent, uploadContentImage,
} from '@/lib/communityContent';
import {
  deviceClockReading,
  deviceOffsetMinutes,
  deviceTimeZone,
  timeZoneChoices,
  timeZoneIsSupported,
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
import { TimeZonePickerSheet } from './TimeZonePickerSheet';

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
  resources: ['article', 'figma', 'tool', 'video', 'book', 'font', 'icon_pack', 'color', 'template', 'inspiration', 'other'],
  showcase: SHOWCASE_CATEGORY_OPTIONS.map((option) => option.value),
};

/** The icon beside each thread category — the web `CATEGORY_ICONS` set. */
const THREAD_CATEGORY_ICONS: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  question: 'help-circle',
  discussion: 'message-circle',
  idea: 'zap',
  feedback: 'thumbs-up',
};

/** The display label for one chip, whichever kind is composing. */
function optionLabel(kind: ContentKind, value: string): string {
  if (kind === 'threads') return THREAD_CATEGORY_LABELS[value] ?? value;
  if (kind === 'resources') return RESOURCE_TYPE_LABELS[value] ?? value;
  return SHOWCASE_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/** Kinds whose composer offers direct image uploads. */
const UPLOAD_KINDS: ContentKind[] = ['threads', 'showcase'];

const DEFAULT_TYPE: Partial<Record<ContentKind, string>> = {
  threads: 'question',
  resources: 'article',
  showcase: 'product_design',
};

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
  const [endDate, setEndDate] = useState('');
  // Which clock those two fields are read on. A phone is usually right about
  // its own zone, so that is the default; the picker exists for the two cases
  // it isn't — a device set to the wrong zone, and a host scheduling for
  // somewhere they aren't.
  const [hostZone, setHostZone] = useState<string | null>(null);
  const [zonePickerOpen, setZonePickerOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [location, setLocation] = useState('');
  const [meetLink, setMeetLink] = useState('');
  const [maxAttendees, setMaxAttendees] = useState('');
  const [allowReplies, setAllowReplies] = useState(true);
  const [isPublic, setIsPublic] = useState(false);
  const [attachments, setAttachments] = useState<ThreadAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUpload = UPLOAD_KINDS.includes(kind);
  const mediaLimit = kind === 'showcase'
    ? SHOWCASE_MEDIA_MAX
    : kind === 'threads'
      ? THREAD_IMAGE_MAX
      : 5;

  useEffect(() => {
    if (!visible) return;
    setTitle(item?.title ?? '');
    setDescription(
      kind === 'threads' && item ? threadToBody(item.title, item.description) : item?.description ?? '',
    );
    setTags('tags' in (item ?? {}) ? ((item as { tags: string[] }).tags ?? []).join(', ') : '');
    setIsPublic(Boolean(item?.is_public));
    setAttachments(item && 'attachments' in item ? item.attachments : []);
    setType(DEFAULT_TYPE[kind] ?? 'question');
    setTab('post');
    setPollDraft(null);

    if (kind === 'threads') {
      // A legacy mobile category (`referral` / `collaboration`) is not one the
      // web or the API accepts, so it comes back as "nothing chosen yet".
      const category = item && 'category' in item ? item.category : null;
      setType(
        THREAD_CATEGORY_OPTIONS.some((option) => option.value === category) ? category : null,
      );
      setAllowReplies(item && 'allow_replies' in item ? item.allow_replies : true);
      // Editing keeps the thread's type, as on the web: a poll edits its poll,
      // a post edits its text.
      const poll = item && 'poll' in item ? item.poll : null;
      if (poll) {
        setTab('poll');
        setPollDraft(pollDraftFromPoll(poll));
      }
    } else if (kind === 'resources') {
      setType(item && 'resource_type' in item ? item.resource_type : 'article');
      setUrl(item && 'url' in item ? item.url : '');
    } else if (kind === 'showcase') {
      setType(item && 'category' in item ? item.category : 'product_design');
      setAllowReplies(item && 'allow_replies' in item ? item.allow_replies : true);
    } else {
      // The zone starts as the one the event was created in, and the phone's
      // own for a new event. Prefilling from anywhere else would read the times
      // back in another zone and shift the event on an untouched save.
      const zone = (item && 'host_timezone' in item ? item.host_timezone : null) || deviceZone;
      setHostZone(zone);
      const inZone = (iso: string | null | undefined) =>
        iso && zone ? wallClockInZone(iso, zone) : null;
      setEventDate(
        item && 'event_date' in item
          ? inZone(item.event_date) ?? toLocalDateTime(item.event_date)
          : '',
      );
      setEndDate(
        item && 'end_date' in item && item.end_date
          ? inZone(item.end_date) ?? toLocalDateTime(item.end_date)
          : '',
      );
      setIsOnline(Boolean(item && 'is_online' in item && item.is_online));
      setLocation(item && 'location' in item ? item.location ?? '' : '');
      setMeetLink(item && 'meet_link' in item ? item.meet_link ?? '' : '');
      setMaxAttendees(
        item && 'max_attendees' in item && item.max_attendees ? String(item.max_attendees) : '',
      );
    }
    setError(null);
  }, [item, kind, visible, deviceZone]);

  const pickImage = async () => {
    if (attachments.length >= mediaLimit) {
      return setError(`You can add up to ${mediaLimit} images.`);
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') return setError('Photo library permission is required.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    setError(null);
    try {
      // Native WebP encode (quality 0.90, ≤ 2560px) — same contract as the web app.
      const prepared = await prepareImageForUpload(asset, `${kind}-image-${Date.now()}`);
      const attachment = await uploadContentImage(communityId, kind, {
        uri: prepared.uri,
        name: prepared.name,
        type: prepared.mimeType,
      });
      setAttachments((current) => [...current, attachment]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload image.');
    } finally {
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
      if (!title.trim()) return setError('Title is required.');
      if (!/^https?:\/\//i.test(url.trim())) {
        return setError('Enter a URL beginning with http:// or https://.');
      }
      body = {
        title: title.trim(),
        description: description.trim() || null,
        resource_type: type,
        url: url.trim(),
        tags: cleanTags,
        is_public: isPublic,
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
      if (!title.trim()) return setError('Title is required.');
      const zone = hostZone ?? deviceZone;
      const start = toInstant(eventDate, zone);
      const end = endDate.trim() ? toInstant(endDate, zone) : null;
      if (!start) return setError('Use YYYY-MM-DD HH:MM for the event date.');
      if (endDate.trim() && !end) return setError('Use YYYY-MM-DD HH:MM for the end date.');
      // The start must not be in the past — matching the web form. An existing
      // event whose start was left untouched stays editable, so fixing a typo
      // in the description doesn't require inventing a new date.
      const untouchedStart =
        item && 'event_date' in item &&
        Math.abs(new Date(item.event_date).getTime() - new Date(start).getTime()) < 60_000;
      if (!untouchedStart && new Date(start).getTime() < Date.now() - 60_000) {
        return setError("The event start can't be in the past.");
      }
      if (end && new Date(end).getTime() <= new Date(start).getTime()) {
        return setError('The end must be after the start.');
      }
      body = {
        title: title.trim(),
        description: description.trim() || null,
        event_date: start,
        end_date: end,
        is_online: isOnline,
        location: location.trim() || null,
        meet_link: meetLink.trim() || null,
        max_attendees: maxAttendees ? Number(maxAttendees) : null,
        cover_image_url: item && 'cover_image_url' in item ? item.cover_image_url : null,
        is_public: isPublic,
        // The host's own side of the schedule, so a card can later show the
        // time they actually set beside each member's reading of it. The offset
        // is that zone's at the event's instant, and the fallback when another
        // browser cannot resolve the name.
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
  const isShowcase = kind === 'showcase';

  // The zone the two time fields are read on, what it is called, and — when
  // that isn't the phone's own zone — what the typed start lands on in the
  // host's own clock, which is the check that catches a wrong pick.
  const canPickZone = timeZoneIsSupported();
  const zone = hostZone ?? deviceZone;
  const zoneAnchor = useMemo(() => {
    const typed = eventDate.trim().slice(0, 10);
    const noon = new Date(`${typed}T12:00:00Z`);
    // No day typed yet: label the list for today rather than nothing.
    return Number.isNaN(noon.getTime()) ? new Date() : noon;
  }, [eventDate]);
  const zoneRows = useMemo(
    () => timeZoneChoices(zoneAnchor, [zone, deviceZone]),
    [zoneAnchor, zone, deviceZone],
  );
  const zoneSummary = zoneRows.find((row) => row.zone === zone)?.label ?? zone ?? 'Pick a timezone';
  const zoneCity = zoneSummary.split(' · ')[0];
  const overriding = Boolean(zone && deviceZone && zone !== deviceZone);
  const zoneStartIso = eventDate.trim() ? toInstant(eventDate, zone) : null;
  const zoneReading = overriding && zoneStartIso ? deviceClockReading(zoneStartIso, eventDate) : null;

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
              {item ? 'Edit' : isShowcase ? 'Share your work' : kind === 'resources' ? 'Share' : 'Create'} {isShowcase ? '' : label}
            </Text>
            {kind === 'threads' ? (
              <Text
                style={[styles.subtitle, { color: colors.foregroundMuted }]}
                numberOfLines={1}
              >
                {item
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
                {isShowcase ? 'Share' : item ? 'Save' : kind === 'threads' ? 'Post' : 'Save'}
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
              <TextInput
                value={title}
                onChangeText={setTitle}
                style={[inputStyle, styles.multiline]}
                multiline
                maxLength={THREAD_BODY_MAX_LENGTH}
                textAlignVertical="top"
                placeholder="What did you make? Walk us through it…"
                placeholderTextColor={colors.foregroundSubtle}
              />
            </Field>
          ) : null}

          {kind === 'resources' ? (
            <Field label="URL">
              <TextInput
                value={url}
                onChangeText={setUrl}
                style={inputStyle}
                placeholder="https://"
                placeholderTextColor={colors.foregroundSubtle}
                autoCapitalize="none"
                keyboardType="url"
              />
            </Field>
          ) : null}

          {kind !== 'threads' && !isShowcase ? (
            <Field label="Title">
              <TextInput
                value={title}
                onChangeText={setTitle}
                style={inputStyle}
                maxLength={120}
                placeholder={`Give your ${label.toLowerCase()} a title`}
                placeholderTextColor={colors.foregroundSubtle}
              />
            </Field>
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
          ) : !isShowcase ? (
            <Field label="Description">
              <TextInput
                value={description}
                onChangeText={setDescription}
                style={[inputStyle, styles.multiline]}
                multiline
                maxLength={kind === 'resources' ? 2000 : 5000}
                textAlignVertical="top"
                placeholder="Add helpful details"
                placeholderTextColor={colors.foregroundSubtle}
              />
            </Field>
          ) : null}

          {canUpload ? (
            <Field label={`Images (up to ${mediaLimit})`}>
              <View style={styles.imageList}>
                {attachments
                  .filter((attachment) => attachment.type.startsWith('image/'))
                  .map((attachment) => (
                    <View key={attachment.url} style={styles.imagePreviewShell}>
                      <Image source={{ uri: attachment.url }} style={styles.imagePreview} />
                      <Pressable
                        onPress={() =>
                          setAttachments((current) =>
                            current.filter((entry) => entry.url !== attachment.url),
                          )
                        }
                        style={[styles.removeImage, { backgroundColor: colors.surface }]}
                        accessibilityLabel="Remove image"
                      >
                        <Feather name="x" size={16} color={colors.foreground} />
                      </Pressable>
                    </View>
                  ))}
              </View>
              <Pressable
                onPress={pickImage}
                disabled={uploading || attachments.length >= mediaLimit}
                style={[styles.addImage, { backgroundColor: colors.surfaceRaised }]}
              >
                {uploading ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <Feather name="image" size={19} color={colors.accent} />
                )}
                <Text style={[styles.addImageText, { color: colors.accent }]}>
                  {uploading ? 'Uploading image…' : 'Add image'}
                </Text>
              </Pressable>
            </Field>
          ) : null}

          {choices.length ? (
            <Field label={isShowcase || kind === 'threads' ? 'Category *' : 'Type'}>
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

          {kind !== 'events' && kind !== 'threads' && !isShowcase ? (
            <Field label="Tags (up to 3, comma separated)">
              <TextInput
                value={tags}
                onChangeText={setTags}
                style={inputStyle}
                placeholder="design, research"
                placeholderTextColor={colors.foregroundSubtle}
              />
            </Field>
          ) : null}

          {kind === 'threads' || isShowcase ? (
            <Toggle
              label="Allow replies"
              description={
                kind === 'threads' ? 'Other members can reply to this thread.' : undefined
              }
              value={allowReplies}
              onValueChange={setAllowReplies}
              colors={colors}
            />
          ) : null}

          {kind === 'events' ? (
            <>
              <Field label="Starts">
                <TextInput value={eventDate} onChangeText={setEventDate} style={inputStyle} placeholder="2026-08-15 18:30" placeholderTextColor={colors.foregroundSubtle} />
              </Field>
              <Field label="Ends (optional)">
                <TextInput value={endDate} onChangeText={setEndDate} style={inputStyle} placeholder="2026-08-15 20:00" placeholderTextColor={colors.foregroundSubtle} />
              </Field>
              {/* Which clock the two fields above are read on. Hidden outright
                  where the runtime cannot resolve a zone: offering a picker
                  the app cannot honour is how a host ends up publishing an
                  event hours from the time they meant. */}
              {canPickZone ? (
                <Field label="Timezone">
                  <Pressable
                    onPress={() => setZonePickerOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`Timezone, ${zoneSummary}`}
                    style={[
                      styles.input,
                      styles.zoneTrigger,
                      { backgroundColor: colors.inputBackground, borderColor: colors.borderSubtle },
                    ]}
                  >
                    <Text
                      style={[styles.zoneTriggerText, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {zoneSummary}
                    </Text>
                    <Feather name="chevron-down" size={18} color={colors.foregroundMuted} />
                  </Pressable>
                  <Text style={[styles.zoneHint, { color: colors.foregroundMuted }]}>
                    {overriding
                      ? `Times are read in ${zoneCity} time. Everyone else sees the same moment on their own clock.`
                      : "Times are in this phone's timezone. Everyone else sees the same moment on their own clock."}
                  </Text>
                  {zoneReading ? (
                    <Text style={[styles.zoneHint, { color: colors.foregroundMuted }]}>
                      {`On your own clock that's ${zoneReading}.`}
                    </Text>
                  ) : null}
                </Field>
              ) : null}
              <Toggle label="Online event" value={isOnline} onValueChange={setIsOnline} colors={colors} />
              <Field label={isOnline ? 'Meeting link' : 'Location'}>
                <TextInput
                  value={isOnline ? meetLink : location}
                  onChangeText={isOnline ? setMeetLink : setLocation}
                  style={inputStyle}
                  autoCapitalize="none"
                  placeholder={isOnline ? 'https://meet.example.com' : 'Venue or address'}
                  placeholderTextColor={colors.foregroundSubtle}
                />
              </Field>
              <Field label="Maximum attendees (optional)">
                <TextInput
                  value={maxAttendees}
                  onChangeText={setMaxAttendees}
                  style={inputStyle}
                  keyboardType="number-pad"
                  placeholder="No limit"
                  placeholderTextColor={colors.foregroundSubtle}
                />
              </Field>
            </>
          ) : null}

          <Toggle
            label="Share publicly"
            description={
              kind === 'threads'
                ? 'Visible to everyone, not just community members.'
                : 'Also show this post in the public community feed.'
            }
            value={isPublic}
            onValueChange={setIsPublic}
            colors={colors}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* A page sheet over the composer: the list is long enough that opening
          it inline would fight the keyboard and the form's scroll position. */}
      {canPickZone ? (
        <TimeZonePickerSheet
          visible={zonePickerOpen}
          choices={zoneRows}
          value={zone}
          deviceZone={deviceZone}
          onSelect={(next) => {
            setHostZone(next);
            setZonePickerOpen(false);
          }}
          onClose={() => setZonePickerOpen(false)}
        />
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
        trackColor={{ false: colors.border, true: colors.accent }}
      />
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
  zoneTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  zoneTriggerText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 15 },
  zoneHint: { fontFamily: 'Geist_400Regular', fontSize: 12, lineHeight: 17 },
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
