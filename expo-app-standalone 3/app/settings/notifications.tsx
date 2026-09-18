/**
 * Notifications settings.
 *
 * Three decisions live here, in the order a member actually makes them:
 * whether chat pushes arrive at all, when they are allowed to make a noise
 * (sound + quiet hours), and which communities are exempt from either. The
 * fourth section is diagnostics — a device that is not receiving
 * notifications should be able to say why, instead of leaving a member to
 * guess between permission, channel and FCM problems.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useNotificationSettings } from '@/hooks/useNotificationSettings';
import { getCommunities, Community } from '@/lib/communities';
import { deviceTimeZone } from '@/lib/notificationSettings';
import {
  PushDiagnostics,
  ServerPushTestResult,
  getPushDiagnostics,
  registerForPushNotificationsAsync,
  sendServerPushTestAsync,
  sendTestNotificationAsync,
} from '@/lib/push';

/** Every selectable quiet-hours boundary, on the half hour. */
const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2);
  const minutes = index % 2 === 0 ? '00' : '30';
  return `${String(hours).padStart(2, '0')}:${minutes}`;
});

/** "22:30" → "10:30 PM", so the picker reads like a phone clock. */
function formatClock(value: string): string {
  const [hoursText, minutes] = value.split(':');
  const hours = Number(hoursText);
  const suffix = hours < 12 ? 'AM' : 'PM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${suffix}`;
}

export default function NotificationSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const {
    preferences,
    mutedCommunityIds,
    unreadCount,
    isLoading,
    error,
    reload,
    updatePreferences,
    updateQuietHours,
    setCommunityMuted,
  } = useNotificationSettings();

  const [communities, setCommunities] = useState<Community[]>([]);
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [serverResult, setServerResult] = useState<ServerPushTestResult | null>(null);
  const [serverTesting, setServerTesting] = useState(false);
  /** Which quiet-hours boundary the time sheet is editing, if any. */
  const [editingTime, setEditingTime] = useState<'start' | 'end' | null>(null);
  const [retryingRegistration, setRetryingRegistration] = useState(false);

  useEffect(() => {
    getCommunities()
      .then((list) => setCommunities(list))
      .catch(() => {
        /* the mute list is optional context, not the point of the screen */
      });
  }, []);

  const refreshDiagnostics = useCallback(async () => {
    setDiagnostics(await getPushDiagnostics());
  }, []);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  /**
   * Re-runs registration from scratch. The root layout only registers once per
   * signed-in member and remembers that in memory, so a first attempt that
   * failed (a 404 before the API was deployed, a permission granted after the
   * fact, a token expired while the app slept) would otherwise stay broken
   * until the member force-quit the app. Registration is idempotent — it mints
   * a token and re-points it server-side — so retrying is always safe.
   */
  const retryRegistration = useCallback(async () => {
    setRetryingRegistration(true);
    try {
      await registerForPushNotificationsAsync();
      await refreshDiagnostics();
    } finally {
      setRetryingRegistration(false);
    }
  }, [refreshDiagnostics]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    const result = await sendTestNotificationAsync();
    setTestResult(
      result.ok
        ? 'Sent. If nothing appears, notifications are blocked for this app in system settings.'
        : `Could not send: ${result.error ?? 'unknown error'}`,
    );
    setTesting(false);
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  const handleServerTest = useCallback(async () => {
    setServerTesting(true);
    setServerResult(null);
    const result = await sendServerPushTestAsync();
    setServerResult(result);
    setServerTesting(false);
  }, []);

  const mutedSet = useMemo(() => new Set(mutedCommunityIds), [mutedCommunityIds]);

  const summary = useMemo(() => {
    if (!preferences.chatPushEnabled) return 'Chat notifications are off';
    if (preferences.quietHoursEnabled) {
      return `Quiet ${formatClock(preferences.quietHoursStart)} – ${formatClock(preferences.quietHoursEnd)}`;
    }
    return preferences.chatSound === 'silent' ? 'Silent, no sound' : 'Sound on';
  }, [preferences]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.subtle }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.subtle,
            borderBottomColor: colors.border,
            paddingTop: insets.top + 8,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground }]}>Notifications</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{summary}</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <Pressable
              onPress={() => void reload()}
              style={[styles.errorBanner, { borderColor: colors.destructive }]}
            >
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
              <Text style={[styles.errorHint, { color: colors.mutedForeground }]}>
                Tap to retry
              </Text>
            </Pressable>
          ) : null}

          <Section title="Messages" colors={colors}>
            <Row
              colors={colors}
              label="Chat notifications"
              description="Get a notification when someone messages in a community you belong to."
            >
              <Switch
                value={preferences.chatPushEnabled}
                onValueChange={(value) => void updatePreferences({ chatPushEnabled: value })}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </Row>

            <Divider colors={colors} />

            <Row
              colors={colors}
              label="Sound"
              description={
                preferences.chatSound === 'silent'
                  ? 'Notifications arrive without a sound.'
                  : 'Play the system notification sound.'
              }
            >
              <Segmented
                colors={colors}
                value={preferences.chatSound}
                options={[
                  { value: 'default', label: 'Default' },
                  { value: 'silent', label: 'Silent' },
                ]}
                onChange={(value) =>
                  void updatePreferences({ chatSound: value as 'default' | 'silent' })
                }
                disabled={!preferences.chatPushEnabled}
              />
            </Row>
          </Section>

          <Section title="Quiet hours" colors={colors}>
            <Row
              colors={colors}
              label="Mute at night"
              description={`Chats stay silent between these times, in your own timezone (${deviceTimeZone()}). Messages still arrive and still count as unread — they just do not make a noise.`}
            >
              <Switch
                value={preferences.quietHoursEnabled}
                onValueChange={(value) => void updateQuietHours({ quietHoursEnabled: value })}
                trackColor={{ true: colors.primary, false: colors.border }}
                disabled={!preferences.chatPushEnabled}
              />
            </Row>

            {preferences.quietHoursEnabled ? (
              <>
                <Divider colors={colors} />
                <Row colors={colors} label="From" description="Quiet hours start">
                  <TimeButton
                    colors={colors}
                    value={preferences.quietHoursStart}
                    onPress={() => setEditingTime('start')}
                  />
                </Row>
                <Divider colors={colors} />
                <Row colors={colors} label="Until" description="Quiet hours end">
                  <TimeButton
                    colors={colors}
                    value={preferences.quietHoursEnd}
                    onPress={() => setEditingTime('end')}
                  />
                </Row>
              </>
            ) : null}
          </Section>

          <Section
            title="Communities"
            colors={colors}
            footer="Muted communities never notify you. Unread messages still show in the app and still count toward the badge."
          >
            {communities.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                You are not in any communities yet.
              </Text>
            ) : (
              communities.map((community, index) => (
                <React.Fragment key={community.id}>
                  {index > 0 ? <Divider colors={colors} /> : null}
                  <Row
                    colors={colors}
                    label={community.name}
                    description={
                      mutedSet.has(community.id)
                        ? `Muted${community.unread_count > 0 ? ` · ${community.unread_count} unread` : ''}`
                        : community.unread_count > 0
                          ? `${community.unread_count} unread`
                          : 'Notifications on'
                    }
                  >
                    <Switch
                      value={!mutedSet.has(community.id)}
                      onValueChange={(enabled) =>
                        void setCommunityMuted(community.id, !enabled)
                      }
                      trackColor={{ true: colors.primary, false: colors.border }}
                    />
                  </Row>
                </React.Fragment>
              ))
            )}
          </Section>

          <Section
            title="This device"
            colors={colors}
            footer="A test notification is generated on the phone itself. If it appears but chat messages still do not, the phone is fine and the problem is on the sending side."
          >
            <DiagnosticRow
              colors={colors}
              label="System permission"
              value={diagnostics?.permission ?? 'unknown'}
              ok={diagnostics?.permission === 'granted'}
            />
            <Divider colors={colors} />
            <DiagnosticRow
              colors={colors}
              label="Push registration"
              value={
                retryingRegistration ? 'retrying…' : diagnostics?.status ?? 'unknown'
              }
              ok={diagnostics?.status === 'registered'}
              onPress={
                diagnostics?.status === 'registered' || retryingRegistration
                  ? undefined
                  : () => void retryRegistration()
              }
              actionHint="Retry"
            />
            <Divider colors={colors} />
            <DiagnosticRow
              colors={colors}
              label="FCM device token"
              value={
                diagnostics?.deviceToken
                  ? `…${diagnostics.deviceToken.slice(-12)}`
                  : 'not available'
              }
              ok={!!diagnostics?.deviceToken}
            />
            {diagnostics?.deviceTokenError ? (
              <>
                <Divider colors={colors} />
                <View style={styles.tokenBlock}>
                  <Text style={[styles.rowLabel, { color: colors.destructive }]}>
                    {Platform.OS === 'android'
                      ? 'Android push is not wired up in this build'
                      : 'Device token unavailable'}
                  </Text>
                  <Text style={[styles.errorHint, { color: colors.mutedForeground }]}>
                    {diagnostics.deviceTokenError}
                  </Text>
                  {Platform.OS === 'android' ? (
                    <Text style={[styles.errorHint, { color: colors.mutedForeground }]}>
                      Android push needs a Firebase project: add google-services.json for package
                      in.uxcommunity.app, regenerate the native project, and upload the FCM v1
                      service-account key to Expo.
                    </Text>
                  ) : null}
                </View>
              </>
            ) : null}
            <Divider colors={colors} />
            <DiagnosticRow
              colors={colors}
              label="Android channels"
              value={diagnostics?.channels.length ? diagnostics.channels.join(', ') : 'none'}
              ok={(diagnostics?.channels.length ?? 0) > 0}
            />
            <Divider colors={colors} />
            <Row
              colors={colors}
              label="Unread right now"
              description="What the app icon badge is set to"
            >
              <Text style={[styles.diagnosticValue, { color: colors.foreground }]}>
                {unreadCount}
              </Text>
            </Row>

            {diagnostics?.token ? (
              <>
                <Divider colors={colors} />
                <View style={styles.tokenBlock}>
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                    Expo push token
                  </Text>
                  <Text
                    style={[styles.tokenText, { color: colors.mutedForeground }]}
                    selectable
                  >
                    {diagnostics.token}
                  </Text>
                </View>
              </>
            ) : null}

            {diagnostics?.error ? (
              <>
                <Divider colors={colors} />
                <View style={styles.tokenBlock}>
                  <Text style={[styles.rowLabel, { color: colors.destructive }]}>
                    Last problem
                  </Text>
                  <Text style={[styles.errorHint, { color: colors.mutedForeground }]}>
                    {diagnostics.error}
                  </Text>
                  {!retryingRegistration ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void retryRegistration()}
                      hitSlop={8}
                    >
                      <Text style={[styles.retryLink, { color: colors.primary }]}>
                        Try registering this device again
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : null}

            <Divider colors={colors} />
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleTest()}
              style={({ pressed }) => [
                styles.testButton,
                { backgroundColor: pressed ? colors.primaryHover : colors.primary },
              ]}
            >
              {testing ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.testButtonText, { color: colors.primaryForeground }]}>
                  Send a test notification
                </Text>
              )}
            </Pressable>
            {testResult ? (
              <Text style={[styles.testResult, { color: colors.mutedForeground }]}>
                {testResult}
              </Text>
            ) : null}

            <Divider colors={colors} />
            <Text style={[styles.stepHint, { color: colors.mutedForeground }]}>
              That one is generated on the phone. This next one goes all the way out to the server
              and back through Expo, which is the half that fails without an FCM key.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleServerTest()}
              style={({ pressed }) => [
                styles.testButton,
                {
                  backgroundColor: pressed ? colors.subtle : colors.card,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                },
              ]}
            >
              {serverTesting ? (
                <ActivityIndicator color={colors.foreground} />
              ) : (
                <Text style={[styles.testButtonText, { color: colors.foreground }]}>
                  Send a real push from the server
                </Text>
              )}
            </Pressable>
            {serverResult ? (
              <View style={styles.serverResult}>
                {serverResult.failure ? (
                  <Text style={[styles.errorText, { color: colors.destructive }]}>
                    {serverResult.failure}
                  </Text>
                ) : (
                  <Text
                    style={[
                      styles.rowLabel,
                      { color: serverResult.ok ? colors.success : colors.destructive },
                    ]}
                  >
                    {serverResult.ok
                      ? `Accepted for ${serverResult.delivered} of ${serverResult.total} device${
                          serverResult.total === 1 ? '' : 's'
                        }`
                      : `Expo rejected every device`}
                  </Text>
                )}

                {serverResult.devices.map((device) => (
                  <Text
                    key={`${device.platform}-${device.tokenSuffix}`}
                    style={[styles.errorHint, { color: colors.mutedForeground }]}
                  >
                    {device.ok
                      ? `${device.platform} …${device.tokenSuffix}: accepted`
                      : `${device.platform} …${device.tokenSuffix}: ${device.error ?? 'failed'}`}
                    {device.hint ? `\n${device.hint}` : ''}
                  </Text>
                ))}

                {serverResult.requestError ? (
                  <Text style={[styles.errorHint, { color: colors.mutedForeground }]}>
                    {serverResult.requestError}
                  </Text>
                ) : null}

                {serverResult.ok ? (
                  <Text style={[styles.errorHint, { color: colors.mutedForeground }]}>
                    The server handed it to Expo. If nothing appeared, check that notifications are
                    allowed for this app, then background the app and send it again.
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Section>
        </ScrollView>
      )}

      <TimeSheet
        colors={colors}
        visible={editingTime !== null}
        title={editingTime === 'start' ? 'Quiet hours start' : 'Quiet hours end'}
        value={
          editingTime === 'start' ? preferences.quietHoursStart : preferences.quietHoursEnd
        }
        onClose={() => setEditingTime(null)}
        onSelect={(value) => {
          setEditingTime(null);
          void updateQuietHours(
            editingTime === 'start' ? { quietHoursStart: value } : { quietHoursEnd: value },
          );
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

type Palette = ReturnType<typeof useColors>;

function Section({
  title,
  footer,
  colors,
  children,
}: {
  title: string;
  footer?: string;
  colors: Palette;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        {title.toUpperCase()}
      </Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {children}
      </View>
      {footer ? (
        <Text style={[styles.sectionFooter, { color: colors.mutedForeground }]}>{footer}</Text>
      ) : null}
    </View>
  );
}

function Row({
  label,
  description,
  colors,
  children,
}: {
  label: string;
  description?: string;
  colors: Palette;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
        {description ? (
          <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
            {description}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowControl}>{children}</View>
    </View>
  );
}

function Divider({ colors }: { colors: Palette }) {
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

function DiagnosticRow({
  label,
  value,
  ok,
  colors,
  onPress,
  actionHint,
}: {
  label: string;
  value: string;
  ok: boolean;
  colors: Palette;
  /** When set, the row becomes the retry affordance for a failing check. */
  onPress?: () => void;
  actionHint?: string;
}) {
  const body = (
    <>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
      </View>
      <View style={styles.diagnosticBadge}>
        <View
          style={[
            styles.dot,
            { backgroundColor: ok ? colors.success : colors.mutedForeground },
          ]}
        />
        <Text style={[styles.diagnosticValue, { color: colors.mutedForeground }]}>
          {value}
        </Text>
        {onPress && actionHint ? (
          <Text style={[styles.retryLink, { color: colors.primary }]}>{actionHint}</Text>
        ) : null}
      </View>
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {body}
    </Pressable>
  );
}

function Segmented({
  value,
  options,
  onChange,
  colors,
  disabled,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  colors: Palette;
  disabled?: boolean;
}) {
  return (
    <View
      style={[
        styles.segmented,
        { backgroundColor: colors.subtle, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              active && { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                { color: active ? colors.foreground : colors.mutedForeground },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TimeButton({
  value,
  onPress,
  colors,
}: {
  value: string;
  onPress: () => void;
  colors: Palette;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.timeButton,
        {
          borderColor: colors.border,
          backgroundColor: pressed ? colors.subtle : colors.card,
        },
      ]}
    >
      <Text style={[styles.timeButtonText, { color: colors.foreground }]}>
        {formatClock(value)}
      </Text>
      <Ionicons name="chevron-down" size={14} color={colors.mutedForeground} />
    </Pressable>
  );
}

/** Half-hour list sheet — a clock dial would be nicer, but a list is honest. */
function TimeSheet({
  visible,
  title,
  value,
  onClose,
  onSelect,
  colors,
}: {
  visible: boolean;
  title: string;
  value: string;
  onClose: () => void;
  onSelect: (value: string) => void;
  colors: Palette;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.card }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView>
            {TIME_OPTIONS.map((option) => {
              const active = option === value;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => onSelect(option)}
                  style={({ pressed }) => [
                    styles.sheetOption,
                    pressed && { backgroundColor: colors.subtle },
                  ]}
                >
                  <Text
                    style={[
                      styles.sheetOptionText,
                      { color: active ? colors.primary : colors.foreground },
                    ]}
                  >
                    {formatClock(option)}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark" size={18} color={colors.primary} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  title: { fontSize: 20, fontFamily: 'Geist_700Bold', letterSpacing: -0.4 },
  subtitle: { fontSize: 12, fontFamily: 'Geist_400Regular', marginTop: 2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 24 },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Geist_600SemiBold',
    letterSpacing: 0.8,
    marginLeft: 4,
  },
  sectionFooter: {
    fontSize: 12,
    fontFamily: 'Geist_400Regular',
    lineHeight: 17,
    marginLeft: 4,
    marginRight: 4,
  },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontFamily: 'Geist_500Medium' },
  rowDescription: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 17 },
  rowControl: { alignItems: 'flex-end' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 14 },
  emptyText: {
    fontSize: 13,
    fontFamily: 'Geist_400Regular',
    padding: 14,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 2,
    gap: 2,
  },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  segmentText: { fontSize: 13, fontFamily: 'Geist_500Medium' },
  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  timeButtonText: { fontSize: 14, fontFamily: 'Geist_500Medium' },
  diagnosticBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '55%' },
  diagnosticValue: { fontSize: 13, fontFamily: 'Geist_500Medium', textAlign: 'right' },
  retryLink: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  rowPressed: { opacity: 0.6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tokenBlock: { paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  tokenText: { fontSize: 11, fontFamily: 'Geist_400Regular', lineHeight: 16 },
  testButton: {
    margin: 14,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testButtonText: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
  testResult: {
    fontSize: 12,
    fontFamily: 'Geist_400Regular',
    lineHeight: 17,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  stepHint: {
    fontSize: 12,
    fontFamily: 'Geist_400Regular',
    lineHeight: 17,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  serverResult: {
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  errorBanner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  errorText: { fontSize: 13, fontFamily: 'Geist_500Medium' },
  errorHint: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 17 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 16, fontFamily: 'Geist_600SemiBold' },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  sheetOptionText: { fontSize: 15, fontFamily: 'Geist_400Regular' },
});
