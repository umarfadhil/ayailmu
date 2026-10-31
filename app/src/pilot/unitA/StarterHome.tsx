// The tester starter's Home: the brand, «Beta privat» (private beta audience only), and either the starter's review state
// or one entry into the Unit A starter. Only the real build configuration and the compiled starter review open it, never
// the account projection or a URL. It offers no session, legacy unit or next lesson. A reviewed Home with a connected
// account also shows that account's own compact sync facts and a manual sync, as the account panel words them; nothing otherwise.
import { router, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { starterBetaBuild } from '@/config/learningBeta';
import { normalStarterBuild } from '@/config/normalStarter';
import type { AppMode } from '@/config/rules';
import type { AccountSyncProgress } from '@/sync/accountProgress';
import { useAccount } from '@/ui/AccountContext';
import { POSITION_NOTE, localSyncLines, serverAnswersText, type ConnectedProfile } from '@/ui/account/AccountPanel';
import { useApp } from '@/ui/AppContext';
import { Btn, Chip, EmptyState, P, Page, Wordmark } from '@/ui/components';
import { typography } from '@/ui/theme';
import { starterReviewAccess } from './review';

/** 'off' outside a validated private beta or learning beta build; otherwise whether the compiled review approves the exact starter content. */
export type StarterBeta = 'off' | 'pending' | 'reviewed';

export function starterBeta(mode: AppMode): StarterBeta {
  if (mode !== 'tester' || !starterBetaBuild()) return 'off';
  return starterReviewAccess().allowed === true ? 'reviewed' : 'pending';
}

/**
 * 'off' outside the explicit, validated normal user build (tester mode); otherwise whether the same unchanged compiled
 * review approves the exact starter. The build only makes the starter eligible, the review alone makes it reviewed.
 */
export function normalStarter(mode: AppMode): StarterBeta {
  if (mode !== 'tester' || !normalStarterBuild()) return 'off';
  return starterReviewAccess().allowed === true ? 'reviewed' : 'pending';
}

/** The starter is not yet approved: nothing to study, only this state. */
export function StarterPending() {
  return (
    <EmptyState icon="hourglass-outline" title="Materi awal sedang ditinjau">
      <P style={{ textAlign: 'center' }}>Belum ada materi yang bisa dipelajari. Silakan kembali lagi nanti.</P>
    </EmptyState>
  );
}

/**
 * The connected account's sync state, compact: the caller's own status, this device's queue facts, the account's answer
 * count (unknown or last known as such) and where the lesson position stays. Counts answers only; no mastery.
 */
function BetaSync({ profile, progress, busy, onSyncNow }: { profile: ConnectedProfile; progress: AccountSyncProgress | null; busy: boolean; onSyncNow: () => void }) {
  const lines = progress ? localSyncLines(progress) : null;
  const facts = lines ? [lines.queued, lines.blocked, lines.conflicts, lines.capture] : [];
  return (
    <View style={styles.sync}>
      <View testID="beta-sync-status" role="status" accessibilityLiveRegion="polite" style={styles.facts}>
        <Text style={typography.small}>{profile.syncStatus}</Text>
        {facts.map((line) => (line === null ? null : <Text key={line} style={typography.small}>{line}</Text>))}
        <Text style={typography.small}>{`Tersimpan di akun: ${serverAnswersText(progress)}`}</Text>
        <Text style={typography.small}>{POSITION_NOTE}</Text>
      </View>
      <Btn testID="beta-sync-now" kind="secondary" label="Sinkronkan" disabled={busy} onPress={onSyncNow} />
    </View>
  );
}

/** Only the audience changes the wording: a normal user sees no «Beta privat» chip; the default stays the private beta's. */
export function StarterHome({ reviewed, audience = 'private-beta' }: { reviewed: boolean; audience?: 'normal-user' | 'private-beta' }) {
  const { learner } = useApp();
  const account = useAccount();
  const study = !reviewed ? null : learner ? (
    <Btn testID="beta-starter-open" label="Buka Unit A" icon="arrow-forward" onPress={() => router.push('/unit-a-pilot')} />
  ) : (
    <Btn testID="beta-starter-start" label="Mulai" icon="arrow-forward" onPress={() => router.push('/consent')} />
  );
  const accountEntry = account.enabled ? (
    <Btn testID="welcome-account" kind="quiet" label={account.signedIn ? 'Akun' : 'Masuk ke akun'} onPress={() => router.push('/account' as Href)} />
  ) : null;
  // Only a reviewed Home, for a signed-in account whose profile is connected and whose caller reports a progress model
  // (null: no local journal). A legacy profile without one, a guest or a pending review shows no account facts.
  const profile = reviewed && account.enabled && account.signedIn && account.connected ? account.panel.connected : null;
  const sync =
    profile && profile.progress !== undefined ? (
      <BetaSync profile={profile} progress={profile.progress} busy={Boolean(account.panel.busy)} onSyncNow={account.panel.onSyncNow} />
    ) : null;
  return (
    <Page
      footer={
        study || accountEntry ? (
          <>
            {study}
            {accountEntry}
          </>
        ) : undefined
      }
    >
      <View style={styles.top}>
        <Wordmark />
        {audience === 'normal-user' ? null : <Chip label="Beta privat" />}
      </View>
      {reviewed ? (
        <View style={styles.text}>
          <Text accessibilityRole="header" style={typography.title}>
            Unit A
          </Text>
          <Text style={typography.body}>Materi awal sudah ditinjau untuk uji coba.</Text>
        </View>
      ) : (
        <StarterPending />
      )}
      {sync}
    </Page>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'center', gap: 12 },
  text: { gap: 8 },
  sync: { gap: 12 },
  facts: { gap: 4 },
});
