import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { learningBetaEnabled } from '@/config/learningBeta';
import { isReleasePresentation } from '@/config/releasePresentation';
import { localDate } from '@/engine/util';
import { NextLessonScreen } from '@/pilot/nextLesson/NextLessonScreen';
import type { Store } from '@/storage/types';
import { useApp } from '@/ui/AppContext';
import { HydrationGate } from '@/ui/Hydration';
import { colors } from '@/ui/theme';

/**
 * Next lesson pilot (developer prototype), opened from qualified Unit A progress. Writes its own progress, so
 * read-only tabs see the notice instead. A direct link opens the same screen, whose controller checks the
 * learner's Unit A qualification afresh on every operation. A genuine release presentation never offers it: a direct
 * link goes Home before any screen mounts or storage is read.
 */
export default function NextLessonRoute() {
  const { ready, error, store, learner, dataset, rules, readOnly } = useApp();
  const owner = learner ? `${dataset}:${learner.learner_id}` : null;
  // The selected learner, store and write permission, kept above the gate: a switch to a read-only account (or a
  // reset, or a store that is not ready) makes the gate unmount the screen in the same commit, so a ref inside it
  // would never see the switch. Updated in that commit's layout phase, before the unmounted screen's passive cleanup
  // or any queued continuation runs, so its pause sees the switch before it writes.
  const selected = useRef({ ready, error, store, owner, mode: rules.mode, readOnly });
  useLayoutEffect(() => {
    selected.current = { ready, error, store, owner, mode: rules.mode, readOnly };
  }, [ready, error, store, owner, rules.mode, readOnly]);
  const consented = useCallback((forOwner: string, forStore: Store) => {
    const s = selected.current;
    return (
      s.ready &&
      s.error === null &&
      s.readOnly === null &&
      s.mode === 'developer-demo' &&
      s.owner === forOwner &&
      s.store === forStore
    );
  }, []);
  // After every hook above, so the hook order stays the same when the mode or configuration changes.
  // A validated learning beta is bounded starter access: the same Home redirect, before the gate mounts.
  if (isReleasePresentation(rules.mode) || learningBetaEnabled()) return <Redirect href="/" />;
  return (
    <HydrationGate write>
      <NextLesson consented={consented} />
    </HydrationGate>
  );
}

function NextLesson({ consented }: { consented: (owner: string, store: Store) => boolean }) {
  const { store, learner, dataset, rules, readOnly } = useApp();
  const owner = learner ? `${dataset}:${learner.learner_id}` : null;
  // 0 while the route is blurred: a retained route keeps no lesson content or controller alive. Each focus
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
  const back = useCallback(() => router.dismissTo('/unit-a-pilot'), []);

  // No learner yet: Home runs the profile and consent flow.
  if (!learner || !store || owner === null) return <Redirect href="/" />;

  return (
    <View style={styles.root}>
      {visit > 0 ? (
        <NextLessonScreen
          key={visit}
          store={store}
          owner={owner}
          mode={rules.mode}
          readOnly={readOnly}
          arabicScale={learner.arabic_scale}
          today={today}
          onBack={back}
          consented={consented}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
});
