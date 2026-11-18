import type { Card, FSRSParameters } from 'ts-fsrs';
import type { ContentLogRecord, ContentReviewItem, Issue } from './user-layer';
export type LanguageMode = 'zhOnly' | 'zhEnAssist' | 'enOnly';
export type Direction = 'recognition' | 'production';
export type StoredCard = Omit<Card, 'due' | 'last_review'> & { due: number; last_review?: number };
// Entry and its parts are defined once in entry-schema.ts.
export type {
  Locale,
  Bilingual,
  Gender,
  ContentStatus,
  SenseDistance,
  Definition,
  Example,
  Collocation,
  Sense,
  Feature,
  WordForm,
  Mood,
  Person,
  ConjugationRow,
  ConjugationTable,
  VerbProfile,
  PosGroup,
  RelationType,
  EntryRelation,
  FamilyMembership,
  ContentSource,
  Entry,
} from './entry-schema';
import type {
  Bilingual,
  ContentSource,
  ContentStatus,
  Definition,
  Entry,
  Locale,
  Mood,
  Person,
} from './entry-schema';
// Entry targets keep the existing task IDs. Other targets are reserved, not automatically scheduled.
export type LearningTarget =
  | { kind: 'entry' }
  | { kind: 'sense'; senseId: string }
  | { kind: 'conjugation'; groupId: string; mood: Mood; tense: string; person?: Person };
export interface Task {
  id: string;
  entryId: string;
  target: LearningTarget;
  direction: Direction;
  promptLanguage: 'fr' | Locale;
  card: StoredCard;
  learnedAt?: number;
  enabled: boolean;
}
export interface Session {
  id: string;
  direction: Direction;
  promptLanguage: 'fr' | Locale;
  queue: string[];
  pending: string[];
  startedAt: number;
  completed: number;
  scope: string;
  skipped: string[];
}
export interface LearningEvent {
  id: string;
  taskId: string;
  entryId: string;
  at: number;
  kind: 'review' | 'exposure';
  rating?: 1 | 2 | 3 | 4;
  before: Task;
  after: Task;
  sessionBefore: Session;
  explanationLocale: Locale;
  contentVersion: number;
  schedulerVersion: string;
  schedulerParameters?: FSRSParameters;
  durationMs: number;
  voidedAt?: number;
  assisted: boolean;
}
export type NewWordOrder = 'list' | 'frequency' | 'shuffle';
export interface Preferences {
  mode: LanguageMode;
  newLimit: number;
  sessionLimit: number;
  retention: number;
  speechEngine: 'mac' | 'browser';
  voice: string;
  speechRate: number;
  direction: Direction;
  swipeMap: [number, number, number, number];
  fontScale?: number;
  typographyVersion?: 2 | 3;
  // Order of new words; undefined is 'list' (the word list's own order).
  newWordOrder?: NewWordOrder;
  // Before 0.7.5: the "新词乱序" switch. Read only to convert older data (migration.ts).
  shuffleNewWords?: boolean;
  autoSpeakQuestion?: boolean;
  autoSpeakRecognitionAnswer?: boolean;
  autoSpeakProductionAnswer?: boolean;
  swipeEnabled?: boolean;
  gridEnabled?: boolean;
  buttonsEnabled?: boolean;
  showGender?: boolean;
  showArticles?: boolean;
  continuousLearning?: boolean;
  activeTaskLimit?: number;
  refillLimit?: number;
}
export interface AppState {
  schemaVersion: 2;
  revision: number;
  entries: Entry[];
  tasks: Task[];
  events: LearningEvent[];
  prefs: Preferences;
  session: Session | null;
  importBatches: { id: string; at: number; entryIds: string[] }[];
  installedCollections?: {
    id: string;
    version: number;
    at: number;
    previousSession: Session | null;
  }[];
  // Conflicts between the learner's edits and a newer built-in pack, awaiting a decision.
  contentReview?: ContentReviewItem[];
  // Problems flagged while studying (absent when there are none).
  issues?: Issue[];
  // Every content change to an entry, oldest first (absent when there are none).
  contentLog?: ContentLogRecord[];
}
export interface GrammarRequest {
  contractVersion?: 1;
  ruleIds: string[];
  mood?: Mood;
  tense?: string;
  person?: Person;
  level: string;
  explanationLocale: Locale;
  entryId?: string;
  groupId?: string;
  senseId?: string;
  taskType?: 'conjugation' | 'tense-choice' | 'cloze' | 'rewrite';
  context?: string;
}
export interface GrammarExerciseDraft {
  contractVersion: 1;
  exerciseId: string;
  ruleIds: string[];
  mood?: Mood;
  tense?: string;
  person?: Person;
  prompt: Bilingual;
  frenchContext: string;
  acceptedAnswers: string[];
  explanation: Record<Locale, Definition>;
  linkedEntryIds: string[];
  sources: ContentSource[];
  contentStatus: ContentStatus;
  contentVersion: number;
}
export interface GrammarExerciseProvider {
  getCapabilities(): Promise<{ available: boolean; offline: boolean }>;
  createDraft(request: GrammarRequest): Promise<GrammarExerciseDraft>;
}
export interface CardGenerationProvider {
  generateDraft(word: string, locale: Locale): Promise<Entry | null>;
}
export const localeFor = (mode: LanguageMode): Locale => (mode === 'enOnly' ? 'en' : 'zh');
// Version 1 is retained only at the migration boundary.
export type Localized = {
  short: string;
  detail: string;
  exampleTranslation: string;
  irregularNote: string;
};
export interface LegacyEntry {
  id: string;
  word: string;
  ipa: string;
  pos: string;
  gender: '' | 'm' | 'f';
  zh: Localized;
  en: Localized;
  example: string;
  tags: string[];
  source: string;
  sourceStatus: 'sample' | 'user' | 'imported';
  favorite: boolean;
  suspended: boolean;
  archived: boolean;
  note: string;
  noteLanguage: Locale;
  localizedNotes?: Partial<Bilingual>;
  irregular: boolean;
  createdAt: number;
  contentVersion: number;
  importBatchId?: string;
}
export type LegacyTask = Omit<Task, 'target'>;
export type LegacyEvent = Omit<LearningEvent, 'before' | 'after'> & {
  before: LegacyTask;
  after: LegacyTask;
};
export type LegacyState = Omit<AppState, 'schemaVersion' | 'entries' | 'tasks' | 'events'> & {
  schemaVersion: 1;
  entries: LegacyEntry[];
  tasks: LegacyTask[];
  events: LegacyEvent[];
};
