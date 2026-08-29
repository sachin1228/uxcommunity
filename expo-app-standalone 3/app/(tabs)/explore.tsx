import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { AppHeader } from '@/components/AppHeader';
import { useColors } from '@/hooks/useColors';
import { useExploreCommunities } from '@/hooks/useExploreCommunities';
import { resolveProfilePictureUri } from '@/lib/profilePicture';
import type { ExploreCommunity } from '@/lib/explore';

const TABS = [
  { label: 'All', value: 'all' },
  { label: 'Interest', value: 'interest' },
  { label: 'Member-led', value: 'user' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

const HIDDEN_TYPES = new Set(['sector', 'city', 'experience_level']);

// ---------------------------------------------------------------------------
// Community Card
// ---------------------------------------------------------------------------

function CommunityCard({
  community,
  onJoin,
  joining,
}: {
  community: ExploreCommunity;
  onJoin: (id: string) => void;
  joining: boolean;
}) {
  const colors = useColors();
  const router = useRouter();
  const imgUri = resolveProfilePictureUri(community.image_url);
  const locked = !community.can_join && !community.joined;

  const handlePress = () => {
    if (community.joined) {
      router.push(`/community/${community.id}`);
    }
  };

  return (
    <Pressable
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
        locked && { opacity: 0.6 },
      ]}
      onPress={handlePress}
      disabled={locked}
    >
      <View style={styles.cardRow}>
        {imgUri ? (
          <Image source={{ uri: imgUri }} style={styles.cardAvatar} />
        ) : (
          <View style={[styles.cardAvatar, styles.cardAvatarFallback, { backgroundColor: colors.primary + '20' }]}>
            <Feather name="users" size={16} color={colors.primary} />
          </View>
        )}
        <View style={styles.cardInfo}>
          <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>
            {community.name}
          </Text>
          <Text style={[styles.cardCount, { color: colors.mutedForeground }]}>
            {community.member_count} {community.member_count === 1 ? 'member' : 'members'}
          </Text>
        </View>
        {community.joined ? (
          <Pressable
            style={[styles.joinedBtn, { backgroundColor: colors.primary + '15' }]}
            onPress={handlePress}
          >
            <Text style={[styles.joinedBtnText, { color: colors.primary }]}>Joined</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[
              styles.joinBtn,
              { backgroundColor: colors.primary },
              (joining || locked) && { opacity: 0.5 },
            ]}
            onPress={() => !joining && onJoin(community.id)}
            disabled={joining || locked}
          >
            {joining ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.joinBtnText}>Join</Text>
            )}
          </Pressable>
        )}
      </View>
      {community.description ? (
        <Text style={[styles.cardDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
          {community.description}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Explore Tab
// ---------------------------------------------------------------------------

export default function ExploreTab() {
  const colors = useColors();
  const { communities, loading, error, joiningId, handleJoin } = useExploreCommunities();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<TabValue>('all');

  const filtered = useMemo(() => {
    return communities.filter((c) => {
      if (c.joined) return false;
      if (HIDDEN_TYPES.has(c.type)) return false;
      const matchesTab = activeTab === 'all' || c.type === activeTab;
      const matchesSearch = c.name.toLowerCase().includes(search.trim().toLowerCase());
      return matchesTab && matchesSearch;
    });
  }, [communities, activeTab, search]);

  const recommended = useMemo(
    () => filtered.filter((c) => c.can_join),
    [filtered],
  );

  const rest = useMemo(
    () => filtered.filter((c) => !c.can_join),
    [filtered],
  );

  const renderHeader = () => (
    <View>
      {/* Search */}
      <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search communities…"
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')}>
            <Feather name="x" size={14} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.value}
            style={[
              styles.tab,
              { borderColor: 'transparent' },
              activeTab === tab.value && { borderColor: colors.primary, backgroundColor: colors.primary + '15' },
            ]}
            onPress={() => setActiveTab(tab.value)}
          >
            <Text
              style={[
                styles.tabText,
                { color: colors.mutedForeground },
                activeTab === tab.value && { color: colors.primary, fontFamily: 'Geist_600SemiBold' },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Error */}
      {error ? (
        <View style={[styles.errorBanner, { backgroundColor: '#ef444420' }]}>
          <Text style={[styles.errorText, { color: '#ef4444' }]}>{error}</Text>
        </View>
      ) : null}

      {/* Recommended section */}
      {activeTab === 'all' && recommended.length > 0 && (
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recommended for you</Text>
      )}
    </View>
  );

  const renderItem = ({ item }: { item: ExploreCommunity }) => (
    <CommunityCard
      community={item}
      onJoin={handleJoin}
      joining={joiningId === item.id}
    />
  );

  const renderFooter = () => {
    if (activeTab === 'all' && rest.length > 0) {
      return (
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>All communities</Text>
          {rest.map((c) => (
            <CommunityCard
              key={c.id}
              community={c}
              onJoin={handleJoin}
              joining={joiningId === c.id}
            />
          ))}
        </View>
      );
    }
    return null;
  };

  const listData = activeTab === 'all' ? recommended : filtered;

  return (
    <View style={[styles.root, { backgroundColor: colors.subtle }]}>
      <StatusBar style="light" />
      <AppHeader />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          ListHeaderComponent={renderHeader}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Feather name="users" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No communities found
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontFamily: 'Geist_400Regular', fontSize: 14, marginTop: 8 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  searchInput: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 14, padding: 0 },

  // Tabs
  tabRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  tabText: { fontFamily: 'Geist_500Medium', fontSize: 13 },

  // Sections
  sectionTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 14, marginTop: 20, marginBottom: 8 },

  // Error
  errorBanner: { borderRadius: 8, padding: 10, marginTop: 12 },
  errorText: { fontFamily: 'Geist_400Regular', fontSize: 13 },

  // Card
  card: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 8,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardAvatar: { width: 40, height: 40, borderRadius: 20 },
  cardAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1 },
  cardName: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  cardCount: { fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 1 },
  cardDesc: { fontFamily: 'Geist_400Regular', fontSize: 12, lineHeight: 16, marginTop: 8 },

  joinBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  joinBtnText: { fontFamily: 'Geist_600SemiBold', fontSize: 13, color: '#fff' },
  joinedBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
  },
  joinedBtnText: { fontFamily: 'Geist_600SemiBold', fontSize: 13 },
});
