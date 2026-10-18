import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useApp } from './AppContext';
import { Page, ReadOnlyNotice, StorageRefused } from './components';
import { colors } from './theme';

/**
 * Routes that redirect based on durable learner data must not decide anything before the
 * store has hydrated: on a reload the learner is briefly null, and redirecting then would
 * leave the saved route (e.g. a question in progress) for Home.
 */
export function HydrationGate({ children, write }: { children: ReactNode; /** Route saves data: read-only tabs see the notice instead. */ write?: boolean }) {
  const { ready, error, readOnly } = useApp();
  if (ready && error) return <StorageRefused message={error} />;
  if (ready && write && readOnly) {
    return (
      <Page>
        <ReadOnlyNotice reason={readOnly} />
      </Page>
    );
  }
  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }} testID="hydrating">
        <ActivityIndicator color={colors.indigo} accessibilityLabel="Memuat data tersimpan" />
      </View>
    );
  }
  return <>{children}</>;
}
