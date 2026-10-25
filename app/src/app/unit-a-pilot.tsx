import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { localDate } from '@/engine/util';
import { UnitAPilotScreen } from '@/pilot/unitA/UnitAPilotScreen';
import { useApp } from '@/ui/AppContext';
import { IconButton } from '@/ui/components';
import { HydrationGate } from '@/ui/Hydration';
import { colors } from '@/ui/theme';

/** Unit A pilot (developer prototype). Writes pilot progress, so read-only tabs see the notice instead. */
export default function UnitAPilotRoute() {
  return (
    <HydrationGate write>
      <UnitAPilot />
    </HydrationGate>
  );
}

function UnitAPilot() {
  const { store, learner, dataset, rules, readOnly } = useApp();
  // 0 while the route is blurred: a retained route keeps no pilot content or controller alive. Each focus
  // mounts a fresh screen, which loads from the store again.
  const visits = useRef(0);
  const [visit, setVisit] = useState(0);
  useFocusEffect(
    useCallback(() => {
      visits.current += 1;
      setVisit(visits.current);
      return () => setVisit(0);
    }, [])
  );
  const today = useCallback(() => localDate(Date.now()), []);

  // No learner yet: Home runs the profile and consent flow.
  if (!learner || !store) return <Redirect href="/" />;

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <IconButton icon="arrow-back" label="Kembali ke Beranda" testID="pilot-home" onPress={() => router.dismissTo('/')} />
      </View>
      {visit > 0 ? (
        <UnitAPilotScreen
          key={visit}
          store={store}
          owner={`${dataset}:${learner.learner_id}`}
          mode={rules.mode}
          readOnly={readOnly}
          arabicScale={learner.arabic_scale}
          today={today}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  bar: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 8 },
});
