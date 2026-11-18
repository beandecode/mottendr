import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Leaf, MoreHorizontal, X } from 'lucide-react';
import { parseBoundedInt } from '../platform/input';

export function Stat({
  value,
  label,
  icon,
}: {
  value: ReactNode;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <div className="stat-card">
      {icon && <span className="stat-icon">{icon}</span>}
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <Leaf size={36} />
      <h2>{title}</h2>
      {children}
    </div>
  );
}
// `hideTitle`: the content shows the title itself (an entry's headword); the dialog keeps it for
// screen readers. `actions` sit beside the close button.
export function Dialog({
  title,
  close,
  closeLabel,
  children,
  hideTitle = false,
  actions,
}: {
  title: string;
  close: () => void;
  closeLabel: string;
  children: ReactNode;
  hideTitle?: boolean;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        className="modal"
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Tab') {
            const all = Array.from(
              ref.current!.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
              ),
            ).filter((el) => el.offsetParent !== null);
            if (!all.length) {
              e.preventDefault();
              return;
            }
            const first = all[0],
              last = all.at(-1)!;
            if (
              e.shiftKey &&
              (document.activeElement === first || document.activeElement === ref.current)
            ) {
              e.preventDefault();
              last.focus();
            } else if (
              !e.shiftKey &&
              (document.activeElement === last || document.activeElement === ref.current)
            ) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header className={`modal-header ${hideTitle ? 'plain' : ''}`}>
          <h2 className={hideTitle ? 'visually-hidden' : undefined}>{title}</h2>
          <div className="modal-actions">
            {actions}
            <button className="icon-button" aria-label={closeLabel} onClick={close}>
              <X size={21} />
            </button>
          </div>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// Typing edits a draft; the value is saved on blur or Enter, so iOS keeps the keyboard open
// while several digits are entered.
export function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  testId,
  commit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  testId?: string;
  commit: (value: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(String(value)),
    editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(String(value));
  }, [value]);
  async function save() {
    editing.current = false;
    const next = parseBoundedInt(draft, min, max);
    if (next === null || next === value) {
      setDraft(String(value));
      return;
    }
    setDraft(String(next));
    if (!(await commit(next))) setDraft(String(value));
  }
  return (
    <label>
      {label}
      <input
        aria-label={label}
        data-testid={testId}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        enterKeyHint="done"
        value={draft}
        disabled={disabled}
        onFocus={() => (editing.current = true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function SettingSwitch({
  label,
  testId,
  checked,
  disabled,
  change,
}: {
  label: string;
  testId: string;
  checked: boolean;
  disabled: boolean;
  change: (value: boolean) => unknown;
}) {
  return (
    <label className="setting-switch">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(e) => change(e.target.checked)}
      />
    </label>
  );
}

// Calls onLoad when the end of a long list scrolls near the screen, instead of a "Show more" button.
export function AutoLoad({ onLoad, label }: { onLoad: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null),
    load = useRef(onLoad);
  load.current = onLoad;
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) load.current();
      },
      { rootMargin: '800px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="auto-load">
      <button className="text-button" onClick={onLoad}>
        {label}
      </button>
    </div>
  );
}

// A "…" button with a short menu of actions, closed by choosing, Escape or a tap elsewhere.
export function MoreMenu({
  label,
  items,
}: {
  label: string;
  items: { label: string; icon?: ReactNode; testId?: string; danger?: boolean; run: () => void }[];
}) {
  const [open, setOpen] = useState(false),
    ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="more-menu" ref={ref}>
      <button
        className="icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={20} />
      </button>
      {open && (
        <div className="more-menu-list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={item.danger ? 'danger' : undefined}
              data-testid={item.testId}
              onClick={() => {
                setOpen(false);
                item.run();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The last value shown, so returning to a page rolls from the old number to the new one.
const shownNumbers = new Map<string, number>();
export function RollingNumber({ id, value }: { id: string; value: number }) {
  const from = shownNumbers.get(id) ?? value,
    digits = String(value),
    previous = String(from).padStart(digits.length, '0').slice(-digits.length);
  // Digits render at the old value first, then roll on the next frame.
  const [rolledTo, setRolledTo] = useState(from === value ? value : null),
    rolled = rolledTo === value;
  useEffect(() => {
    shownNumbers.set(id, value);
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setRolledTo(value)));
    return () => cancelAnimationFrame(frame);
  }, [id, value]);
  return (
    <span className="rolling-number" aria-label={digits} role="img">
      {[...digits].map((digit, i) => {
        const start = Number(previous[i]),
          end = Number(digit),
          steps = (end - start + 10) % 10;
        const sequence = Array.from({ length: steps + 1 }, (_, k) => (start + k) % 10);
        return (
          <span className="rolling-digit" key={`${value}-${i}`} aria-hidden="true">
            <span
              style={{
                transform: `translateY(-${rolled ? steps : 0}em)`,
                transitionDelay: `${i * 70}ms`,
              }}
            >
              {sequence.map((n, k) => (
                <span key={k}>{n}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

const SWIPE_ACTION_WIDTH = 84;
// A list row that slides left to show up to three actions, as in iOS Mail. Sliding past most of
// the row runs the first action. Vertical drags scroll the page as usual (touch-action: pan-y).
export function SwipeRow({
  open,
  onOpenChange,
  actions,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: { label: string; icon: ReactNode; run: () => void }[];
  children: ReactNode;
}) {
  const front = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; base: number; dx: number; active: boolean } | null>(null),
    dragged = useRef(false);
  const width = actions.length * SWIPE_ACTION_WIDTH;
  const place = (x: number | null) => {
    const el = front.current;
    if (!el) return;
    el.style.transition = x === null ? '' : 'none';
    el.style.transform = x === null ? '' : `translateX(${x}px)`;
  };
  return (
    <div
      className={`swipe-row ${open ? 'open' : ''}`}
      style={{ '--swipe-width': `${width}px` } as CSSProperties}
    >
      <div className="swipe-actions">
        {actions.map((a, i) => (
          <button
            key={a.label}
            className={`swipe-action-${i + 1}`}
            tabIndex={open ? 0 : -1}
            aria-hidden={!open}
            onClick={() => {
              a.run();
              onOpenChange(false);
            }}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
      <div
        ref={front}
        className="swipe-front"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          dragged.current = false;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            base: open ? -width : 0,
            dx: 0,
            active: false,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
          if (!d.active) {
            if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
              drag.current = null;
              return;
            }
            if (Math.abs(dx) < 8) return;
            d.active = dragged.current = true;
            front.current?.setPointerCapture(e.pointerId);
          }
          d.dx = dx;
          place(Math.min(0, d.base + dx));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d?.active) return;
          place(null);
          const x = d.base + d.dx,
            rowWidth = front.current?.offsetWidth ?? width * 2;
          if (x < -rowWidth * 0.65) {
            actions[0]?.run();
            onOpenChange(false);
          } else onOpenChange(x < -width / 2);
        }}
        onPointerCancel={() => {
          drag.current = null;
          place(null);
        }}
        onClickCapture={(e) => {
          // A drag, or a tap on an open row, only moves the row.
          if (dragged.current || open) {
            e.preventDefault();
            e.stopPropagation();
            dragged.current = false;
            if (open) onOpenChange(false);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

// A search bar that stays under the top bar takes the top bar's glass only once it is stuck:
// a one-pixel sentinel before it tells when it has scrolled up to the top bar.
export function StickySearch({ children }: { children: ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null),
    [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), {
      rootMargin: '-80px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div ref={sentinel} className="sticky-sentinel" />
      <div className={`sticky-search ${stuck ? 'stuck' : ''}`}>{children}</div>
    </>
  );
}
