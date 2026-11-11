import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { validatePack } from '@/content/gating';
import { activePack } from '@/content/load';
import { findFormClashes } from '@/engine/freshness';
import { unresolvedSerious } from '@/engine/session';
import { STORAGE_KIND } from '@/storage/openStore';
import type { AnswerRecord, ReportRecord } from '@/storage/types';
import { useAccount } from '@/ui/AccountContext';
import { useApp } from '@/ui/AppContext';
import { BackLink } from '@/ui/BackLink';
import { Btn, Card, H1, H2, Notice, P, Page } from '@/ui/components';
import { colors } from '@/ui/theme';

/**
 * The developer reset of the guest data on this device. Rendered only while the guest dataset is in use, so a
 * confirmation never outlives it: switching to an account dataset unmounts it, and its open confirmation with it.
 */
function GuestReset({ readOnly, onReset }: { readOnly: string | null; onReset: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false); // one confirmation, one reset
  if (!confirm) {
    return <Btn kind="quiet" label="Hapus data tamu di perangkat ini" disabled={!!readOnly} testID="reset-open" onPress={() => setConfirm(true)} />;
  }
  return (
    <Card tone="danger">
      <P>Hapus data tamu di perangkat ini (peserta tamu, jawaban, sesi)? Data akun lokal, jika ada, tidak ikut dihapus.</P>
      <Btn
        testID="reset-confirm"
        label="Ya, hapus"
        disabled={!!readOnly || busy}
        onPress={async () => {
          if (busy) return;
          setBusy(true);
          try {
            await onReset();
            router.replace('/');
          } finally {
            setBusy(false);
          }
        }}
      />
      <Btn kind="quiet" label="Batal" disabled={busy} onPress={() => setConfirm(false)} />
    </Card>
  );
}

/** A commit as the builder reports it: 7 to 40 lowercase hex digits, and nothing else. */
const REPORTED_REVISION = /^[0-9a-f]{7,40}$/;

/**
 * The build this bundle reports: two public variables the builder sets when it exports the bundle, sanitized here. The
 * revision is shown only as 7 to 40 lowercase hex digits and the dirty flag only as exactly "true" or "false"; anything
 * missing or else is unknown, and no raw value is ever shown. It is what the build reported, not a check of HEAD, the
 * native app or the runtime. Read when the page renders, through static accesses so that Expo inlines them.
 */
function reportedBuild(): string {
  const revision = process.env.EXPO_PUBLIC_BUILD_REVISION;
  const dirty = process.env.EXPO_PUBLIC_BUILD_DIRTY;
  const shown = typeof revision === 'string' && REPORTED_REVISION.test(revision) ? revision : 'tidak diketahui';
  const status =
    dirty === 'true' ? 'ada perubahan yang belum di-commit' : dirty === 'false' ? 'tanpa perubahan yang belum di-commit' : 'status perubahan tidak diketahui';
  return `Revisi bundel (dilaporkan saat build): ${shown}; ${status}.`;
}

/** Whether this bundle came from the development server (Metro's __DEV__ global), read when the page renders. */
const fromDevelopmentServer = () => (globalThis as { __DEV__?: unknown }).__DEV__ === true;

/** Developer-demo only: answer log, config and content checks, the build the bundle reports, and the guest data reset (never an account dataset's). */
export default function Dev() {
  const { store, readOnly, rules, content, resetAll, dataset } = useApp();
  const account = useAccount();
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
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

  // What this page shows and resets: the dataset in use, the guest's or a signed-in account's.
  const scope =
    dataset === 'account'
      ? 'Data yang tampil: data akun lokal yang sedang dipilih. Jawaban dan pengaturannya dikirim ke layanan akun lokal (emulator pengembangan) hanya saat disinkronkan.'
      : `Data yang tampil: data tamu di perangkat ini; data tamu tidak dikirim ke mana pun. ${
          account.enabled
            ? 'Sinkronisasi ke layanan akun lokal (emulator pengembangan) bersifat opsional dan hanya untuk data akun setelah Anda masuk.'
            : 'Layanan akun lokal tidak dikonfigurasi di build ini.'
        }`;

  return (
    <Page width="wide">
      <BackLink />
      <H1>Data pengembang</H1>
      <Card>
        <P>Mode: {rules.mode}</P>
        <P>Aturan: {rules.rules_version}</P>
        <P>Konten: {content.content_version} (sintetis, belum ditinjau)</P>
        <P testID="build-provenance">{reportedBuild()}</P>
        {fromDevelopmentServer() ? (
          <P testID="build-provenance-dev">Bundel dari server pengembangan: kodenya bisa sudah berubah sejak server dimulai.</P>
        ) : null}
        <P>
          Penyimpanan: {STORAGE_KIND}. {scope}
        </P>
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

      {dataset === 'account' ? (
        <Notice tone="info" testID="reset-unavailable-account">
          Reset data pengembang hanya untuk data tamu. Data akun lokal yang sedang dipilih, termasuk antrean sinkronisasinya,
          tidak dihapus dari halaman ini.
        </Notice>
      ) : (
        <GuestReset readOnly={readOnly} onReset={resetAll} />
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
