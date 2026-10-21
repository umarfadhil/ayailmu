// Remembering an email sign-in on this device (D1 in docs/plans/2026-10-20-session-recovery.md): off by default, and on
// only in a build that sets EXPO_PUBLIC_REMEMBER_DEVICE to exactly "on", on a device with a secure session vault.
// Without it no vault is read or written, no choice is offered, and leaving the app signs out as before.

/** Whether this build offers to remember an email sign-in. Expo inlines EXPO_PUBLIC_* values when it bundles the app. */
export function rememberDeviceEnabled(value: unknown = process.env.EXPO_PUBLIC_REMEMBER_DEVICE): boolean {
  return value === 'on';
}
