import { Image, StyleSheet, View } from 'react-native';

/**
 * The community's doodle paper — the same sketch sheet the web chats draw
 * behind their messages, scaled to fill the pane so the timeline keeps
 * reading as paper rather than a solid block.
 *
 * The PNG is a white-on-transparent render of the original SVG (the app is
 * dark-only), laid absolutely behind the message list as a full-bleed cover:
 * its width always spans the screen, unlike a fixed tile that would leave a
 * strip of a second copy down the side. Purely decorative: it never takes a
 * touch and stays out of the accessibility tree.
 */
export function ChatDoodleBackground() {
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Image
        source={require('../../assets/images/background-doodle.png')}
        resizeMode="cover"
        style={[StyleSheet.absoluteFill, { opacity: 0.05 }]}
      />
    </View>
  );
}
