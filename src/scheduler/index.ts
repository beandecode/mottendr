import { createEmptyCard, fsrs, generatorParameters, type Card } from 'ts-fsrs';
import type { StoredCard } from '../domain/types';
export const SCHEDULER_VERSION = 'ts-fsrs@5.4.2; FSRS-6';
export const serializeCard = (card: Card): StoredCard => ({
  ...card,
  due: card.due.getTime(),
  last_review: card.last_review?.getTime(),
});
export const hydrateCard = (card: StoredCard): Card => ({
  ...card,
  due: new Date(card.due),
  last_review: card.last_review === undefined ? undefined : new Date(card.last_review),
});
export const emptyCard = (at: number) => serializeCard(createEmptyCard(new Date(at)));
export const schedulerParameters = (retention = 0.9) =>
  generatorParameters({
    request_retention: retention,
    enable_fuzz: false,
    enable_short_term: true,
  });
export const scheduler = (retention = 0.9) => fsrs(schedulerParameters(retention));
export function preview(
  card: StoredCard,
  at: number,
  retention: number,
): Record<1 | 2 | 3 | 4, StoredCard> {
  const outcomes = scheduler(retention).repeat(hydrateCard(card), new Date(at));
  return {
    1: serializeCard(outcomes[1].card),
    2: serializeCard(outcomes[2].card),
    3: serializeCard(outcomes[3].card),
    4: serializeCard(outcomes[4].card),
  };
}
export function recall(card: StoredCard, at: number, retention: number): number | null {
  if (!card.last_review || card.stability <= 0) return null;
  return Number(scheduler(retention).get_retrievability(hydrateCard(card), new Date(at), false));
}
