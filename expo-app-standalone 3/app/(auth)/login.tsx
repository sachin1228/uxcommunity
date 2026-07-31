import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

export default function LoginScreen() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const { login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const styles = makeStyles(colors);

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      // RootLayoutNav watches auth state — it will switch to (tabs) automatically
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.logoMark, { backgroundColor: colors.primary }]}>
              <Text style={styles.logoLetter}>D</Text>
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Welcome back
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Sign in to your account
            </Text>
          </View>

          {/* Card */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            {/* Error banner */}
            {error && (
              <View
                style={[
                  styles.errorBanner,
                  { backgroundColor: colors.destructive + '18', borderColor: colors.destructive + '44' },
                ]}
              >
                <Text style={[styles.errorText, { color: colors.destructive }]}>
                  {error}
                </Text>
              </View>
            )}

            {/* Email */}
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>
                Email
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surface,
                    borderColor: emailFocused ? colors.primary : colors.border,
                    color: colors.foreground,
                  },
                ]}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  if (error) setError(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                returnKeyType="next"
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                editable={!isLoading}
              />
            </View>

            {/* Password */}
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>
                Password
              </Text>
              <View
                style={[
                  styles.inputRow,
                  {
                    backgroundColor: colors.surface,
                    borderColor: passwordFocused ? colors.primary : colors.border,
                  },
                ]}
              >
                <TextInput
                  style={[styles.inputInner, { color: colors.foreground }]}
                  placeholder="••••••••"
                  placeholderTextColor={colors.mutedForeground}
                  value={password}
                  onChangeText={(v) => {
                    setPassword(v);
                    if (error) setError(null);
                  }}
                  secureTextEntry={!showPassword}
                  textContentType="password"
                  autoComplete="current-password"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  editable={!isLoading}
                />
                <Pressable
                  onPress={() => setShowPassword((s) => !s)}
                  hitSlop={8}
                  style={styles.eyeBtn}
                >
                  <Text
                    style={[styles.eyeText, { color: colors.mutedForeground }]}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Submit */}
            <Pressable
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: isLoading
                    ? colors.primaryHover
                    : pressed
                      ? colors.primaryHover
                      : colors.primary,
                  opacity: isLoading ? 0.85 : 1,
                },
              ]}
              onPress={handleLogin}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
            >
              {isLoading ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Text
                  style={[styles.buttonText, { color: colors.primaryForeground }]}
                >
                  Sign in
                </Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

type Colors = ReturnType<typeof useColors>;

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 48,
    },
    header: {
      alignItems: 'center',
      marginBottom: 32,
    },
    logoMark: {
      width: 56,
      height: 56,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    logoLetter: {
      fontSize: 26,
      fontFamily: 'Inter_700Bold',
      color: '#FFFFFF',
    },
    title: {
      fontSize: 26,
      fontFamily: 'Inter_700Bold',
      letterSpacing: -0.5,
      marginBottom: 6,
    },
    subtitle: {
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
    },
    card: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 24,
      gap: 20,
      // subtle shadow
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 3,
    },
    errorBanner: {
      borderRadius: 8,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    errorText: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      lineHeight: 18,
    },
    field: {
      gap: 6,
    },
    label: {
      fontSize: 13,
      fontFamily: 'Inter_500Medium',
    },
    input: {
      height: 44,
      borderRadius: 8,
      borderWidth: 1,
      paddingHorizontal: 14,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
    },
    inputRow: {
      height: 44,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 14,
      paddingRight: 10,
    },
    inputInner: {
      flex: 1,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
    },
    eyeBtn: {
      paddingHorizontal: 4,
    },
    eyeText: {
      fontSize: 13,
      fontFamily: 'Inter_500Medium',
    },
    button: {
      height: 46,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    buttonText: {
      fontSize: 15,
      fontFamily: 'Inter_600SemiBold',
    },
  });
}
