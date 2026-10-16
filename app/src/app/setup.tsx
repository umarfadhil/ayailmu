import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp } from '@/ui/AppContext';
import { Btn, Eyebrow, H1, Muted, Notice, Page } from '@/ui/components';
import { HydrationGate } from '@/ui/Hydration';

/** Session length (E-B4 equivalent). Creates the local learner ID only after an in-app consent receipt. */
function SetupRoute() {
  const { learner, rules, consentReceipt, createLearner } = useApp();
  const [minutes, setMinutes] = useState(rules.default_session_minutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (learner) return <Redirect href="/" />;
  // Direct or refreshed /setup without consent in this app run goes back to consent.
  if (!consentReceipt) return <Redirect href="/consent" />;

  return (
    <Page>
      <Eyebrow tone="indigo">Pengaturan awal</Eyebrow>
      <H1>Berapa lama Anda ingin belajar setiap hari?</H1>
      <View style={styles.options} accessibilityRole="radiogroup">
        {rules.session_minutes_options.map((m) => (
          <View key={m} style={styles.option}>
            <Btn
              testID={`minutes-${m}`}
              kind="secondary"
              selected={minutes === m}
              label={`${m} menit`}
              icon={minutes === m ? 'checkmark-circle' : 'time-outline'}
              onPress={() => setMinutes(m)}
            />
          </View>
        ))}
      </View>
      <Muted>Anda bisa mengubahnya nanti di Pengaturan.</Muted>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Btn
        testID="setup-continue"
        label="Lanjut"
        icon="arrow-forward"
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await createLearner(minutes);
            router.replace('/');
          } catch {
            setError('Belum tersimpan. Coba lagi.');
          } finally {
            setBusy(false);
          }
        }}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  option: { flexGrow: 1, flexBasis: 100 },
});

export default function Setup() {
  return (
    <HydrationGate write>
      <SetupRoute />
    </HydrationGate>
  );
}
