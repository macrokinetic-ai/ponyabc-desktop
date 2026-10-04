/**
 * Who this build says it is, for every request to the catalogue.
 *
 * One definition, because 0.3.17's two requests disagreed: the catalogue fetch said "I am
 * 0.3.17" and the download that followed said nothing at all. Two copies of this function in two
 * IPC modules is the same hazard in slower motion — they would agree until the day one of them
 * was edited.
 *
 * Kept apart from `catalogueRequest.ts` on purpose: that module is pure and unit-testable, and
 * this one reaches for `electron` and the internal surface, which a test would have to mock.
 */

import { app } from 'electron';

import * as internal from '@internal';
import type { CatalogueIdentity } from './catalogueRequest';

export function currentCatalogueIdentity(): CatalogueIdentity {
  return { appVersion: app.getVersion(), testerKey: internal.testerKeyForRequests() };
}
