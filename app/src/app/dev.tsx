import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { validatePack } from '@/content/gating';
import { activePack } from '@/content/load';
import { findFormClashes } from '@/engine/freshness';
import { unresolvedSerious } from '@/engine/session';
import { STORAGE_KIND } from '@/storage/openStore';
import type { AnswerRecord, ReportRecord } from '@/storage/types';
import { useApp } from '@/ui/AppContext';
import { BackLink } from '@/ui/BackLink';
import { Btn, Card, H1, H2, P, Page } from '@/ui/components';
import { colors } from '@/ui/theme';

/** Developer-demo only: answer log, config and content checks, local reset. */
export default function Dev() {
  const { store, rules, content, resetAll } = useApp();
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const problems = useMemo(() => [...validatePack(activePack), ...findFormClashes(activePack.items).map((c) => JSON.stringify(c))], []);

  useFocusEffect(
    useCallback(() => {
      if (!store) return;
      store.listAnswers().then(setAnswers);
      store.listReports().then(setReports);
    }, [store])
  );

  if (rules.mode !== 'developer-demo') return <Redirect href="/" />;

  return (
    <Page width="wide">
      <BackLink />
      <H1>Data pengembang</H1>
      <Card>
        <P>Mode: {rules.mode}</P>
        <P>Aturan: {rules.rules_version}</P>
        <P>Konten: {content.content_version} (sintetis, belum ditinjau)</P>
        <P>Penyimpanan: {STORAGE_KIND}. Tidak ada backend; tidak ada data yang dikirim.</P>
        <P>Audio cek awal: {rules.audio_enabled ? 'aktif' : 'tidak tersedia (opsional, dinonaktifkan)'}</P>
        <P>Pemeriksaan konten: {problems.length ? problems.join('\n') : 'tidak ada masalah'}</P>
        <P>Kesalahan penting yang belum selesai: {JSON.stringify(unresolvedSerious(answers))}</P>
      </Card>

      <H2>Log jawaban ({answers.length})</H2>
      <Card style={{ padding: 0, gap: 0 }}>
        {answers.length === 0 ? <P style={{ padding: 16 }}>Belum ada jawaban.</P> : null}
        {[...answers].reverse().map((a) => (
          <Text key={a.answer_id} style={styles.logRow} testID="log-row">
            {a.timestamp.slice(11, 19)} {a.item_id} [{a.pool}] {a.outcome}
            {a.serious_tag ? ` SERIUS:${a.serious_tag}` : ''} {a.fresh_evidence ? 'fresh' : 'not-evidence'} {a.raw_response}
          </Text>
        ))}
      </Card>
      <P>Laporan soal: {reports.length}</P>

      <Btn kind="secondary" label={showJson ? 'Sembunyikan JSON' : 'Tampilkan ekspor JSON'} onPress={() => setShowJson(!showJson)} />
      {showJson ? (
        <Card>
          <Text selectable style={{ fontSize: 11, fontFamily: 'monospace' }}>
            {JSON.stringify({ answers, reports }, null, 1)}
          </Text>
        </Card>
      ) : null}

      {confirm ? (
        <Card tone="danger">
          <P>Hapus semua data lokal (peserta, jawaban, sesi)?</P>
          <Btn
            testID="reset-confirm"
            label="Ya, hapus"
            onPress={async () => {
              await resetAll();
              router.replace('/');
            }}
          />
          <Btn kind="quiet" label="Batal" onPress={() => setConfirm(false)} />
        </Card>
      ) : (
        <Btn kind="quiet" label="Hapus semua data lokal" onPress={() => setConfirm(true)} />
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  logRow: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.inkSoft,
    fontFamily: 'monospace',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
