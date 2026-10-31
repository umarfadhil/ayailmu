import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { learningBetaEnabled } from '@/config/learningBeta';
import type { CheckLine, SkillProgress, UnitProgress } from '@/engine/progress';
import { useApp } from '@/ui/AppContext';
import { ArabicText, Chip, DraftChip, Icon, Muted, Notice, Page, ScreenHeader, StorageRefused } from '@/ui/components';
import { Disclosure } from '@/ui/Disclosure';
import { SKILL_LABEL, UNIT_ORDER, UNIT_TITLE, unitLabel } from '@/ui/labels';
import { UNIT_STATE_LABEL, unitStates } from '@/ui/learningPath';
import { colors, fonts, radius } from '@/ui/theme';
import { formatDue, formatDueShort, isLearningError, useLearning } from '@/ui/useLearning';
import { HydrationGate } from '@/ui/Hydration';

/** The value of one check window, and whether it is short enough for a chip. */
function checkText(c: CheckLine, today: string): { text: string; short: boolean } {
  // A window without check items in this content version is never scheduled: no status or date to show.
  if (c.available === 0) return { text: 'Belum ada soal cek di versi ini.', short: false };
  const legacy = c.legacy_attempted ? ` · ${c.legacy_attempted} jawaban format lama` : '';
  // Outcomes stay hidden until every item of this check is answered (no lookup between dependent checks).
  const result = c.correct === null ? 'hasilnya ditampilkan setelah semua soal cek ini dijawab' : `${c.correct} benar`;
  const counts = `${c.attempted} dari ${c.available} soal dijawab (${result})${legacy}`;
  switch (c.status) {
    case 'not-started':
      return { text: 'Belum dimulai.', short: true };
    case 'not-due':
      return c.waiting_new_teaching && c.waiting_until
        ? { text: `Mulai ${formatDueShort(c.waiting_until, today)} (dihitung dari saat materi baru diajarkan).`, short: false }
        : c.waiting_new_teaching
          ? { text: 'Belum waktunya; menunggu materi baru diajarkan lebih dulu.', short: false }
          : { text: `Mulai ${formatDueShort(c.due_date!, today)}`, short: true };
    case 'due':
      return { text: `Sudah waktunya. ${counts}.`, short: false };
    case 'partial':
      return { text: `Sebagian: ${counts}.`, short: false };
    case 'answered':
      return { text: `Semua soal yang tersedia sudah dijawab: ${counts}.`, short: false };
  }
}

/** Honest qualifiers for one check window: not-counted answers, and items waiting for new teaching. */
function checkNotes(c: CheckLine, today: string): string[] {
  const notes: string[] = [];
  if (c.assisted) notes.push(`${c.assisted} soal dijawab setelah materinya dilihat pada hari yang sama; dicatat, tetapi tidak dihitung sebagai bukti ingatan.`);
  // Only while the check runs: before a unit starts nothing is scheduled, and a not-due line already says what it waits for.
  if (c.waiting_new_teaching && (c.status === 'due' || c.status === 'partial'))
    notes.push(
      c.waiting_until
        ? `${c.waiting_new_teaching} soal menunggu sampai ${formatDue(c.waiting_until, today)}, dihitung dari saat materi barunya diajarkan.`
        : `${c.waiting_new_teaching} soal menunggu materi barunya diajarkan lebih dulu.`
    );
  return notes;
}

/**
 * Check coverage and "not judged pass/fail", stated once per unit rather than per window. That a
 * check with too few items stays «sebagian» after its items are answered is said only once it happens.
 */
function retentionNote(u: UnitProgress): string {
  const windows = [u.retention_d7, u.retention_d30];
  const counts = 'Angka cek hanya menghitung jawaban; tidak dinilai lulus atau gagal.';
  if (!windows.some((c) => c.missing_content)) return counts;
  const stays = windows.some(
    (c) => c.missing_content && c.status === 'partial' && c.available > 0 && c.attempted + c.assisted + c.legacy_attempted >= c.available
  );
  return `Soal cek untuk unit ini belum lengkap: sebagian keterampilan punya kurang dari 2 soal cek${
    stays ? ', jadi cek yang semua soalnya sudah dijawab tetap «sebagian»' : ''
  }. ${counts}`;
}

/** One evidence row: its title and a factual value (a chip when short, a line when it carries counts). */
function EvidenceRow({ title, value, short, testID, children }: { title: string; value: string; short: boolean; testID?: string; children?: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowHead, !short && styles.rowHeadStacked]}>
        <Text style={styles.rowTitle}>{title}</Text>
        {short ? <Chip label={value} testID={testID} /> : <Muted testID={testID}>{value}</Muted>}
      </View>
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

/**
 * «Kemajuan» (board 10): a learning path with factual state chips and evidence rows. Mastery, retention
 * and transfer are not judged (the learned rule is pending); the recognition note, the reasons and the
 * locked paths stay visible. Only the per-skill counts open on demand.
 */
function ProgressRoute() {
  const { content } = useApp();
  const learning = useLearning();
  if (content.empty) return <Redirect href="/" />;
  if (learning === undefined)
    return (
      <Page>
        <ActivityIndicator color={colors.accent} accessibilityLabel="Memuat kemajuan" />
      </Page>
    );
  if (isLearningError(learning)) return <StorageRefused message={learning.error} />;
  if (learning === null) return <Redirect href="/" />;
  const { progress: p, today } = learning;
  // Count saved records once, not skill totals (one answer may cover several skills).
  const practice = learning.answers.filter((r) => r.pool !== 'D7' && r.pool !== 'D30' && r.role !== 'check');
  const states = new Map(unitStates(learning, content).map((s) => [s.unit, s.state]));
  const skills = p.skills.filter((s) => SKILL_LABEL[s.skill] && (s.attempts || s.legacy.attempts || s.review_attempts));

  return (
    <Page>
      <ScreenHeader title="Kemajuan">
        <DraftChip />
      </ScreenHeader>
      <View testID="progress-overview" style={styles.overview}>
        <Text style={styles.subtitle}>Catatan latihan, bukan nilai penguasaan.</Text>
        <Notice tone="info">Jawaban empat pilihan dicatat sebagai pengenalan, bukan jawaban yang ditulis sendiri.</Notice>
        {p.next_due ? (
          <View style={styles.next}>
            <View style={styles.nextIcon}>
              <Icon name="calendar-outline" size={20} color={colors.accentInk} />
            </View>
            <View style={styles.nextBody}>
              <Text style={styles.nextLabel}>Ulasan/cek berikutnya</Text>
              <Text style={styles.nextDate}>{`${formatDue(p.next_due, today)}.`}</Text>
            </View>
          </View>
        ) : null}
      </View>

      <Text accessibilityRole="header" style={styles.h2}>
        Jalur belajar
      </Text>
      <View>
        {p.units.map((u) => {
          const state = states.get(u.unit) ?? 'closed';
          const previous = UNIT_ORDER[UNIT_ORDER.indexOf(u.unit) - 1];
          return (
            <View key={u.unit} style={styles.step}>
              <View style={styles.rail}>
                <View style={[styles.dot, u.open ? styles.dotOpen : styles.dotClosed]} />
                <View style={[styles.railLine, !u.open && styles.railLineClosed]} />
              </View>
              <View testID={`unit-${u.unit}`} style={[styles.unit, !u.open && styles.unitClosed]}>
                <View style={styles.unitHead}>
                  <View style={styles.unitTitles}>
                    <Text style={[styles.unitEyebrow, !u.open && styles.unitEyebrowClosed]}>{unitLabel(u.unit)}</Text>
                    <Text accessibilityRole="header" style={styles.unitTitle}>
                      {UNIT_TITLE[u.unit]}
                    </Text>
                  </View>
                  <Chip label={UNIT_STATE_LABEL[state]} tone={u.open ? 'accent' : 'neutral'} testID={`unit-state-${u.unit}`} />
                </View>
                {!u.open ? (
                  <Muted>
                    {previous ? `Dibuka setelah panduan dan latihan inti Unit ${previous} dikerjakan.` : 'Belum dibuka.'}
                  </Muted>
                ) : (
                  <>
                    <View testID={`line-learned-${u.unit}`}>
                      <EvidenceRow title="Sudah dipelajari" value="Belum dinilai" short />
                    </View>
                    <View testID={`line-retention-${u.unit}`}>
                      {(['d7', 'd30'] as const).map((w) => {
                        const c = w === 'd7' ? u.retention_d7 : u.retention_d30;
                        const v = checkText(c, today);
                        return (
                          <EvidenceRow
                            key={w}
                            title={`Masih ingat setelah ${w === 'd7' ? 7 : 30} hari`}
                            value={v.text}
                            short={v.short}
                            testID={`check-${w}-${u.unit}`}
                          >
                            {checkNotes(c, today).map((t) => (
                              <Muted key={t} testID={`check-${w}-note-${u.unit}`}>
                                {t}
                              </Muted>
                            ))}
                          </EvidenceRow>
                        );
                      })}
                      <Muted testID={`retention-note-${u.unit}`} style={styles.unitNote}>
                        {retentionNote(u)}
                      </Muted>
                    </View>
                    <View testID={`line-transfer-${u.unit}`}>
                      <EvidenceRow title="Bisa memahami kalimat baru" value="Belum dinilai" short />
                    </View>
                    <View style={styles.reasons}>
                      <Text style={styles.reasonsTitle}>Kenapa belum dinilai?</Text>
                      <Muted>{u.learned.reason}</Muted>
                      <Muted>{u.transfer.reason}</Muted>
                    </View>
                  </>
                )}
              </View>
            </View>
          );
        })}
        {p.locked.map((l) => (
          <View key={l.path} style={styles.step}>
            <View style={styles.rail}>
              <Icon name="lock-closed-outline" size={18} color={colors.muted} />
            </View>
            <View style={styles.locked}>
              <View style={styles.unitHead}>
                <Text accessibilityRole="header" style={styles.lockedTitle}>
                  {l.path}
                </Text>
                <Chip label="Terkunci" />
              </View>
              <Muted>Terkunci sampai aturan «sudah dipelajari» diputuskan.</Muted>
            </View>
          </View>
        ))}
      </View>

      <Text accessibilityRole="header" style={styles.h2}>
        Kata yang dilatih
      </Text>
      <View testID="word-list" style={styles.words}>
        {p.words.length === 0 ? <Muted style={styles.wordsEmpty}>Kata muncul di sini setelah Anda melatihnya.</Muted> : null}
        {p.words.map((w, n) => (
          <View key={w.word_id} style={[styles.word, n > 0 && styles.wordDivider]}>
            <View style={styles.wordBody}>
              <Text style={[styles.wordMeaning, w.meaning_hidden && styles.wordHidden]} testID={`word-meaning-${w.word_id}`}>
                {w.meaning_hidden ? 'Arti disembunyikan sampai cek ulang selesai.' : w.meaning}
              </Text>
              <Text style={styles.wordState}>{w.state === 'needs-review' ? 'Perlu diulas' : `Sedang dilatih · ulasan ${formatDueShort(w.next_due, today)}`}</Text>
            </View>
            <ArabicText size={30}>{w.display}</ArabicText>
          </View>
        ))}
      </View>

      <Disclosure title="Rincian latihan" summary={`Per keterampilan · ${skills.length} keterampilan`} testID="progress-skills">
        <Muted>
          <Text testID="progress-attempts" style={styles.strong}>
            {practice.length}
          </Text>
          {' jawaban latihan tersimpan (tanpa cek ulang).'}
        </Muted>
        <Muted testID="skills-whole-answer-note">
          Setiap kelompok menghitung jawaban empat pilihan yang utuh. Jawaban baru dihitung benar bila semua bagiannya
          tepat, misalnya orangnya dan artinya; satu bagian yang keliru membuat seluruh jawaban belum tepat. Satu jawaban
          bisa masuk ke lebih dari satu kelompok.
        </Muted>
        {skills.map((s) => (
          <SkillRow key={s.skill} s={s} />
        ))}
        {!p.skills.some((s) => s.attempts || s.legacy.attempts) ? <Muted>Belum ada latihan.</Muted> : null}
      </Disclosure>
    </Page>
  );
}

const styles = StyleSheet.create({
  overview: { gap: 12 },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.muted, writingDirection: 'ltr', textAlign: 'left' },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: colors.sheet,
    borderWidth: 1,
    borderColor: colors.line,
  },
  nextIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  nextBody: { flex: 1 },
  nextLabel: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  nextDate: { fontFamily: fonts.extrabold, fontSize: 17, lineHeight: 24, color: colors.ink },
  h2: { fontFamily: fonts.extrabold, fontSize: 19, lineHeight: 26, color: colors.ink, marginTop: 10, writingDirection: 'ltr', textAlign: 'left' },

  step: { flexDirection: 'row', gap: 12 },
  rail: { width: 22, alignItems: 'center', paddingTop: 22 },
  dot: { width: 16, height: 16, borderRadius: radius.pill },
  dotOpen: { backgroundColor: colors.accent, borderWidth: 4, borderColor: colors.accentSoft },
  dotClosed: { backgroundColor: colors.ground, borderWidth: 2, borderColor: '#A89A84' },
  railLine: { flex: 1, width: 2, marginTop: 8, backgroundColor: colors.lineStrong },
  railLineClosed: { backgroundColor: colors.line },
  unit: {
    flex: 1,
    minWidth: 0,
    marginBottom: 12,
    paddingTop: 16,
    paddingBottom: 12,
    paddingHorizontal: 16,
    gap: 10,
    borderRadius: radius.card,
    backgroundColor: colors.sheet,
    borderWidth: 1,
    borderColor: colors.line,
  },
  unitClosed: { backgroundColor: colors.sheet2 },
  unitHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  unitTitles: { flexShrink: 1, gap: 2 },
  unitEyebrow: { fontFamily: fonts.extrabold, fontSize: 12, lineHeight: 16, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.accent },
  unitEyebrowClosed: { color: colors.muted },
  unitTitle: { fontFamily: fonts.extrabold, fontSize: 18, lineHeight: 24, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  row: { gap: 4, paddingTop: 10, paddingBottom: 6, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  rowHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 32 },
  rowHeadStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  unitNote: { marginTop: 4 },
  reasons: { gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  reasonsTitle: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: colors.accentInk },
  locked: {
    flex: 1,
    minWidth: 0,
    marginBottom: 12,
    padding: 16,
    gap: 8,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CDBFA8',
  },
  lockedTitle: { flexShrink: 1, fontFamily: fonts.extrabold, fontSize: 16, lineHeight: 22, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },

  words: { paddingHorizontal: 16, borderRadius: radius.card, backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.line },
  wordsEmpty: { paddingVertical: 14 },
  word: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 76, paddingVertical: 10 },
  wordDivider: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  wordBody: { flex: 1, gap: 4 },
  wordMeaning: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  wordHidden: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.muted },
  wordState: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: colors.accentInk, writingDirection: 'ltr', textAlign: 'left' },

  skill: { gap: 2, paddingVertical: 6 },
  skillTitle: { fontFamily: fonts.extrabold, fontSize: 15, lineHeight: 22, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  strong: { fontFamily: fonts.extrabold, color: colors.ink },
});

export default function ProgressScreen() {
  // A validated learning beta is bounded starter access: Home before any legacy hydration or learning effect mounts.
  if (learningBetaEnabled()) return <Redirect href="/" />;
  return (
    <HydrationGate>
      <ProgressRoute />
    </HydrationGate>
  );
}
