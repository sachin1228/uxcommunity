import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { View, ActivityIndicator } from 'react-native';
import { useColors } from '@/hooks/useColors';

/**
 * Root entry point — redirects to the right place based on auth state.
 * This prevents the +not-found screen from flashing after login/logout.
 */
export default function Index() {
  const { user, isLoading } = useAuth();
  const colors = useColors();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return <Redirect href={user ? '/(tabs)' : '/(auth)/login'} />;
}
