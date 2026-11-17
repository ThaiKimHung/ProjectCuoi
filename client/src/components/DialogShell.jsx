import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-xl',
  xl: 'max-w-3xl',
  '2xl': 'max-w-4xl',
};

// One frame for every dialog: same header (icon, sentence-case title, close button),
// Esc closes, Tab stays inside, focus returns to where it was when the dialog closes.
export function DialogShell({
  title,
  description,
  icon: Icon,
  badge,
  onClose,
  size = 'md',
  footer,
  children,
  bodyClassName = 'min-h-0 flex-1 overflow-y-auto p-6',
  closeLabel = 'Đóng',
}) {
  const panelRef = useRef(null);
  // Read during the first render, before an autoFocus field inside takes focus.
  const returnFocusRef = useRef(typeof document === 'undefined' ? null : document.activeElement);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const previous = returnFocusRef.current;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const preferred = panel.querySelector('[autofocus], [data-autofocus]');
      (preferred || panel).focus();
    }
    return () => {
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
    };
  }, []);

  const handleKeyDown = event => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(31_29_26/0.45)] p-4 backdrop-blur-[2px]">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`flex max-h-[90vh] w-full ${SIZES[size] || size} flex-col overflow-hidden rounded-2xl border border-studio-line bg-[var(--studio-panel)] text-stone-100 shadow-2xl outline-none`}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-studio-line px-6 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span className="studio-logo mt-0.5">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="flex flex-wrap items-center gap-2 text-base font-semibold text-stone-50">
                {title}
                {badge && <span className="rounded-full bg-rose-950 px-2 py-0.5 text-[11px] font-medium text-rose-200">{badge}</span>}
              </h2>
              {description && <p id={descriptionId} className="mt-0.5 text-xs text-stone-400">{description}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} className="studio-icon -mr-2" aria-label={closeLabel} title={`${closeLabel} (Esc)`}>
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className={bodyClassName}>{children}</div>
        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-studio-line bg-studio-raised px-6 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
