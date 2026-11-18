import { cardSense, frenchDisplay } from '../domain/headword';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  Flag,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import type { AppState, Entry, Task } from '../domain/types';
import { localeFor } from '../domain/types';
import { commitAnswer, skipTask, uid } from '../domain/learning';
import { primaryDefinition } from '../domain/lexicon';
import { autoSpeechEnabled } from '../domain/study-preferences';
import {
  cardControls,
  cardRegion,
  confirmedSwipe,
  arrowDirection,
  swipeDirection,
  swipeThreshold,
  useTouchInput,
} from '../platform/input';
import { feedback } from '../platform/native';
import { preview } from '../scheduler';
import { tagLabel, translator, type Label } from '../i18n';
import { collectionOf } from '../domain/collections';
import { EntryBadges } from './Lexicon';
import { calibrateInk, measureInk, snapToPixel, type InkLetter } from '../app/ink';

type Rating = 1 | 2 | 3 | 4;
export interface StudyCardProps {
  task: Task;
  entry: Entry;
  state: AppState;
  mutate: (operation: (draft: AppState) => void) => Promise<boolean>;
  busy: boolean;
  now: number;
  interval: (due: number, from?: number) => string;
  onDetail: (id: string) => void;
  onIssue: (entryId: string, senseId?: string) => void;
  speak: (s: string) => void;
  autoSpeak: (s: string) => void;
  speaking: boolean;
  speechReady: boolean;
  blocked: boolean;
}
// Letters start this many em apart beyond normal spacing; the effect lasts 0.18 s delay + 0.9 s.
// Letters start this many em apart beyond normal spacing. Timings live in styles/tokens.css.
const INK_SPREAD = 0.24;
const gradeKeys: Label[] = ['again', 'hard', 'good', 'easy'];
const directionKeys = ['left', 'right', 'up', 'down'] as const;
const arrows = ['←', '→', '↑', '↓'],
  vectors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

export default function StudyCard({
  task,
  entry,
  state,
  mutate,
  busy,
  now,
  interval,
  onDetail,
  onIssue,
  speak,
  autoSpeak,
  speaking,
  speechReady,
  blocked,
}: StudyCardProps) {
  const t = translator(state.prefs.mode),
    locale = localeFor(state.prefs.mode),
    touch = useTouchInput(),
    controls = cardControls(state.prefs, touch);
  const selectedSense = cardSense(entry, locale),
    displayWord = frenchDisplay(entry, state.prefs, locale);
  const content = {
    short: primaryDefinition(entry, locale),
    irregularNote: selectedSense?.group.specialNotes[locale] ?? '',
  };
  const incompatible =
    !content.short.trim() || (task.direction === 'production' && task.promptLanguage !== locale);
  const [revealed, setRevealed] = useState(false),
    [drag, setDrag] = useState({ x: 0, y: 0 });
  const [departure, setDeparture] = useState<{ x: number; y: number; grade?: Rating } | null>(null);
  const [lastSwipe, setLastSwipe] = useState<{
    distance: number;
    duration: number;
    accepted: boolean;
  } | null>(null);
  // On phones the card fits one screen; a long answer is clipped and the details button stands out.
  const centerRef = useRef<HTMLDivElement>(null),
    [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const center = centerRef.current;
    if (!center) return;
    const measure = () => setOverflowing(center.scrollHeight > center.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(center);
    for (const child of Array.from(center.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [revealed]);
  // Reveal: before the first paint, measure the headword in its final lines, then draw it letter
  // by letter gathering into place (see app/ink.ts). The drawn letters stay for the rest of the
  // card, so nothing is ever swapped back; the real text stays in place, transparent, for
  // selection and screen readers. `still` redraws without the gather effect.
  const titleRef = useRef<HTMLHeadingElement>(null),
    layerRef = useRef<HTMLSpanElement>(null),
    [ink, setInk] = useState<{
      letters: InkLetter[];
      calibrated: boolean;
      still: boolean;
    } | null>(null);
  useLayoutEffect(() => {
    const title = titleRef.current,
      card = title?.closest<HTMLElement>('.flashcard');
    if (
      !revealed ||
      incompatible ||
      !title ||
      !card ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const letters = measureInk(title, card, INK_SPREAD);
    if (!letters.length) return;
    setInk({ letters, calibrated: false, still: false });
  }, [revealed]);
  // Still before the first paint: line the drawn letters up exactly with the real text.
  useLayoutEffect(() => {
    const title = titleRef.current,
      layer = layerRef.current,
      card = title?.closest<HTMLElement>('.flashcard');
    if (!ink || ink.calibrated || !title || !layer || !card) return;
    setInk({ ...ink, letters: calibrateInk(title, card, layer, ink.letters), calibrated: true });
  }, [ink]);
  // When the headword's size changes (rotation, window width, text size), lay the letters out
  // again at once, without the effect. Study.tsx blurs the page while the width settles.
  const inking = !!ink;
  useEffect(() => {
    const title = titleRef.current,
      card = title?.closest<HTMLElement>('.flashcard');
    if (!inking || !title || !card) return;
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      const letters = measureInk(title, card, INK_SPREAD);
      if (letters.length) setInk({ letters, calibrated: false, still: true });
    });
    observer.observe(title);
    return () => observer.disconnect();
  }, [inking]);
  const [ratingLock, setRatingLock] = useState(false),
    submitLock = useRef(false),
    cancelDeparture = useRef<(() => void) | null>(null);
  const start = useRef<{
      x: number;
      y: number;
      at: number;
      id: number;
      width: number;
      height: number;
    } | null>(null),
    suppressClickUntil = useRef(0);
  const [eventId] = useState(uid),
    [durationStart] = useState(Date.now),
    attemptAt = now;
  const outcomes = useMemo(
    () => preview(task.card, attemptAt, state.prefs.retention),
    [task.card, attemptAt, state.prefs.retention],
  );
  const reveal = () => {
    if (!submitLock.current && !busy && !blocked && !incompatible) setRevealed(true);
  };
  useEffect(() => () => cancelDeparture.current?.(), []);

  // Each question/answer phase speaks at most once. Delay until the parent's
  // previous-card cancellation and the reveal render have both completed.
  const spoken = useRef(new Set<string>()),
    autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSpeakRef = useRef(autoSpeak);
  autoSpeakRef.current = autoSpeak;
  const phase = revealed ? 'answer' : 'question';
  useEffect(() => {
    if (
      blocked ||
      ratingLock ||
      incompatible ||
      !speechReady ||
      spoken.current.has(phase) ||
      !autoSpeechEnabled(state.prefs, task.direction, revealed)
    )
      return;
    autoTimer.current = setTimeout(() => {
      spoken.current.add(phase);
      autoTimer.current = null;
      autoSpeakRef.current(displayWord);
    }, 180);
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
      autoTimer.current = null;
    };
  }, [
    phase,
    blocked,
    ratingLock,
    incompatible,
    speechReady,
    task.direction,
    state.prefs.autoSpeakQuestion,
    state.prefs.autoSpeakRecognitionAnswer,
    state.prefs.autoSpeakProductionAnswer,
    displayWord,
  ]);
  function manualSpeech() {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = null;
    spoken.current.add(phase);
    speak(displayWord);
  }

  async function submit(rating?: Rating) {
    if (submitLock.current || busy || blocked || incompatible || !revealed) return;
    submitLock.current = true;
    setRatingLock(true);
    const direction = rating ? state.prefs.swipeMap.indexOf(rating) : -1,
      vector = direction >= 0 ? vectors[direction] : [0, 1];
    setDeparture({ x: vector[0] * 200, y: vector[1] * 200, grade: rating });
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
    const continueSubmit = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        cancelDeparture.current = null;
        resolve(true);
      }, delay);
      cancelDeparture.current = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
    if (!continueSubmit) return;
    const ok = await mutate((d) =>
      commitAnswer(
        d,
        task.id,
        eventId,
        Date.now(),
        Date.now() - durationStart,
        rating,
        outcomes,
        attemptAt,
      ),
    );
    if (ok) feedback();
    else {
      submitLock.current = false;
      setRatingLock(false);
      setDeparture(null);
      setDrag({ x: 0, y: 0 });
    }
  }
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        blocked ||
        e.repeat ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        document.querySelector('[role="dialog"]') ||
        target.isContentEditable ||
        target.closest('input,textarea,select')
      )
        return;
      if (e.code === 'Space' && !target.closest('button,a')) {
        e.preventDefault();
        if (!revealed) reveal();
        else if (!task.learnedAt) void submit();
      }
      const direction = arrowDirection(e.key);
      if (revealed && task.learnedAt && direction !== null) {
        e.preventDefault();
        void submit(state.prefs.swipeMap[direction] as Rating);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [
    revealed,
    busy,
    ratingLock,
    blocked,
    task.id,
    incompatible,
    attemptAt,
    outcomes,
    state.prefs.swipeMap,
  ]);
  function pointerDown(e: PointerEvent<HTMLDivElement>) {
    const control = (e.target as HTMLElement).closest('button,a,input,textarea,select');
    if (
      !controls.swipe ||
      !e.isPrimary ||
      start.current ||
      (control && !control.classList.contains('card-zone')) ||
      !revealed ||
      !task.learnedAt ||
      busy ||
      submitLock.current ||
      blocked ||
      incompatible ||
      e.button !== 0 ||
      window.getSelection()?.toString()
    )
      return;
    start.current = {
      x: e.clientX,
      y: e.clientY,
      at: performance.now(),
      id: e.pointerId,
      width: e.currentTarget.clientWidth,
      height: e.currentTarget.clientHeight,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e: PointerEvent<HTMLDivElement>) {
    if (start.current?.id === e.pointerId)
      setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
  }
  function cancelDrag() {
    if (start.current) suppressClickUntil.current = performance.now() + 500;
    start.current = null;
    setDrag({ x: 0, y: 0 });
  }
  function pointerUp(e: PointerEvent<HTMLDivElement>) {
    const gesture = start.current;
    if (!gesture || gesture.id !== e.pointerId) return;
    const x = e.clientX - gesture.x,
      y = e.clientY - gesture.y;
    start.current = null;
    if (Math.max(Math.abs(x), Math.abs(y)) > 12)
      suppressClickUntil.current = performance.now() + 500;
    const duration = performance.now() - gesture.at,
      direction = confirmedSwipe(x, y, gesture.width, gesture.height, duration);
    setLastSwipe({
      distance: Math.max(Math.abs(x), Math.abs(y)),
      duration,
      accepted: direction !== null,
    });
    if (direction !== null) void submit(state.prefs.swipeMap[direction] as Rating);
    else setDrag({ x: 0, y: 0 });
  }
  function cardClick(e: MouseEvent<HTMLDivElement>) {
    if (
      busy ||
      submitLock.current ||
      blocked ||
      incompatible ||
      performance.now() < suppressClickUntil.current ||
      window.getSelection()?.toString() ||
      (e.target as HTMLElement).closest('button,a,input,textarea,select,.card-bottom')
    )
      return;
    if (!revealed) {
      reveal();
      return;
    }
    if (!task.learnedAt) {
      void submit();
      return;
    }
    if (!controls.grid) return;
    const r = e.currentTarget.getBoundingClientRect(),
      zone = cardRegion(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (zone !== null) void submit(state.prefs.swipeMap[zone] as Rating);
  }
  const reviewAnswer = revealed && !!task.learnedAt && !incompatible;
  const major = Math.max(Math.abs(drag.x), Math.abs(drag.y)),
    dragDirection = swipeDirection(drag.x, drag.y),
    dragRating = state.prefs.swipeMap[dragDirection] as Rating;
  const bounds = start.current,
    threshold = bounds ? swipeThreshold(dragDirection, bounds.width, bounds.height) : 125;
  const commitReady =
    bounds && confirmedSwipe(drag.x, drag.y, bounds.width, bounds.height, 120) !== null;
  const colorGrade = departure?.grade ?? (major > 12 ? dragRating : undefined),
    position = departure ?? { x: drag.x * 0.65, y: drag.y * 0.65 };
  const style = {
    transform: `translate(${position.x}px,${position.y}px) rotate(${position.x * 0.02}deg)`,
    opacity: departure ? 0 : 1,
    '--swipe-progress': departure?.grade ? 0.8 : Math.min(0.8, (major / threshold) * 0.8),
  } as CSSProperties;
  const hints = [
    ...(controls.swipe ? [t('gestureHint')] : []),
    ...(controls.grid ? [t('zonesHint')] : []),
    ...(controls.buttons ? [t('buttonsHint')] : []),
    ...(!touch ? [t('keyboardHint')] : []),
  ];
  const frenchTitle = task.direction === 'recognition' || revealed;
  const title = incompatible ? t('missing') : frenchTitle ? displayWord : content.short;
  return (
    <>
      <div
        className={`flashcard ${revealed ? 'revealed' : ''} ${reviewAnswer && controls.swipe ? 'gesture-enabled' : ''} ${reviewAnswer && controls.grid ? 'zone-enabled' : ''} ${major > 12 ? 'card-dragging' : ''} ${departure ? 'card-departing' : ''} ${colorGrade ? `swipe-grade-${colorGrade}` : ''} ${overflowing ? 'card-overflowing' : ''}`}
        data-testid="flashcard"
        data-stack={Math.min(2, state.session!.queue.length + state.session!.pending.length - 1)}
        data-input-mode={[
          controls.swipe ? 'swipe' : '',
          controls.grid ? 'grid' : '',
          controls.buttons ? 'buttons' : '',
        ]
          .filter(Boolean)
          .join('-')}
        data-revealed={String(revealed)}
        data-departing={String(!!departure)}
        data-last-swipe={lastSwipe ? (lastSwipe.accepted ? 'accepted' : 'cancelled') : undefined}
        data-swipe-distance={lastSwipe?.distance}
        data-swipe-duration={lastSwipe?.duration}
        onClick={cardClick}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={() => {
          if (start.current) cancelDrag();
        }}
        style={style}
      >
        {reviewAnswer &&
          controls.grid &&
          directionKeys.map((direction, i) => {
            const grade = state.prefs.swipeMap[i] as Rating;
            return (
              <button
                key={direction}
                data-testid={`card-zone-${direction}`}
                className={`card-zone card-zone-${direction} grade-${grade}`}
                aria-label={`${t(direction)}: ${t(gradeKeys[grade - 1])}`}
                disabled={busy || ratingLock || blocked}
                onClick={(e) => {
                  e.stopPropagation();
                  if (performance.now() >= suppressClickUntil.current) void submit(grade);
                }}
              >
                <span className="zone-arrow" aria-hidden="true">
                  {arrows[i]}
                </span>
                <span className="zone-grade">{t(gradeKeys[grade - 1])}</span>
                <small>{interval(outcomes[grade].due, attemptAt)}</small>
              </button>
            );
          })}
        <div className="card-top">
          <span className="badge">
            {tagLabel(entry.tags[0] ?? collectionOf(entry), state.prefs.mode)}
          </span>
          <span className="card-number">{state.session!.completed + 1}</span>
        </div>
        {major > 30 && (
          <span className={`drag-label grade-${dragRating}`}>
            <strong>{t(gradeKeys[dragRating - 1])}</strong>
            <small>{t(commitReady ? 'releaseConfirm' : 'swipeFurther')}</small>
          </span>
        )}
        <div className="card-center" ref={centerRef}>
          <span className="eyebrow">{revealed ? t('answer') : 'RAPPELEZ-VOUS'}</span>
          <h2
            ref={titleRef}
            lang={incompatible ? locale : frenchTitle ? 'fr' : locale}
            className={title.length > 18 ? 'long-title' : undefined}
            data-inking={ink ? '' : undefined}
          >
            {title}
            {ink && (
              <span
                ref={layerRef}
                className={`ink-layer ${ink.still ? 'ink-still' : ''}`}
                aria-hidden="true"
              >
                {ink.letters.map((letter, i) => (
                  <span
                    key={i}
                    className="ink-letter"
                    style={
                      {
                        left: snapToPixel(letter.x, window.devicePixelRatio),
                        top: snapToPixel(letter.y, window.devicePixelRatio),
                        '--dx': `${letter.dx}px`,
                      } as CSSProperties
                    }
                  >
                    {letter.ch}
                  </span>
                ))}
              </span>
            )}
          </h2>
          {revealed && task.direction === 'recognition' && (
            <p className="card-definition">{content.short}</p>
          )}
          {revealed && (
            <div className="detail-tags">
              <EntryBadges
                entry={entry}
                mode={state.prefs.mode}
                showGender={state.prefs.showGender !== false}
                groupId={selectedSense?.group.id}
                senseGender={selectedSense?.sense.gender}
              />
            </div>
          )}
          {revealed && content.irregularNote && (
            <p className="card-warning">{content.irregularNote}</p>
          )}
          {!revealed && (
            <p className="card-hint">
              {t('tapReveal')}
              {!touch && ` ${t('keyboardReveal')}`}
            </p>
          )}
          {revealed && !task.learnedAt && !incompatible && (
            <p className="card-hint first-continue">
              {t('tapContinue')}
              {!touch && ` ${t('keyboardContinue')}`}
            </p>
          )}
        </div>
        <div className="card-bottom" onPointerDown={(e) => e.stopPropagation()}>
          {(task.direction === 'recognition' || revealed) && (
            <div className="card-speech">
              <button
                className="round-audio"
                aria-label={t(speaking ? 'stop' : 'listen')}
                disabled={ratingLock}
                onClick={manualSpeech}
              >
                <Volume2 size={21} />
              </button>
            </div>
          )}
          {revealed && (
            <button
              className="text-button card-issue-button"
              data-testid="card-issue"
              disabled={ratingLock}
              onClick={() => onIssue(entry.id, selectedSense?.sense.id)}
            >
              <Flag size={15} />
              {t('issueFlag')}
            </button>
          )}
          {revealed ? (
            <button
              className={`secondary-button card-detail-button ${overflowing ? 'emphasis' : ''}`}
              data-testid="card-detail"
              disabled={ratingLock}
              onClick={() => onDetail(entry.id)}
            >
              {t('detail')}
              <ChevronRight size={16} />
            </button>
          ) : (
            <span className="card-bottom-note">
              {task.learnedAt ? t('recallPrompt') : t('firstHint')}
            </span>
          )}
        </div>
      </div>
      <div className="study-controls">
        {incompatible ? (
          <>
            <p>{t('missing')}</p>
            <button className="secondary-button" onClick={() => onDetail(entry.id)}>
              {t('edit')}
            </button>
          </>
        ) : (
          <>
            {controls.buttons &&
              (!revealed ? (
                <button className="primary-button reveal-button" onClick={reveal}>
                  {t('reveal')}
                  <RotateCcw size={18} />
                </button>
              ) : !task.learnedAt ? (
                <button
                  className="primary-button"
                  disabled={busy || ratingLock}
                  onClick={() => void submit()}
                >
                  {t('learned')}
                  <Check size={18} />
                </button>
              ) : (
                <div className="rating-buttons">
                  {gradeKeys.map((key, i) => (
                    <button
                      key={key}
                      className={`rating-button grade-${i + 1}`}
                      disabled={busy || ratingLock}
                      onClick={() => void submit((i + 1) as Rating)}
                    >
                      <span>
                        {
                          [
                            <ArrowLeft size={16} />,
                            <ArrowRight size={16} />,
                            <ArrowUp size={16} />,
                            <ArrowDown size={16} />,
                          ][state.prefs.swipeMap.indexOf(i + 1)]
                        }
                        {t(key)}
                      </span>
                      <small>{interval(outcomes[(i + 1) as Rating].due, attemptAt)}</small>
                    </button>
                  ))}
                </div>
              ))}
            <p className="control-hint">{!task.learnedAt ? t('firstHint') : t('rateHint')}</p>
            {reviewAnswer && (controls.swipe || controls.grid) && (
              <div className="swipe-guide" aria-label={t('directionMapping')}>
                {directionKeys.map((direction, i) => (
                  <span key={direction} className={`grade-${state.prefs.swipeMap[i]}`}>
                    {arrows[i]} {t(gradeKeys[state.prefs.swipeMap[i] - 1])}
                  </span>
                ))}
              </div>
            )}
            {reviewAnswer && <small className="gesture-help">{hints.join(' ')}</small>}
          </>
        )}
        {controls.buttons && (
          <>
            <button
              className="text-button skip-button"
              disabled={busy || ratingLock}
              onClick={() => mutate((d) => skipTask(d))}
            >
              {t('skip')}
            </button>
            <small className="skip-hint">{t('skipHint')}</small>
          </>
        )}
      </div>
    </>
  );
}
