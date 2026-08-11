import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  CommunityContent, ContentKind, ThreadAttachment, createCommunityContent,
  updateCommunityContent, uploadThreadImage,
} from '@/lib/communityContent';

interface Props {
  visible: boolean;
  communityId: string;
  kind: ContentKind;
  item?: CommunityContent | null;
  onClose: () => void;
  onSaved: (item: CommunityContent) => void;
}

const OPTIONS = {
  threads: ['question', 'discussion', 'idea', 'feedback', 'referral', 'collaboration'],
  resources: ['article', 'figma', 'tool', 'video', 'book', 'font', 'icon_pack', 'color', 'template', 'inspiration', 'other'],
} as const;

export function CommunityContentEditor({ visible, communityId, kind, item, onClose, onSaved }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('question');
  const [tags, setTags] = useState('');
  const [url, setUrl] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [endDate, setEndDate] = useState('');
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

  useEffect(() => {
    if (!visible) return;
    setTitle(item?.title ?? '');
    setDescription(kind === 'threads' && item ? threadToBody(item.title, item.description) : item?.description ?? '');
    setTags('tags' in (item ?? {}) ? ((item as { tags: string[] }).tags ?? []).join(', ') : '');
    setIsPublic(Boolean(item?.is_public));
    setAttachments(item && 'attachments' in item ? item.attachments : []);
    if (kind === 'threads') {
      setType(item && 'category' in item ? item.category : 'question');
      setAllowReplies(item && 'allow_replies' in item ? item.allow_replies : true);
    } else if (kind === 'resources') {
      setType(item && 'resource_type' in item ? item.resource_type : 'article');
      setUrl(item && 'url' in item ? item.url : '');
    } else {
      setEventDate(item && 'event_date' in item ? toLocalDateTime(item.event_date) : '');
      setEndDate(item && 'end_date' in item && item.end_date ? toLocalDateTime(item.end_date) : '');
      setIsOnline(Boolean(item && 'is_online' in item && item.is_online));
      setLocation(item && 'location' in item ? item.location ?? '' : '');
      setMeetLink(item && 'meet_link' in item ? item.meet_link ?? '' : '');
      setMaxAttendees(item && 'max_attendees' in item && item.max_attendees ? String(item.max_attendees) : '');
    }
    setError(null);
  }, [item, kind, visible]);

  const pickThreadImage = async () => {
    if (attachments.length >= 5) return setError('You can add up to 5 images.');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') return setError('Photo library permission is required.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true); setError(null);
    try {
      const attachment = await uploadThreadImage(communityId, {
        uri: asset.uri,
        name: asset.fileName ?? `thread-image-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
      });
      setAttachments((current) => [...current, attachment]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not upload image.'); }
    finally { setUploading(false); }
  };

  const submit = async () => {
    const cleanTags = tags.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean).slice(0, 3);
    let body: Record<string, unknown>;
    if (kind === 'threads') {
      if (!description.trim()) return setError('Write something before saving.');
      const thread = bodyToThread(description);
      body = { ...thread, category: type, tags: cleanTags, attachments, links: extractLinks(description), allow_replies: allowReplies, is_public: isPublic };
    } else if (kind === 'resources') {
      if (!title.trim()) return setError('Title is required.');
      if (!/^https?:\/\//i.test(url.trim())) return setError('Enter a URL beginning with http:// or https://.');
      body = { title: title.trim(), description: description.trim() || null, resource_type: type, url: url.trim(), tags: cleanTags, is_public: isPublic };
    } else {
      if (!title.trim()) return setError('Title is required.');
      const start = parseDateTime(eventDate);
      const end = endDate.trim() ? parseDateTime(endDate) : null;
      if (!start) return setError('Use YYYY-MM-DD HH:MM for the event date.');
      if (endDate.trim() && !end) return setError('Use YYYY-MM-DD HH:MM for the end date.');
      body = { title: title.trim(), description: description.trim() || null, event_date: start, end_date: end, is_online: isOnline, location: location.trim() || null, meet_link: meetLink.trim() || null, max_attendees: maxAttendees ? Number(maxAttendees) : null, cover_image_url: item && 'cover_image_url' in item ? item.cover_image_url : null, is_public: isPublic };
    }
    setSaving(true); setError(null);
    try {
      const saved = item
        ? await updateCommunityContent(communityId, kind, item.id, body)
        : await createCommunityContent(communityId, kind, body);
      onSaved(saved);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setSaving(false); }
  };

  const inputStyle = [styles.input, { color: colors.foreground, backgroundColor: colors.input, borderColor: colors.border }];
  const choices = kind === 'threads' ? OPTIONS.threads : kind === 'resources' ? OPTIONS.resources : [];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.subtle }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose} style={styles.iconButton} accessibilityLabel="Close editor"><Feather name="x" size={24} color={colors.foreground} /></Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>{item ? 'Edit' : kind === 'resources' ? 'Share' : 'Create'} {labelFor(kind)}</Text>
          <Pressable onPress={submit} disabled={saving || uploading} style={[styles.save, { backgroundColor: colors.primary }]} accessibilityRole="button">
            {saving ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.saveText, { color: colors.primaryForeground }]}>Save</Text>}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
          {kind === 'resources' ? <Field label="URL"><TextInput value={url} onChangeText={setUrl} style={inputStyle} placeholder="https://" placeholderTextColor={colors.foregroundSoft} autoCapitalize="none" keyboardType="url" /></Field> : null}
          {kind !== 'threads' ? <Field label="Title"><TextInput value={title} onChangeText={setTitle} style={inputStyle} maxLength={120} placeholder={`Give your ${labelFor(kind).toLowerCase()} a title`} placeholderTextColor={colors.foregroundSoft} /></Field> : null}
          <Field label={kind === 'threads' ? 'What do you want to talk about?' : 'Description'}><TextInput value={description} onChangeText={setDescription} style={[inputStyle, styles.multiline]} multiline maxLength={kind === 'resources' ? 2000 : kind === 'events' ? 5000 : 10000} textAlignVertical="top" placeholder={kind === 'threads' ? 'What do you want to talk about?' : 'Add helpful details'} placeholderTextColor={colors.foregroundSoft} /></Field>
          {kind === 'threads' ? <Field label="Images (up to 5)"><View style={styles.imageList}>{attachments.filter((attachment) => attachment.type.startsWith('image/')).map((attachment) => <View key={attachment.url} style={styles.imagePreviewShell}><Image source={{ uri: attachment.url }} style={styles.imagePreview} /><Pressable onPress={() => setAttachments((current) => current.filter((entry) => entry.url !== attachment.url))} style={[styles.removeImage, { backgroundColor: colors.surface }]} accessibilityLabel="Remove image"><Feather name="x" size={16} color={colors.foreground} /></Pressable></View>)}</View><Pressable onPress={pickThreadImage} disabled={uploading || attachments.length >= 5} style={[styles.addImage, { borderColor: colors.border, backgroundColor: colors.surface }]}>{uploading ? <ActivityIndicator color={colors.primary} /> : <Feather name="image" size={19} color={colors.primary} />}<Text style={[styles.addImageText, { color: colors.primary }]}>{uploading ? 'Uploading image…' : 'Add image'}</Text></Pressable></Field> : null}
          {choices.length ? <Field label={kind === 'threads' ? 'Category' : 'Type'}><View style={styles.chips}>{choices.map((choice) => <Pressable key={choice} onPress={() => setType(choice)} style={[styles.chip, { borderColor: type === choice ? colors.primary : colors.border, backgroundColor: type === choice ? colors.primarySoft : colors.surface }]}><Text style={[styles.chipText, { color: type === choice ? colors.primary : colors.mutedForeground }]}>{choice.replace('_', ' ')}</Text></Pressable>)}</View></Field> : null}
          {kind !== 'events' ? <Field label="Tags (up to 3, comma separated)"><TextInput value={tags} onChangeText={setTags} style={inputStyle} placeholder="design, research" placeholderTextColor={colors.foregroundSoft} /></Field> : null}
          {kind === 'threads' ? <Toggle label="Allow replies" value={allowReplies} onValueChange={setAllowReplies} colors={colors} /> : null}
          {kind === 'events' ? <>
            <Field label="Starts"><TextInput value={eventDate} onChangeText={setEventDate} style={inputStyle} placeholder="2026-08-15 18:30" placeholderTextColor={colors.foregroundSoft} /></Field>
            <Field label="Ends (optional)"><TextInput value={endDate} onChangeText={setEndDate} style={inputStyle} placeholder="2026-08-15 20:00" placeholderTextColor={colors.foregroundSoft} /></Field>
            <Toggle label="Online event" value={isOnline} onValueChange={setIsOnline} colors={colors} />
            <Field label={isOnline ? 'Meeting link' : 'Location'}><TextInput value={isOnline ? meetLink : location} onChangeText={isOnline ? setMeetLink : setLocation} style={inputStyle} autoCapitalize="none" placeholder={isOnline ? 'https://meet.example.com' : 'Venue or address'} placeholderTextColor={colors.foregroundSoft} /></Field>
            <Field label="Maximum attendees (optional)"><TextInput value={maxAttendees} onChangeText={setMaxAttendees} style={inputStyle} keyboardType="number-pad" placeholder="No limit" placeholderTextColor={colors.foregroundSoft} /></Field>
          </> : null}
          <Toggle label="Share publicly" description="Also show this post in the public community feed." value={isPublic} onValueChange={setIsPublic} colors={colors} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { const colors = useColors(); return <View style={styles.field}><Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>{children}</View>; }
function Toggle({ label, description, value, onValueChange, colors }: { label: string; description?: string; value: boolean; onValueChange: (v: boolean) => void; colors: ReturnType<typeof useColors> }) { return <View style={styles.toggle}><View style={styles.toggleCopy}><Text style={[styles.toggleLabel, { color: colors.foreground }]}>{label}</Text>{description ? <Text style={[styles.toggleDescription, { color: colors.mutedForeground }]}>{description}</Text> : null}</View><Switch value={value} onValueChange={onValueChange} trackColor={{ false: colors.border, true: colors.primary }} /></View>; }
function labelFor(kind: ContentKind) { return kind === 'threads' ? 'Thread' : kind === 'events' ? 'Event' : 'Resource'; }
function bodyToThread(body: string) { const trimmed = body.trim(); const firstLine = trimmed.split('\n')[0]?.trim() ?? ''; const title = (firstLine || trimmed).slice(0, 120) || 'Thread'; return { title, description: trimmed || title }; }
function threadToBody(title: string, description: string | null) { if (description?.startsWith(title)) return description; return description ? `${title}\n\n${description}` : title; }
function extractLinks(text: string) { return [...new Set(text.match(/https?:\/\/[^\s<>"]+/g) ?? [])]; }
function toLocalDateTime(iso: string) { const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function parseDateTime(value: string) { const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/); if (!match) return null; const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }

const styles = StyleSheet.create({
  root: { flex: 1 }, header: { minHeight: 64, paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, title: { flex: 1, fontFamily: 'Geist_600SemiBold', fontSize: 19 },
  save: { minWidth: 68, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }, saveText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  form: { padding: 20, gap: 20 }, field: { gap: 8 }, label: { fontFamily: 'Geist_500Medium', fontSize: 13 },
  input: { minHeight: 48, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, fontFamily: 'Geist_400Regular', fontSize: 15 }, multiline: { minHeight: 124, paddingTop: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 }, chipText: { fontFamily: 'Geist_500Medium', fontSize: 13, textTransform: 'capitalize' },
  toggle: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }, toggleCopy: { flex: 1, gap: 3 }, toggleLabel: { fontFamily: 'Geist_500Medium', fontSize: 15 }, toggleDescription: { fontFamily: 'Geist_400Regular', fontSize: 12, lineHeight: 17 }, error: { fontFamily: 'Geist_500Medium', fontSize: 14, lineHeight: 20 },
  imageList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, imagePreviewShell: { width: 86, height: 86 }, imagePreview: { width: '100%', height: '100%', borderRadius: 10 }, removeImage: { position: 'absolute', right: 4, top: 4, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, addImage: { minHeight: 48, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, addImageText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
});
