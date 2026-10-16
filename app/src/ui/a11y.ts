import type { RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform } from 'react-native';

/**
 * Moves keyboard / screen-reader focus to an element (UI-01: answer feedback heading). On web the
 * element needs tabIndex -1; on native the accessibility focus is set. Never throws.
 */
export function moveFocus(ref: RefObject<unknown>) {
  const node = ref.current as { focus?: () => void } | null;
  if (!node) return;
  try {
    if (Platform.OS === 'web') node.focus?.();
    else {
      const tag = findNodeHandle(node as never);
      if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
    }
  } catch {
    // focus is an enhancement; the live region still announces the result
  }
}
