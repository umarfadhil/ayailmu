// Registration as the account panel shows it, presentational only: the synthetic test-account flow, or, where the model
// says 'confirmed-email', the production one with ordinary wording. The caller's registration model (the controller's
// state, whether it may run now, and callbacks) decides every stage, status and request. The panel keeps
// only what is typed, per stage: the password leaves once on submit and is cleared at once, the code once on confirm,
// and each stage's values go when it ends or unmounts. Nothing is sent, stored or logged here.
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { Btn } from '@/ui/components';
import { colors, fonts, radius, typography } from '@/ui/theme';
import { PRIVATE_QA_REGISTRATION_POLICY } from '@/account/privateQa';
import type { RegistrationEmailPolicy } from '@/auth/registration';
import type { RegistrationState } from '@/ui/account/registrationController';

/** Registration as the panel shows it: the controller's state, whether it may run now, and callbacks that delegate to it. */
export type RegistrationPanelModel = RegistrationState & {
  available: boolean;
  /**
   * Present only as 'confirmed-email' for production registration, or as the private QA policy for the private native QA
   * build; absent for the synthetic test-account flow.
   */
  emailPolicy?: RegistrationEmailPolicy;
  onStart(): void;
  onRegister(email: string, password: string): void;
  /** Back to the code stage for a typed address (e.g. after a reload): no password, sign-up or request. */
  onUseCode(email: string): void;
  onConfirm(code: string): void;
  onResend(): void;
  onCancel(): void;
  /** After confirmation: back to the normal password sign-in, which the learner uses themselves. */
  onSignIn(): void;
};

/** Whether `policy` takes conventional addresses, so the panel uses ordinary email wording: production's or the private QA build's. */
export const ordinaryEmail = (policy: RegistrationEmailPolicy | undefined): boolean =>
  policy === 'confirmed-email' || policy === PRIVATE_QA_REGISTRATION_POLICY;

/**
 * The panel's introduction while registration is offered, at `service`; with Google, the .test rule is for email only.
 * With `policy` 'confirmed-email' (production): the ordinary steps only, with no test-account or .test wording. With the
 * private QA policy: the same ordinary wording, naming only the address approved for this build.
 */
export function registrationIntro(google: boolean, service: string, policy?: RegistrationEmailPolicy): string {
  if (policy === 'confirmed-email') {
    return 'Masuk atau daftar dengan email Anda.';
  }
  if (policy === PRIVATE_QA_REGISTRATION_POLICY) {
    return 'Masuk atau daftar dengan email yang disetujui untuk build ini.';
  }
  const rule = google ? 'Untuk email dan kata sandi, pakai alamat email berakhiran .test' : 'Pakai alamat email berakhiran .test';
  return `Daftar atau masuk dengan akun uji coba di ${service}, khusus untuk pengembangan. ${rule}: kode konfirmasi hanya masuk ke kotak masuk uji pribadi, bukan ke email sungguhan.`;
}

/**
 * The registration entry while idle, else its card: the address and password, the code, or the prompt to sign in.
 * `working`: the account panel's own action is under way, so nothing new starts.
 */
export function RegistrationPanel({ model, working }: { model: RegistrationPanelModel; working: boolean }) {
  const blocked = working || model.busy || !model.available;
  const confirmed = ordinaryEmail(model.emailPolicy);
  if (model.stage === 'idle') {
    return (
      <Btn
        testID="account-registration-start"
        kind="secondary"
        label={confirmed ? 'Daftar akun' : 'Daftar akun uji baru'}
        disabled={blocked}
        onPress={() => !blocked && model.onStart()}
      />
    );
  }
  return (
    <View style={styles.card} testID="account-registration">
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {confirmed ? 'Daftar akun' : 'Daftar akun uji'}
      </Text>
      <View role="status" accessibilityLiveRegion="polite">
        <Text testID="account-registration-status" style={[styles.status, model.error !== null && styles.error]}>
          {model.message ?? ''}
        </Text>
      </View>
      {model.stage === 'email' ? (
        <EmailStep model={model} blocked={blocked} />
      ) : model.stage === 'code' ? (
        <CodeStep key={model.email ?? ''} model={model} blocked={blocked} />
      ) : (
        <Btn testID="account-registration-signin" label="Masuk dengan kata sandi" icon="arrow-forward" disabled={false} onPress={model.onSignIn} />
      )}
    </View>
  );
}

function EmailStep({ model, blocked }: { model: RegistrationPanelModel; blocked: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const address = email.trim();
  const register = () => {
    if (blocked || !address || !password) return;
    const typed = password;
    setPassword(''); // handed over once: the panel keeps no password
    model.onRegister(address, typed);
  };
  const useCode = () => {
    if (blocked || !address) return;
    setPassword('');
    model.onUseCode(address);
  };
  const cancel = () => {
    setEmail('');
    setPassword('');
    model.onCancel();
  };
  const confirmed = ordinaryEmail(model.emailPolicy);
  return (
    <>
      <Field
        label={confirmed ? 'Email' : 'Email uji (.test)'}
        testID="account-registration-email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        placeholder={confirmed ? 'nama@contoh.com' : 'nama@ayailmu.test'}
        editable={!model.busy}
      />
      <Field
        label="Kata sandi"
        testID="account-registration-password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!model.busy}
        onSubmitEditing={register}
        hint={
          confirmed
            ? 'Minimal 8 karakter. Gunakan kata sandi unik.'
            : 'Pakai kata sandi khusus uji coba, bukan yang Anda pakai di tempat lain.'
        }
      />
      <Btn testID="account-registration-submit" label="Daftar" icon="arrow-forward" disabled={blocked || !address || !password} onPress={register} />
      <Btn testID="account-registration-use-code" kind="secondary" label="Sudah punya kode" disabled={blocked || !address} onPress={useCode} />
      <Btn testID="account-registration-cancel" kind="quiet" label="Batal" disabled={false} onPress={cancel} />
    </>
  );
}

function CodeStep({ model, blocked }: { model: RegistrationPanelModel; blocked: boolean }) {
  const [code, setCode] = useState('');
  const confirm = () => {
    const typed = code.trim();
    if (blocked || !typed) return;
    setCode('');
    model.onConfirm(typed);
  };
  const resend = () => {
    if (blocked) return;
    setCode('');
    model.onResend();
  };
  const cancel = () => {
    setCode('');
    model.onCancel();
  };
  return (
    <>
      {model.email ? <Text style={styles.hint}>{`Kode konfirmasi untuk ${model.email}.`}</Text> : null}
      <Field
        label="Kode konfirmasi"
        testID="account-registration-code"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={10}
        editable={!model.busy}
        onSubmitEditing={confirm}
      />
      <Btn testID="account-registration-confirm" label="Konfirmasi" icon="arrow-forward" disabled={blocked} onPress={confirm} />
      <Btn testID="account-registration-resend" kind="secondary" label="Minta kode baru" disabled={blocked} onPress={resend} />
      <Btn testID="account-registration-cancel" kind="quiet" label="Batal" disabled={false} onPress={cancel} />
    </>
  );
}

type FieldProps = Pick<TextInputProps, 'value' | 'onChangeText' | 'secureTextEntry' | 'keyboardType' | 'maxLength' | 'placeholder' | 'editable' | 'onSubmitEditing'>;

/** A labelled text field that offers no autofill, correction or saving of what is typed. */
function Field({ label, hint, testID, ...input }: FieldProps & { label: string; hint?: string; testID: string }) {
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
  card: { gap: 12, padding: 16, borderRadius: 18, backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.line },
  cardTitle: { ...typography.label, fontFamily: fonts.extrabold },
  status: { ...typography.small, color: colors.muted },
  error: { fontFamily: fonts.semibold, color: colors.dangerInk },
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
});
