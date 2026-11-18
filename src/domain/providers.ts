import { hasExplanation } from './lexicon';
import type {
  CardGenerationProvider,
  Entry,
  GrammarExerciseProvider,
  GrammarRequest,
  Locale,
} from './types';
export interface GrammarEvaluationProvider {
  evaluate(
    exerciseId: string,
    response: string,
  ): Promise<{
    result: 'correct' | 'incorrect' | 'partial' | 'needsReview';
    explanationLocale: Locale;
    feedback: string;
  }>;
}
export interface GrammarExplanationProvider {
  getExplanation(
    ruleId: string,
    locale: Locale,
  ): Promise<{ short: string; detail: string; examples: string[] } | null>;
}
export class ReservedGrammarProvider implements GrammarExerciseProvider {
  async getCapabilities() {
    return { available: false, offline: false };
  }
  async createDraft(_request: GrammarRequest): Promise<never> {
    throw new Error('GRAMMAR_NOT_CONFIGURED');
  }
}
export class LocalCardProvider implements CardGenerationProvider {
  constructor(private entries: Entry[]) {}
  async generateDraft(word: string, locale: Locale) {
    const found = this.entries.find(
      (e) =>
        e.word.normalize('NFC').toLocaleLowerCase('fr') ===
          word.normalize('NFC').trim().toLocaleLowerCase('fr') && hasExplanation(e, locale),
    );
    return found ? structuredClone(found) : null;
  }
}
