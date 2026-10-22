import React from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CompanyMark } from '@/components/companies/CompanyMark';
import { useColors } from '@/hooks/useColors';
import type { JobApplicationSummary, JobPost } from '@/lib/jobs';

/**
 * The application exactly as it was submitted, reopened from the status card:
 * every field the form carried, with the links live so the member can check
 * what the poster will read.
 */
export function ApplicationModal({
  job,
  application,
  onClose,
}: {
  job: JobPost;
  application: JobApplicationSummary;
  onClose: () => void;
}) {
  const colors = useColors();

  const open = (url: string) => {
    void Linking.openURL(url).catch(() => undefined);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.dialog, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={(event) => event.stopPropagation()}
        >
          <Text style={[styles.title, { color: colors.foreground }]}>Your application</Text>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            <View
              style={[
                styles.jobLine,
                { borderColor: colors.border, backgroundColor: colors.background },
              ]}
            >
              <CompanyMark name={job.company.name} logoUrl={job.company.logo_url} size={40} />
              <View style={styles.jobLineText}>
                <Text style={[styles.jobTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {job.title}
                </Text>
                <Text style={[styles.jobMeta, { color: colors.foregroundMuted }]} numberOfLines={1}>
                  {job.company.name} · {job.city_name}
                </Text>
              </View>
            </View>

            <View style={styles.fields}>
              <ReadOnly label="Full name" value={application.name} colors={colors} />
              <LinkField
                label="Portfolio"
                url={application.portfolio_url}
                icon="globe"
                onPress={open}
                colors={colors}
              />
              <LinkField
                label="LinkedIn"
                url={application.linkedin_url}
                icon="linkedin"
                onPress={open}
                colors={colors}
              />
              {application.resume_url ? (
                <LinkField
                  label="Resume"
                  url={application.resume_url}
                  text="View resume"
                  icon="file-text"
                  onPress={open}
                  colors={colors}
                />
              ) : null}
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.foreground }]}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ReadOnly({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

function LinkField({
  label,
  url,
  text,
  icon,
  onPress,
  colors,
}: {
  label: string;
  url: string;
  text?: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  onPress: (url: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>{label}</Text>
      <Pressable
        onPress={() => onPress(url)}
        accessibilityRole="link"
        style={styles.linkRow}
      >
        <Feather name={icon} size={12} color={colors.link} />
        <Text style={[styles.linkText, { color: colors.link }]} numberOfLines={1}>
          {text ?? url.replace(/^https?:\/\//, '')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.60)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  dialog: {
    maxHeight: '82%',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
  },
  title: { fontFamily: 'Geist_600SemiBold', fontSize: 18, marginBottom: 12 },
  scroll: { flexGrow: 0 },
  jobLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  jobLineText: { flex: 1, gap: 1 },
  jobTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  jobMeta: { fontFamily: 'Geist_400Regular', fontSize: 12 },
  fields: { gap: 14, paddingTop: 16 },
  field: { gap: 3 },
  fieldLabel: { fontFamily: 'Geist_500Medium', fontSize: 11.5 },
  fieldValue: { fontFamily: 'Geist_400Regular', fontSize: 14 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { fontFamily: 'Geist_500Medium', fontSize: 13.5, flexShrink: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 16 },
  button: {
    minWidth: 84,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonText: { fontFamily: 'Geist_600SemiBold', fontSize: 13.5 },
});
