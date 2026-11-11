import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { isReleasePresentation } from '@/config/releasePresentation';
import { localDate } from '@/engine/util';
import { StarterPending, normalStarter, starterBeta } from '@/pilot/unitA/StarterHome';
import { UnitAPilotScreen } from '@/pilot/unitA/UnitAPilotScreen';
import { useApp } from '@/ui/AppContext';
import { IconButton, Page } from '@/ui/components';
import { HydrationGate } from '@/ui/Hydration';
import { colors } from '@/ui/theme';

/**
 * Unit A pilot (developer prototype, and the reviewed starter of the private beta or the normal user build). Writes
 * pilot progress, so read-only tabs see the notice instead. A genuine release presentation that is not a validated
 * normal user build never offers the pilot: a direct link goes Home before any screen mounts or storage is read. A
 * private beta or normal user build whose starter is not reviewed shows that, also before either.
 */
export default function UnitAPilotRoute() {
  const { rules } = useApp();
  const normal = normalStarter(rules.mode);
  if (normal === 'off' && isReleasePresentation(rules.mode)) return <Redirect href="/" />;
  if (normal === 'pending' || starterBeta(rules.mode) === 'pending') {
    return (
      <View style={styles.root}>
        <View style={styles.bar}>
          <IconButton icon="arrow-back" label="Kembali ke Beranda" testID="pilot-home" onPress={() => router.dismissTo('/')} />
        </View>
        <Page>
          <StarterPending />
        </Page>
      </View>
    );
  }
  return (
    <HydrationGate write>
      <UnitAPilot />
    </HydrationGate>
  );
}

/** Account liveness that is missing never holds. */
const inactive = () => false;

function UnitAPilot() {
  const { store, learner, dataset, rules, readOnly, datasetActive, answersSaved } = useApp();
  // Answers are captured for the account's learner only in the reviewed tester beta or normal user build; guest and developer
  // stay as they were. The same opt-in alone passes the account notification, as the provider bound it (stable per binding,
  // so never rewrapped).
  const capture = dataset === 'account' && (starterBeta(rules.mode) === 'reviewed' || normalStarter(rules.mode) === 'reviewed');
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
  const openNextLesson = useCallback(() => router.push('/next-lesson'), []);

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
          onNextLesson={rules.mode === 'developer-demo' ? openNextLesson : undefined}
          active={capture ? (datasetActive ?? inactive) : undefined}
          captureLearnerId={capture ? learner.learner_id : undefined}
          onAnswersSaved={capture ? answersSaved : undefined}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  bar: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 8 },
});
