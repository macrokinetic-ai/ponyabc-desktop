import { useId, useState, type ReactNode } from 'react';

/**
 * A single disclosure item: title (+ optional short summary) always visible, full body
 * revealed only once the user activates the toggle. Used for Privacy & Legal content so the
 * full legal text isn't dumped on screen the moment Settings opens — see SettingsScreen.
 *
 * Deliberately a plain native <button> (not a custom widget) so keyboard focus/activation
 * (Tab, Enter, Space) works for free, with aria-expanded/aria-controls wiring the disclosure
 * relationship for screen readers.
 */
export function CollapsibleSection({
  title,
  summary,
  readLabel,
  collapseLabel,
  children,
  defaultOpen = false,
}: {
  title: ReactNode;
  summary?: ReactNode;
  readLabel: string;
  collapseLabel: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className="collapsible">
      <div className="collapsible__header">
        <div className="collapsible__heading">
          <h3 className="collapsible__title">{title}</h3>
          {summary && <p className="hint collapsible__summary">{summary}</p>}
        </div>
        <button
          type="button"
          className="button collapsible__toggle"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? collapseLabel : readLabel}
        </button>
      </div>
      {open && (
        <div id={contentId} className="collapsible__content">
          {children}
        </div>
      )}
    </div>
  );
}
