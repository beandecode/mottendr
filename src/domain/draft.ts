import { current, isDraft } from 'immer';

// Domain operations also run on immer drafts inside mutate. structuredClone cannot copy
// a draft proxy, so take a plain snapshot of it first.
export const snapshot = <T>(value: T): T =>
  structuredClone(isDraft(value) ? current(value) : value);
