import type { ContentPack } from './schema';
import demo from './fixtures/demo-unit-a.json';

/**
 * Synthetic, unreviewed developer fixture. Real lesson content is loaded only
 * after reviewers mark items approved-for-trial (spec §9, §14).
 */
export const demoPack = demo as unknown as ContentPack;
