import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useApp } from '@/ui/AppContext';
import { Btn, Card, Eyebrow, H1, H2, Notice, P, Page } from '@/ui/components';
import { colors } from '@/ui/theme';

function Check({ value, onChange, label, testID }: { value: boolean; onChange: (v: boolean) => void; label: string; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 8, minHeight: 44 }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 5,
          borderWidth: 2,
          borderColor: colors.indigo,
          backgroundColor: value ? colors.indigo : colors.white,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {value ? <Text style={{ color: '#fff', fontWeight: '700' }}>✓</Text> : null}
      </View>
      <Text style={{ flex: 1, fontSize: 16, lineHeight: 24, color: colors.ink }}>{label}</Text>
    </Pressable>
  );
}

/** Demo consent (spec §11). No learner ID or data is created until the learner agrees. */
export default function Consent() {
  const { learner, content, giveConsent } = useApp();
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);

  if (learner) return <Redirect href="/" />;
  if (content.empty) return <Redirect href="/" />;

  return (
    <Page>
      <Eyebrow tone="indigo">Arabic Trial</Eyebrow>
      <H1>Selamat datang</H1>
      <P>
        Aplikasi ini membantu Anda memahami kalimat bahasa Arab sederhana, dengan penjelasan dalam bahasa Indonesia.
        Setiap hari ada satu sesi singkat.
      </P>
      <Notice tone="warn">
        Versi ini adalah prototipe pengembang. Kalimat Arab di dalamnya adalah contoh buatan yang belum ditinjau.
      </Notice>
      <H2>Persetujuan (versi demo)</H2>
      <Card>
        <P>• Yang disimpan: jawaban Anda, waktu menjawab, dan sebuah ID acak. Tidak ada nama, kontak, lokasi, atau foto.</P>
        <P>• Tujuannya: memperbaiki pelajaran.</P>
        <P>• Di prototipe ini data hanya tersimpan di perangkat ini dan tidak dikirim ke mana pun.</P>
        <P>• Data disimpan sampai Anda menghapusnya di Pengaturan.</P>
        <P>• Anda boleh berhenti kapan saja.</P>
      </Card>
      <Card>
      <Check testID="consent-adult" value={adult} onChange={setAdult} label="Saya berusia 18 tahun atau lebih." />
      <Check testID="consent-agree" value={agree} onChange={setAgree} label="Saya setuju jawaban saya disimpan seperti dijelaskan di atas." />
      </Card>
      <Btn
        testID="consent-continue"
        label="Setuju dan lanjut"
        disabled={!adult || !agree}
        onPress={() => {
          giveConsent({ adult, agreed: agree });
          router.push('/setup');
        }}
      />
    </Page>
  );
}
