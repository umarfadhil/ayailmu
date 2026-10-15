import { Redirect, router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '@/ui/AppContext';
import { Btn, Eyebrow, H1, Muted, Page, useIsDesktop } from '@/ui/components';
import { LessonPanel } from '@/ui/LessonPanel';
import { colors, radius } from '@/ui/theme';
import { useLearning } from '@/ui/useLearning';
import { HydrationGate } from '@/ui/Hydration';

/**
 * Read-only browser for the lesson screens of units already open (S19–S22 guide anatomy).
 * Browsing never writes: it does not mark screens seen, touch the session snapshot
 * or log answers. Locked/advanced material (e.g. Unit B speech) is never shown here.
 * Practice always goes to the canonical /session.
 */
function GuideRoute() {
  const { learner, content } = useApp();
  const desktop = useIsDesktop();
  const params = useLocalSearchParams<{ screen?: string }>();
  const learning = useLearning();
  const [chosen, setIndex] = useState<number | null>(null);

  if (!learner || content.empty) return <Redirect href="/" />;
  if (learning === undefined) return null;
  if (learning === null) return <Redirect href="/" />;
  const screens = content.screens.filter((s) => learning.open.includes(s.unit));
  const index = chosen ?? Math.max(0, screens.findIndex((s) => s.screen_id === params.screen));
  const screen = screens[index];
  if (!screen) return <Redirect href="/" />;

  const contents = (
    <View style={[styles.contents, desktop && styles.contentsDesktop]} accessibilityRole="menu">
      <Text style={styles.contentsTitle}>Isi panduan</Text>
      {screens.map((s, n) => {
        const on = n === index;
        return (
          <Pressable
            key={s.screen_id}
            testID={`guide-${s.screen_id}`}
            accessibilityRole="link"
            accessibilityState={{ selected: on }}
            onPress={() => setIndex(n)}
            style={[styles.contentsRow, on && styles.contentsRowOn]}
          >
            <Text style={[styles.contentsText, on && styles.contentsTextOn]}>
              {`${s.unit}${screens.filter((x) => x.unit === s.unit).indexOf(s) + 1}. ${s.title}`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Page width="wide">
      <View style={styles.band}>
        <Eyebrow tone="mint">Panduan</Eyebrow>
        <H1>{learning.open.length > 1 ? 'Panduan Unit A dan B' : 'Panduan Unit A'}</H1>
        <Muted>
          Bacaan pendukung dari awal sesi. Membuka panduan tidak dihitung sebagai latihan dan tidak mengubah sesi Anda.
        </Muted>
      </View>
      <View style={[desktop && styles.split]}>
        {contents}
        <View style={[styles.mainCol, desktop && { flex: 1 }]}>
          <LessonPanel screen={screen} scale={learner.arabic_scale} eyebrow={`Unit ${screen.unit} · Panduan ${index + 1} dari ${screens.length}`} />
          <View style={styles.pager}>
            <View style={{ flex: 1 }}>
              <Btn
                kind="secondary"
                icon="arrow-back"
                label="Sebelumnya"
                disabled={index === 0}
                onPress={() => setIndex(index - 1)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Btn
                kind="secondary"
                label="Berikutnya"
                disabled={index === screens.length - 1}
                testID="guide-next"
                onPress={() => setIndex(index + 1)}
              />
            </View>
          </View>
          <View style={styles.bottomBar}>
            <Btn testID="guide-practice" label="Ke latihan" icon="create-outline" onPress={() => router.navigate('/session')} />
            <Btn kind="quiet" icon="arrow-back" label="Kembali ke beranda" onPress={() => router.navigate('/' as Href)} />
          </View>
        </View>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: colors.unitPanelA,
    borderColor: '#D7E3DD',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 18,
    gap: 6,
  },
  split: { flexDirection: 'row', gap: 20, alignItems: 'flex-start' },
  contents: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    gap: 2,
    marginBottom: 14,
  },
  contentsDesktop: { width: 240, marginBottom: 0 },
  contentsTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, paddingHorizontal: 8, paddingVertical: 6, writingDirection: 'ltr', textAlign: 'left' },
  contentsRow: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, borderRadius: radius.sm },
  contentsRowOn: { backgroundColor: colors.indigoSoft },
  contentsText: { fontSize: 15, color: colors.body, writingDirection: 'ltr', textAlign: 'left' },
  contentsTextOn: { color: colors.indigoText, fontWeight: '700' },
  mainCol: { gap: 14 },
  pager: { flexDirection: 'row', gap: 10 },
  bottomBar: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    gap: 6,
  },
});

export default function Guide() {
  return (
    <HydrationGate>
      <GuideRoute />
    </HydrationGate>
  );
}
