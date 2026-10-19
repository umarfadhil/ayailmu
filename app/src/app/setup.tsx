import { Redirect } from 'expo-router';

import { useApp } from '@/ui/AppContext';
import { HydrationGate } from '@/ui/Hydration';

/**
 * The session-length step now lives in the basic profile with the consent (/consent). A direct or
 * refreshed /setup goes there, or Home once a learner exists; nothing is created here.
 */
function SetupRoute() {
  const { learner } = useApp();
  return <Redirect href={learner ? '/' : '/consent'} />;
}

export default function Setup() {
  return (
    <HydrationGate write>
      <SetupRoute />
    </HydrationGate>
  );
}
