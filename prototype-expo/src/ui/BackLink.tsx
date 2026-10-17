import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { Icon } from './components';
import { colors } from './theme';

export function BackLink({ label = 'Beranda' }: { label?: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      style={{ paddingVertical: 4, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}
    >
      <Icon name="arrow-back" size={18} color={colors.indigoText} />
      <Text style={{ color: colors.indigoText, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
