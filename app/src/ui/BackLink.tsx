import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from './components';
import { colors, radius } from './theme';

/** Header back control (44 × 44): back in the history, or to Home after a direct visit. */
export function BackLink({ label = 'Kembali ke beranda' }: { label?: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
    >
      <Icon name="arrow-back" size={24} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, marginLeft: -10 },
  pressed: { backgroundColor: colors.chipBg },
});
