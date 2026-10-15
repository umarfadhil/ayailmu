import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import type { CheckLine, SkillProgress } from '@/engine/progress';
import { useApp } from '@/ui/AppContext';
import { ArabicText, Card, Eyebrow, H1, H2, Icon, Muted, Notice, Page } from '@/ui/components';
import { colors, radius } from '@/ui/theme';
import { formatDue, useLearning } from '@/ui/useLearning';

const SKILL_LABEL: Record<string, string> = {
  'NOM-01': 'Memahami kalimat «dia + sifat»',
  'NOM-02': 'Memilih bentuk yang cocok',
  'LEX-P3': 'Laki-laki atau perempuan (kata pertama)',
  'VRB-01': 'Siapa yang melakukan (akhir kata kerja)',
  'LEX-B': 'Arti kata kerja',
};

function checkText(c: CheckLine, today: string): string {
  const legacy = c.legacy_attempted ? ` · ${c.legacy_attempted} jawaban format lama` : '';
  const counts = `${c.attempted} dari ${c.available} soal dijawab (${c.correct} benar)${legacy}`;
  switch (c.status) {
    case 'not-started':
      return 'Belum dimulai.';
    case 'not-due':
      return `Belum waktunya; mulai ${formatDue(c.due_date!, today)}.`;
    case 'due':
      return `Sudah waktunya. ${counts}.`;
    case 'partial':
      return `Sebagian: ${counts}.`;
    case 'answered':
      return `Semua soal yang tersedia sudah dijawab: ${counts}.`;
  }
}

function Line({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.line} testID={testID}>
      <Text style={styles.lineTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SkillRow({ s }: { s: SkillProgress }) {
  const legacy = s.legacy.attempts
    ? ` Format lama: ${s.legacy.attempts} jawaban (${s.legacy.correct} benar, ${s.legacy.wrong} belum tepat, ${s.legacy.pending} menunggu diperiksa).`
    : '';
  return (
    <View style={styles.skill} testID={`skill-${s.skill}`}>
      <Text style={styles.skillTitle}>{SKILL_LABEL[s.skill] ?? s.skill}</Text>
      <Muted>
        {`${s.attempts} soal latihan (${s.correct} benar, ${s.wrong} belum tepat, ${s.dont_know} belum tahu) dalam ${s.days} hari · ${s.review_attempts} ulasan.${legacy}`}
      </Muted>
      {s.unresolved_serious ? <Muted style={{ color: colors.dangerInk }}>Ada kesalahan penting yang masih perlu latihan ulang.</Muted> : null}
    </View>
  );
}

/** «Kemajuan»: separate factual lines; mastery, retention and transfer are not judged (rule pending). */
export default function ProgressScreen() {
  const { content } = useApp();
  const learning = useLearning();
  if (content.empty) return <Redirect href="/" />;
  if (learning === undefined) return null;
  if (learning === null) return <Redirect href="/" />;
  const { progress: p, today } = learning;

  return (
    <Page>
      <Eyebrow tone="indigo">Kemajuan</Eyebrow>
      <H1>Kemajuan Anda</H1>
      <Notice tone="info">{p.evidence_note} Status «sudah dipelajari» belum dinilai sampai aturannya diputuskan.</Notice>

      {p.units.map((u) => (
        <Card key={u.unit} testID={`unit-${u.unit}`}>
          <H2>{`Unit ${u.unit}`}</H2>
          {!u.open ? (
            <Muted>Belum dibuka. Unit ini dimulai setelah panduan dan latihan inti unit sebelumnya dikerjakan.</Muted>
          ) : (
            <>
              <Line title="Sudah dipelajari" testID={`line-learned-${u.unit}`}>
                <Muted>Belum dinilai. {u.learned.reason}</Muted>
              </Line>
              <Line title="Masih ingat setelah 7 / 30 hari" testID={`line-retention-${u.unit}`}>
                <Muted>7 hari: {checkText(u.retention_d7, today)}</Muted>
                <Muted>30 hari: {checkText(u.retention_d30, today)}</Muted>
                {u.retention_d7.sparse_skills.length || u.retention_d30.sparse_skills.length ? (
                  <Muted>Cakupan soal cek belum lengkap untuk sebagian keterampilan (kurang dari 2 soal); angka di atas tidak dinilai lulus atau gagal.</Muted>
                ) : (
                  <Muted>Angka di atas hanya jumlah jawaban; tidak dinilai lulus atau gagal.</Muted>
                )}
              </Line>
              <Line title="Bisa memahami kalimat baru" testID={`line-transfer-${u.unit}`}>
                <Muted>Belum dinilai. {u.transfer.reason}</Muted>
              </Line>
            </>
          )}
        </Card>
      ))}

      <H2>Latihan per keterampilan</H2>
      <Card>
        {p.skills
          .filter((s) => SKILL_LABEL[s.skill] && (s.attempts || s.legacy.attempts || s.review_attempts))
          .map((s) => (
            <SkillRow key={s.skill} s={s} />
          ))}
        {!p.skills.some((s) => s.attempts || s.legacy.attempts) ? <Muted>Belum ada latihan.</Muted> : null}
      </Card>

      <H2>Daftar kata</H2>
      <Card testID="word-list">
        {p.words.length === 0 ? <Muted>Kata muncul di sini setelah Anda melatihnya.</Muted> : null}
        {p.words.map((w) => (
          <View key={w.word_id} style={styles.word}>
            <View style={{ flex: 1 }}>
              <Text style={styles.wordMeaning}>{w.meaning}</Text>
              <Muted>{w.state === 'needs-review' ? 'Perlu diulas' : `Sedang dilatih · ulasan ${formatDue(w.next_due, today)}`}</Muted>
            </View>
            <ArabicText size={26}>{w.display}</ArabicText>
          </View>
        ))}
      </Card>

      <H2>Belum tersedia</H2>
      <Card>
        {p.locked.map((l) => (
          <View key={l.path} style={styles.locked}>
            <Icon name="lock-closed" size={18} color={colors.muted} />
            <Muted style={{ flex: 1 }}>{`${l.path} — terkunci sampai aturan «sudah dipelajari» diputuskan.`}</Muted>
          </View>
        ))}
      </Card>
      <Muted>{`Aturan ${p.rules_version} · konten ${p.content_version}`}</Muted>
    </Page>
  );
}

const styles = StyleSheet.create({
  line: { gap: 2, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  lineTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  skill: { gap: 2, paddingVertical: 6 },
  skillTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  word: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderRadius: radius.sm,
  },
  wordMeaning: { fontSize: 16, color: colors.ink, fontWeight: '600', writingDirection: 'ltr', textAlign: 'left' },
  locked: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 4 },
});
