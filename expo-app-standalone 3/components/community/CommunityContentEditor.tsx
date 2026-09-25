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
  CommunityContent, ContentKind, SHOWCASE_CATEGORY_OPTIONS, SHOWCASE_MEDIA_MAX,
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
  threads: ['question', 'discussion', 'idea', 'feedback', 'referral', 'collaboration'],
  resources: ['article', 'figma', 'tool', 'video', 'book', 'font', 'icon_pack', 'color', 'template', 'inspiration', 'other'],
  showcase: SHOWCASE_CATEGORY_OPTIONS.map((option) => option.value),
};

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
  const [type, setType] = useState(DEFAULT_TYPE[kind] ?? 'question');
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
  const mediaLimit = kind === 'showcase' ? SHOWCASE_MEDIA_MAX : 5;

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

    if (kind === 'threads') {
      setType(item && 'category' in item ? item.category : 'question');
      setAllowReplies(item && 'allow_replies' in item ? item.allow_replies : true);
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

  const submit = async () => {
    const cleanTags = tags
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 3);
    const imageAttachments = attachments.filter((attachment) => attachment.type.startsWith('image/'));

    let body: Record<string, unknown>;
    if (kind === 'threads') {
      if (!description.trim()) return setError('Write something before saving.');
      const thread = bodyToThread(description);
      body = {
        ...thread,
        category: type,
        tags: cleanTags,
        attachments,
        links: extractLinks(description),
        allow_replies: allowReplies,
        is_public: isPublic,
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
          <Text style={[styles.title, { color: colors.foreground }]}>
            {item ? 'Edit' : isShowcase ? 'Share your work' : kind === 'resources' ? 'Share' : 'Create'} {isShowcase ? '' : label}
          </Text>
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
                {isShowcase ? 'Share' : 'Save'}
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

          {isShowcase ? (
            <Field label="Title *">
              <TextInput
                value={title}
                onChangeText={setTitle}
                style={[inputStyle, styles.multiline]}
                multiline
                maxLength={2000}
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

          {!isShowcase ? (
            <Field label={kind === 'threads' ? 'What do you want to talk about?' : 'Description'}>
              <TextInput
                value={description}
                onChangeText={setDescription}
                style={[inputStyle, styles.multiline]}
                multiline
                maxLength={kind === 'resources' ? 2000 : kind === 'events' ? 5000 : 10000}
                textAlignVertical="top"
                placeholder={kind === 'threads' ? 'What do you want to talk about?' : 'Add helpful details'}
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
            <Field label={isShowcase ? 'Category *' : kind === 'threads' ? 'Category' : 'Type'}>
              <View style={styles.chips}>
                {choices.map((choice) => (
                  <Pressable
                    key={choice}
                    onPress={() => setType(choice)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: type === choice ? colors.accentSoft : colors.surfaceRaised,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: type === choice ? colors.foreground : colors.foregroundMuted },
                      ]}
                    >
                      {choice.replace(/_/g, ' ')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </Field>
          ) : null}

          {kind !== 'events' && !isShowcase ? (
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
            <Toggle label="Allow replies" value={allowReplies} onValueChange={setAllowReplies} colors={colors} />
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
            description="Also show this post in the public community feed."
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.foregroundMuted }]}>{label}</Text>
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

function bodyToThread(body: string) {
  const trimmed = body.trim();
  const firstLine = trimmed.split('\n')[0]?.trim() ?? '';
  const title = (firstLine || trimmed).slice(0, 120) || 'Thread';
  return { title, description: trimmed || title };
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
  title: { flex: 1, fontFamily: 'Geist_600SemiBold', fontSize: 19 },
  save: { minWidth: 68, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  saveText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  form: { padding: 20, gap: 20 },
  field: { gap: 8 },
  label: { fontFamily: 'Geist_500Medium', fontSize: 13 },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontFamily: 'Geist_400Regular',
    fontSize: 15,
  },
  multiline: { minHeight: 124, paddingTop: 13 },
  zoneTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  zoneTriggerText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 15 },
  zoneHint: { fontFamily: 'Geist_400Regular', fontSize: 12, lineHeight: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  chipText: { fontFamily: 'Geist_500Medium', fontSize: 13, textTransform: 'capitalize' },
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
