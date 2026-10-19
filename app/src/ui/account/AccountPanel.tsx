// «Akun lokal»: the account and profile panel of the local developer pilot, presentational only. The caller owns
// sign-in, profiles, guest-data copying and sync, and supplies every fact and callback. The panel keeps only
// transient form and checkbox state: the typed password leaves it once per submit and is never kept, logged or
// stored, and every tick starts over with each sign-in. Where the caller offers Continue with Google, it sits in the
// same form, beside the password sign-in: it hands nothing typed over, and leaves no typed password behind.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { moveFocus } from '@/ui/a11y';
import { Btn, Chip, Icon, Notice, Segmented } from '@/ui/components';
import { colors, fonts, radius, typography } from '@/ui/theme';

export type AccountMode = 'create' | 'signin';
/** The account action in progress: its controls are disabled and the wait is announced. */
export type AccountBusy = 'auth' | 'guest-copy' | 'profile' | 'sync' | 'prefs' | 'signout';

/** One of the account's own profiles: an opaque id (a view key only) and a caller-worded label with no personal details. */
export interface AccountProfileChoice {
  id: string;
  label: string;
}

/** The connected profile as the caller reports it: counts only, no judgement of learning. */
export interface ConnectedProfile {
  label: string;
  /** A safe, already-worded sync status. */
  syncStatus: string;
  /** Answers saved in the account. */
  savedAnswers: number;
  /** Answers that came from other devices. */
  otherDeviceAnswers: number;
}

export interface AccountPanelProps {
  /** The signed-in account, or null when signed out. `key` is opaque and changes with every sign-in; `label` is shown. */
  account: { key: string; label: string } | null;
  busy?: AccountBusy | null;
  /** A safe, already-worded message about the last action, shown as an alert. */
  error?: string | null;
  /** Guest answers on this device (none: no copy is offered), or the caller's message once copied or skipped. */
  guestCopy?: { answers: number; result?: string | null } | null;
  profiles?: AccountProfileChoice[];
  connected?: ConnectedProfile | null;
  /** Device and account settings differ (with an optional caller-worded detail); the learner chooses which to use. */
  prefsConflict?: { detail?: string } | null;
  /** Whether creating a test account is offered (true unless set). False where the provider has sign-up off: sign-in only. */
  signUp?: boolean;
  /** Gets the typed values once per submit; the panel keeps no password afterwards. */
  onSubmit: (request: { mode: AccountMode; email: string; password: string }) => void;
  /** Continue with Google, where the caller offers it (signed out only, beside the password form): called with nothing. */
  onGoogle?: () => void;
  onGuestCopy: () => void;
  onGuestSkip: () => void;
  /** Gets a profile's id back unchanged. */
  onLinkProfile: (id: string) => void;
  onCreateProfile: (consent: { adult: true; agreed: true }) => void;
  onSyncNow: () => void;
  onKeepLocalPrefs: () => void;
  onUseServerPrefs: () => void;
  onSignOut: () => void;
}

const BUSY: Record<AccountBusy, string> = {
  auth: 'Sedang masuk ke akun lokal…',
  'guest-copy': 'Sedang menyalin data tamu…',
  profile: 'Sedang menyiapkan profil…',
  sync: 'Sedang menyinkronkan…',
  prefs: 'Sedang menerapkan pilihan pengaturan…',
  signout: 'Sedang keluar dari akun…',
};

const MODES: { value: AccountMode; label: string }[] = [
  { value: 'create', label: 'Buat akun uji coba' },
  { value: 'signin', label: 'Sudah punya akun' },
];

const OWN_PASSWORD = 'Pakai kata sandi khusus uji coba, bukan yang Anda pakai di tempat lain.';

/** What the panel is for. With Google offered, the .test rule is stated for email and password only: a Google address needs none. */
function introNote(signUp: boolean, google: boolean): string {
  if (google) {
    return signUp
      ? 'Akun uji coba di layanan akun lokal, khusus untuk pengembangan. Untuk email dan kata sandi, pakai alamat email berakhiran .test: tidak ada email yang dikirim, dan ini bukan pendaftaran sungguhan.'
      : 'Masuk dengan akun yang sudah disiapkan di layanan akun lokal, khusus untuk pengembangan; pendaftaran baru tidak tersedia. Untuk masuk dengan email dan kata sandi, pakai alamat email uji berakhiran .test: tidak ada email yang dikirim.';
  }
  return signUp
    ? 'Akun uji coba di layanan akun lokal, khusus untuk pengembangan. Pakai alamat email berakhiran .test: tidak ada email yang dikirim, dan ini bukan pendaftaran sungguhan.'
    : 'Masuk dengan akun uji coba yang sudah disiapkan di layanan akun lokal, khusus untuk pengembangan; pendaftaran baru tidak tersedia. Pakai alamat email berakhiran .test: tidak ada email yang dikirim.';
}

export function AccountPanel(props: AccountPanelProps) {
  const { account, busy = null, error = null, signUp = true } = props;
  const errorRegion = useRef<View>(null);
  useEffect(() => {
    if (error) moveFocus(errorRegion);
  }, [error]);

  return (
    <View style={styles.panel} testID="account-panel">
      <View style={styles.head}>
        <Text accessibilityRole="header" testID="account-title" style={styles.title}>
          Akun lokal
        </Text>
        <Text style={styles.note}>{introNote(signUp, props.onGoogle !== undefined)}</Text>
        <Text style={styles.note}>Belajar tetap bisa tanpa akun. Setelah aplikasi ditutup atau dimuat ulang, Anda perlu masuk lagi.</Text>
        <View role="status" accessibilityLiveRegion="polite">
          <Text testID="account-status" style={styles.status}>
            {account ? `Masuk sebagai ${account.label}` : 'Belum masuk'}
          </Text>
        </View>
      </View>
      <View role="status" accessibilityLiveRegion="polite" testID="account-busy">
        {busy ? <Text style={styles.busy}>{BUSY[busy]}</Text> : null}
      </View>
      {error ? (
        <View ref={errorRegion} role="alert" accessibilityLiveRegion="assertive" tabIndex={-1} testID="account-error">
          <Notice tone="danger">{error}</Notice>
        </View>
      ) : null}
      {/* Keyed by the sign-in: another session never inherits a tick. Signed out, only the form is shown. */}
      {account ? (
        <SignedIn key={account.key} {...props} busy={busy} />
      ) : (
        <SignInForm busy={busy} signUp={signUp} onSubmit={props.onSubmit} onGoogle={props.onGoogle} />
      )}
    </View>
  );
}

/**
 * The sign-in (and, where offered, synthetic sign-up) form, with Continue with Google beside it where the caller offers
 * it. Its values live only here and are gone once signed in or unmounted.
 */
function SignInForm({
  busy,
  signUp,
  onSubmit,
  onGoogle,
}: {
  busy: AccountBusy | null;
  signUp: boolean;
  onSubmit: AccountPanelProps['onSubmit'];
  onGoogle?: () => void;
}) {
  const [mode, setMode] = useState<AccountMode>(signUp ? 'create' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const working = busy !== null;
  const ready = email.trim() !== '' && password !== '';
  const submit = () => {
    if (!ready || working) return;
    const request = { mode, email: email.trim(), password };
    setPassword(''); // handed over once: the panel keeps no password
    onSubmit(request);
  };
  const google = () => {
    if (working || !onGoogle) return;
    setPassword(''); // nothing typed is handed over, and no typed password stays behind
    onGoogle();
  };

  return (
    <View style={styles.card} testID="account-form">
      {signUp ? <Segmented testIDPrefix="account-mode-" accessibilityLabel="Akun uji coba" value={mode} onChange={setMode} options={MODES} /> : null}
      <LabeledInput
        label="Email uji (.test)"
        testID="account-email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        placeholder="nama@ayailmu.test"
        editable={!working}
      />
      <LabeledInput
        label="Kata sandi"
        testID="account-password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!working}
        onSubmitEditing={submit}
        hint={mode === 'create' ? `Minimal 6 karakter. ${OWN_PASSWORD}` : OWN_PASSWORD}
      />
      <Btn
        testID="account-submit"
        label={mode === 'create' ? 'Buat akun dan masuk' : 'Masuk ke akun lokal'}
        icon="arrow-forward"
        disabled={!ready || working}
        onPress={submit}
      />
      {ready || working ? null : <Text style={styles.hint}>Isi email .test dan kata sandi untuk melanjutkan.</Text>}
      {onGoogle ? <Btn testID="account-google" kind="secondary" icon="logo-google" label="Lanjutkan dengan Google" disabled={working} onPress={google} /> : null}
    </View>
  );
}

function SignedIn(props: AccountPanelProps & { busy: AccountBusy | null }) {
  const { busy, guestCopy, connected, prefsConflict } = props;
  const working = busy !== null;
  return (
    <View style={styles.panel}>
      {guestCopy ? <GuestCopy offer={guestCopy} working={working} onCopy={props.onGuestCopy} onSkip={props.onGuestSkip} /> : null}
      {connected ? (
        <Connected profile={connected} working={working} onSyncNow={props.onSyncNow} />
      ) : (
        <ProfileChoice profiles={props.profiles ?? []} working={working} onLink={props.onLinkProfile} onCreate={props.onCreateProfile} />
      )}
      {prefsConflict ? (
        <Section title="Pengaturan berbeda" testID="prefs-conflict">
          <Text style={styles.body}>Pengaturan di perangkat ini berbeda dengan pengaturan di akun. Pilih yang dipakai.</Text>
          {prefsConflict.detail ? <Text style={styles.body}>{prefsConflict.detail}</Text> : null}
          <Btn testID="prefs-keep-local" kind="secondary" label="Pakai pengaturan perangkat ini" disabled={working} onPress={props.onKeepLocalPrefs} />
          <Btn testID="prefs-use-server" kind="secondary" label="Pakai pengaturan akun" disabled={working} onPress={props.onUseServerPrefs} />
        </Section>
      ) : null}
      <View style={styles.signout}>
        {/* Stays available during other work, so a long sync can be left by signing out. */}
        <Btn testID="account-signout" kind="secondary" icon="log-out-outline" label="Keluar dari akun" disabled={busy === 'signout'} onPress={props.onSignOut} />
        <Text style={styles.hint}>Keluar tidak menghapus data di perangkat ini.</Text>
      </View>
    </View>
  );
}

/** Copying guest answers into the account: offered only when there are some, and only after an explicit tick. */
function GuestCopy({
  offer,
  working,
  onCopy,
  onSkip,
}: {
  offer: NonNullable<AccountPanelProps['guestCopy']>;
  working: boolean;
  onCopy: () => void;
  onSkip: () => void;
}) {
  const [consent, setConsent] = useState(false);
  if (offer.result) {
    return (
      <View role="status" accessibilityLiveRegion="polite">
        <Notice tone="info" testID="guest-copy-result">
          {offer.result}
        </Notice>
      </View>
    );
  }
  if (!(offer.answers > 0)) return null; // no guest data on this device: nothing to copy
  return (
    <Section title="Data tamu di perangkat ini" testID="guest-copy">
      <Text style={styles.body}>
        {`${offer.answers} jawaban tersimpan di perangkat ini tanpa akun. Menyalinnya ke akun lokal tidak menghapus data di perangkat ini.`}
      </Text>
      <Check testID="guest-copy-consent" label="Salin data tamu" value={consent} onChange={setConsent} disabled={working} />
      <Btn testID="guest-copy-confirm" kind="secondary" label="Salin sekarang" disabled={!consent || working} onPress={() => consent && !working && onCopy()} />
      {consent ? null : <Text style={styles.hint}>Centang «Salin data tamu» untuk menyalin.</Text>}
      <Btn testID="guest-copy-skip" kind="quiet" label="Jangan salin" disabled={working} onPress={onSkip} />
    </Section>
  );
}

/** Connecting one of the account's profiles (ids passed back unchanged), or creating an adult profile after two ticks. */
function ProfileChoice({
  profiles,
  working,
  onLink,
  onCreate,
}: {
  profiles: AccountProfileChoice[];
  working: boolean;
  onLink: (id: string) => void;
  onCreate: AccountPanelProps['onCreateProfile'];
}) {
  const [adult, setAdult] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const ready = adult && agreed;
  return (
    <View style={styles.panel} testID="profile-choice">
      {profiles.length ? (
        <Section title="Profil di akun ini">
          {profiles.map((profile) => (
            <View key={profile.id} style={styles.profile}>
              <Text style={styles.body}>{profile.label}</Text>
              <Btn
                testID={`profile-link-${profile.id}`}
                kind="secondary"
                label="Hubungkan profil ini"
                disabled={working}
                onPress={() => onLink(profile.id)}
              />
            </View>
          ))}
        </Section>
      ) : null}
      <Section title="Profil dewasa baru">
        <Text style={styles.body}>Tidak ada nama, tanggal lahir, atau nomor telepon yang diminta.</Text>
        <Check testID="profile-adult" label="Saya berusia 18 tahun atau lebih." value={adult} onChange={setAdult} disabled={working} />
        <Check
          testID="profile-agree"
          label="Saya setuju jawaban dan pengaturan saya disimpan di profil akun lokal ini."
          value={agreed}
          onChange={setAgreed}
          disabled={working}
        />
        <Btn
          testID="profile-create"
          label="Buat profil dewasa"
          disabled={!ready || working}
          onPress={() => ready && !working && onCreate({ adult: true, agreed: true })}
        />
        {ready ? null : <Text style={styles.hint}>Centang kedua pernyataan untuk membuat profil.</Text>}
      </Section>
    </View>
  );
}

/** The connected profile: the caller's sync status, a sync action, and factual counts (learning is not judged). */
function Connected({ profile, working, onSyncNow }: { profile: ConnectedProfile; working: boolean; onSyncNow: () => void }) {
  return (
    <>
      <Section title="Profil terhubung" testID="sync-panel">
        <Text style={styles.body}>{profile.label}</Text>
        <View role="status" accessibilityLiveRegion="polite">
          <Text testID="sync-status" style={styles.status}>
            {profile.syncStatus}
          </Text>
        </View>
        <Btn testID="sync-now" icon="sync-outline" label="Sinkronkan sekarang" disabled={working} onPress={onSyncNow} />
      </Section>
      <Section title="Catatan di akun" testID="account-progress">
        <Fact title="Tersimpan di akun">
          <Text testID="account-progress-events" style={styles.factValue}>{`${profile.savedAnswers} jawaban`}</Text>
        </Fact>
        <Fact title="Sudah dipelajari">
          <Chip label="Belum dinilai" testID="account-progress-learned" />
        </Fact>
        <Fact title="Dari perangkat lain">
          <Text testID="account-remote-count" style={styles.factValue}>{`${profile.otherDeviceAnswers} jawaban`}</Text>
        </Fact>
        <Text style={styles.hint}>Angka ini hanya menghitung jawaban; penguasaan belum dinilai.</Text>
      </Section>
    </>
  );
}

function Section({ title, testID, children }: { title: string; testID?: string; children: ReactNode }) {
  return (
    <View style={styles.card} testID={testID}>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factTitle}>{title}</Text>
      {children}
    </View>
  );
}

/** A checkbox with its checked state for native (accessibilityState) and the web (aria-checked). */
function Check({
  value,
  onChange,
  label,
  testID,
  disabled,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  testID: string;
  disabled: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled }}
      aria-checked={value}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.check, pressed && styles.pressed]}
    >
      <View style={[styles.box, value && styles.boxOn]}>{value ? <Icon name="checkmark" size={18} color={colors.white} /> : null}</View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

type InputProps = Pick<TextInputProps, 'value' | 'onChangeText' | 'secureTextEntry' | 'keyboardType' | 'placeholder' | 'editable' | 'onSubmitEditing'>;

/** A labelled text field that offers no autofill or saving of what is typed. */
function LabeledInput({ label, hint, testID, ...input }: InputProps & { label: string; hint?: string; testID: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={hint}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="none"
        placeholderTextColor={colors.muted}
        style={[styles.input, input.editable === false && styles.inputOff]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 16 },
  head: { gap: 8 },
  title: { ...typography.screenTitle },
  note: { ...typography.small, color: colors.muted },
  status: { ...typography.label },
  busy: { ...typography.small, fontFamily: fonts.semibold, color: colors.accentInk },
  card: { gap: 12, padding: 16, borderRadius: 18, backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.line },
  cardTitle: { ...typography.label, fontFamily: fonts.extrabold },
  body: { ...typography.small },
  hint: { ...typography.caption, fontFamily: fonts.regular },
  field: { gap: 6 },
  fieldLabel: { ...typography.label },
  input: {
    borderWidth: 1,
    borderColor: colors.controlLine,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    fontFamily: fonts.regular,
    fontSize: 17,
    color: colors.ink,
    backgroundColor: colors.sheet,
  },
  inputOff: { backgroundColor: colors.sheet2, color: colors.muted },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 48, paddingVertical: 4, borderRadius: radius.sm },
  pressed: { backgroundColor: colors.sheet2 },
  box: {
    width: 24,
    height: 24,
    marginTop: 2,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.controlLine,
    backgroundColor: colors.sheet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  profile: { gap: 8 },
  fact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 40,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft,
  },
  factTitle: { ...typography.small, fontFamily: fonts.semibold, color: colors.ink },
  factValue: { ...typography.label },
  signout: { gap: 6 },
});
