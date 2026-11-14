import { useEffect, useId, useRef, useState } from 'react';
import type { EmployeeRecord } from '../api/types';
import { useManagerSearch } from '../lib/useManagerSearch';

interface ManagerComboboxProps {
  /** The chosen manager ('' = nobody, the org root). */
  value: string;
  /** Called with the chosen manager id, or '' for nobody. */
  onChange: (value: string) => void;
  /** The employee themself, who cannot be their own manager. */
  excludeId?: string;
  /** The id of the input (the label points at it). */
  id: string;
  disabled?: boolean;
  /** Identifies the search (a different key restarts it). */
  searchKey: string;
  /** Initial or existing display label for the selected manager. */
  initialLabel?: string | null;
  /** Called after a retry, so the screen can react (the combobox retries on its own). */
  onRetry?: () => void;
}

/**
 * A manager picker that searches instead of loading the whole roster.
 *
 * <p>It is a listbox combobox: a text field with {@code role="combobox"}, a list of the matches
 * and full keyboard support (arrow keys move the highlight, Enter picks it, Escape closes the
 * list). "No manager (org root)" is always offered and is keyboard-selectable.
 */
export function ManagerCombobox({
  value,
  onChange,
  excludeId,
  id,
  disabled = false,
  searchKey,
  initialLabel,
  onRetry,
}: ManagerComboboxProps): JSX.Element {
  const search = useManagerSearch(searchKey, excludeId);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [chosenCandidate, setChosenCandidate] = useState<{ id: string; label: string } | null>(null);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Purely derived selected manager label: chosen candidate in this session, or initialLabel
  const selectedLabel =
    value === ''
      ? null
      : chosenCandidate && chosenCandidate.id === value
        ? chosenCandidate.label
        : (initialLabel ?? null);

  // When loading a new search query, do NOT offer stale selectable results.
  const candidates = search.loading ? [] : search.results;

  // Options count: option 0 is always "No manager (org root)", followed by candidates.
  const totalOptions = 1 + candidates.length;
  const activeIndex = Math.min(Math.max(0, highlighted), totalOptions - 1);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function onPointerDown(event: MouseEvent): void {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  function chooseNone(): void {
    setChosenCandidate(null);
    onChange('');
    search.clear();
    setOpen(false);
    inputRef.current?.focus();
  }

  function choose(employee: EmployeeRecord): void {
    setChosenCandidate({
      id: employee.id,
      label: `${employee.fullName} · ${employee.employeeNumber}`,
    });
    onChange(employee.id);
    search.clear();
    setOpen(false);
    inputRef.current?.focus();
  }

  function clearSelection(): void {
    setChosenCandidate(null);
    onChange('');
    search.clear();
    setHighlighted(0);
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlighted(0);
      } else {
        setHighlighted((current) => Math.min(current + 1, totalOptions - 1));
      }
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlighted(totalOptions - 1);
      } else {
        setHighlighted((current) => Math.max(current - 1, 0));
      }
      return;
    }
    if (event.key === 'Enter') {
      if (open) {
        event.preventDefault();
        if (activeIndex === 0) {
          chooseNone();
        } else {
          const option = candidates[activeIndex - 1];
          if (option !== undefined) {
            choose(option);
          }
        }
      }
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (event.key === 'Backspace' && search.query === '' && value !== '') {
      clearSelection();
    }
  }

  const activeOptionId =
    !open
      ? undefined
      : activeIndex === 0
        ? `${listId}-none`
        : candidates[activeIndex - 1]
          ? `${listId}-${candidates[activeIndex - 1].id}`
          : undefined;

  return (
    <div className="combobox" ref={rootRef}>
      {selectedLabel && value !== '' && (
        <div
          className="combobox-selection"
          data-testid="selected-manager-display"
          style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}
        >
          <span className="muted">Current manager:</span>
          <strong>{selectedLabel}</strong>
        </div>
      )}
      <div className="combobox-control">
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          disabled={disabled}
          placeholder={selectedLabel ? 'Search to change manager…' : 'Search for a manager…'}
          value={search.query}
          onChange={(event) => {
            search.setQuery(event.target.value);
            setHighlighted(0);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {value !== '' && !disabled && (
          <button
            type="button"
            className="combobox-clear button button-small"
            aria-label="Clear manager"
            onClick={(e) => {
              e.preventDefault();
              clearSelection();
            }}
          >
            Clear
          </button>
        )}
      </div>

      {open && (
        <ul className="combobox-list" id={listId} role="listbox" aria-label="Manager candidates">
          <li
            className={activeIndex === 0 ? 'combobox-option is-active' : 'combobox-option'}
            role="option"
            aria-selected={value === ''}
            id={`${listId}-none`}
            onMouseDown={(event) => {
              event.preventDefault();
              chooseNone();
            }}
            onMouseEnter={() => {
              setHighlighted(0);
            }}
          >
            No manager (org root)
          </li>
          {search.loading && <li className="combobox-option">Searching…</li>}
          {search.error !== null && (
            <li className="combobox-option combobox-error">
              {search.error}{' '}
              <button
                type="button"
                className="button button-small"
                onClick={() => {
                  search.reload();
                  onRetry?.();
                }}
              >
                Retry
              </button>
            </li>
          )}
          {!search.loading && search.error === null && search.query.trim() === '' && (
            <li className="combobox-option combobox-hint">Type a name to search.</li>
          )}
          {!search.loading &&
            search.error === null &&
            search.query.trim() !== '' &&
            candidates.length === 0 && <li className="combobox-option">No match.</li>}
          {candidates.map((employee, index) => {
            const optionIndex = index + 1;
            return (
              <li
                key={employee.id}
                className={
                  optionIndex === activeIndex ? 'combobox-option is-active' : 'combobox-option'
                }
                role="option"
                aria-selected={value === employee.id}
                id={`${listId}-${employee.id}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(employee);
                }}
                onMouseEnter={() => {
                  setHighlighted(optionIndex);
                }}
              >
                {employee.fullName} · {employee.employeeNumber}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
