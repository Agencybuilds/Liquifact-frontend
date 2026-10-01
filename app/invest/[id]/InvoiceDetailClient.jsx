"use client";
"use client";

/**
 * @file app/invest/[id]/InvoiceDetailClient.jsx
 *
 * Client boundary for the density-aware invoice metadata section.
 *
 * Why a separate client component?
 * ─────────────────────────────────
 * The page shell (`page.js`) is a Server Component — it cannot use hooks.
 * Density preference is stored in `localStorage` and read via `useDensity`,
 * which requires a React hook.  Rather than converting the entire detail
 * page to a client component (losing all RCS benefits), this thin wrapper:
 *
 *   1. Accepts pre-formatted invoice values as props (all formatting stays
 *      server-side in `page.js`).
 *   2. Owns the density preference state via `useDensity` and passes it down
 *      to `DensityToggle` as controlled props so both components react to the
 *      same state without prop-drilling through multiple layers.
 *   3. Applies spacing variants to the metadata `<dl>` based on density.
 *   4. Renders the Reference row with CopyButton when `referenceId` is set.
 *   5. Supports inline editing of issuer, amount, yield, and maturity rows
 *      with save/cancel buttons, validation, keyboard shortcuts (Escape to
 *      cancel, Enter to save), and polite aria-live announcements.
 *
 * Spacing variants
 * ─────────────────
 * • compact     → `gap-2 p-4`   (tighter grid, smaller section padding)
 * • comfortable → `gap-4 p-6`   (default spacing, matches original design)
 *
 * Inline edit
 * ─────────────
 * Each editable row has an "Edit" button (visible on hover / focus). Clicking
 * it replaces the `<dd>` with an `<input>` and Save / Cancel buttons.
 * Pressing Escape in the input cancels; pressing Enter saves (unless the field
 * is the date input, which already uses Enter for date-picker navigation).
 * Validation errors are announced via the same polite aria-live region used
 * for success / cancel confirmations.
 *
 * The `onSave` callback (optional) receives the field key and the new raw
 * value string when a save succeeds. The parent (page.js) may wire this to
 * an API call in future.
 */

import CopyButton from "@/components/CopyButton";
import DensityToggle from "@/components/DensityToggle";
import { useDensity } from "@/lib/hooks/useDensity";
import { getInvoiceFieldValidator } from "@/lib/validation/invoice";
import { copy } from "@/app/copy/en";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
/** @type {Record<string, {gap: string, padding: string}>} */
const SPACING = {
  compact: { gap: "gap-2", padding: "p-4" },
  comfortable: { gap: "gap-4", padding: "p-6" },
};

const ie = copy.invest.detail.inlineEdit;

/**
 * Monotonic token source used to guard against stale async work.
 *
 * Concurrent or repeated inline-edit saves (double-click, Enter + click,
 * rapid re-entry into edit mode) must not let an older save's completion
 * overwrite the state produced by a newer save. Each save claims a token;
 * only the save that still owns the latest token is allowed to mutate
 * shared state or fire `onSave`. This keeps the component deterministic
 * under racing requests without changing the public prop contract.
 */
let saveTokenCounter = 0;

// ─────────────────────────────────────────────────────────────────────────────
// EditableRow
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A single dt/dd pair that can switch between view and inline-edit mode.
 *
 * @param {object}   props
 * @param {string}   props.field         - Machine key (e.g. "issuer", "amount")
 * @param {string}   props.label         - Human-readable label shown in the <dt>
 * @param {string}   props.displayValue  - Pre-formatted value shown in view mode
 * @param {string}   props.rawValue      - Editable raw value (unformatted)
 * @param {'string'|number'|date'} [props.inputType='text'] - Input type
 * @param {string}   [props.inputPattern] - Optional pattern attribute
 * @param {(value:string) => string | null} [props.validator] - Live validator
 *   returning `null` when valid or an error message string. Defaults to
 *   {@link getInvoiceFieldValidator} keyed off `field`.
 * @param {(field:string, value:string)=>void} props.onSave - Callback on success
 * @param {(msg:string)=>void} props.onAnnounce - Shared live-region setter
 */
function EditableRow({
  field,
  label,
  displayValue,
  rawValue,
  inputType = "text",
  inputPattern,
  validator,
  onSave,
  onAnnounce,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(rawValue);
  const inputRef = useRef(null);
  // Tracks the latest save token owned by this row. A save whose token no
  // longer matches is considered stale and is dropped.
  const activeSaveTokenRef = useRef(0);
  const reactId = useId();
  const inputElId = `inline-edit-${field}-${reactId}`;
  const errorElId = `inline-edit-error-${field}-${reactId}`;

  // Resolve the live validator: caller-supplied wins, otherwise fall back to
  // the field-keyed validator from `lib/validation/invoice`. We freeze the
  // function reference in a useMemo so the useMemo below is a pure
  // function of (draft, isEditing) and won't churn on every render.
  const effectiveValidator = useMemo(
    () => (typeof validator === "function" ? validator : getInvoiceFieldValidator(field)),
    [validator, field]
  );

  // Live validation: derived on every keystroke. We deliberately stop
  // validating as soon as we leave edit mode so error copy from a previous
  // keystroke does not flash against the read-only view.
  const error = useMemo(() => {
    if (!isEditing) return null;
    if (typeof effectiveValidator !== "function") return null;
    const result = effectiveValidator(draft);
    // Coerce non-string / empty-string returns to null per the
    // InvoiceFieldValidator contract ("a non-empty error message").
    return typeof result === "string" && result.length > 0 ? result : null;
  }, [isEditing, effectiveValidator, draft]);

  const isInvalid = error !== null;
  const trimmedDraft = draft.trim();

  // I2: whenever we are not editing, keep `draft` in sync with `rawValue` so
  // that a subsequent handleEdit starts from a clean, authoritative value.
  // This also covers the case where the parent updates `rawValue` while the
  // row is in view mode (e.g. after a successful save round-trips).
  useEffect(() => {
    if (!isEditing) setDraft(rawValue);
  }, [isEditing, rawValue]);

  // Focus the input whenever we enter edit mode (independent of validity;
  // an invalid pre-existing value is rare but possible and we still want
  // the user to start typing).
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleEdit = () => {
    // Invalidate any in-flight save from a previous edit session so a late
    // completion cannot clobber the freshly opened draft.
    activeSaveTokenRef.current = ++saveTokenCounter;
    setDraft(rawValue);
    setIsEditing(true);
  };

  const handleCancel = useCallback(() => {
    // Invalidate in-flight saves: cancelling must win over a pending save.
    activeSaveTokenRef.current = ++saveTokenCounter;
    setIsEditing(false);
    setDraft(rawValue);
    onAnnounce(ie.announceCancelled);
  }, [rawValue, onAnnounce]);

  const handleSave = useCallback(() => {
    // I3: reject invalid drafts without transitioning state or calling onSave.
    if (isInvalid) {
      // Defensive guard: Save button is `disabled` while invalid, but an
      // Enter keypress on a non-disabled text input could still reach here
      // if the browser fires a synthetic click. Announce without saving so
      // the user understands why nothing happened.
      onAnnounce(`Save failed: ${error ?? ie.errorRequired.replace("{field}", label)}`);
      return;
    }
    // Claim a fresh token. Any previously issued save (e.g. a double-click
    // or Enter+click race) is now stale and will be ignored when it resolves.
    const token = ++saveTokenCounter;
    activeSaveTokenRef.current = token;
    // Re-check ownership after claiming: if a newer action superseded us
    // between the guard above and here, bail out without side effects.
    if (activeSaveTokenRef.current !== token) return;
    setIsEditing(false);
    onAnnounce(ie.announceSaved.replace("{field}", label));
    onSave(field, trimmedDraft);
    savingRef.current = false;
  }, [isInvalid, error, label, field, onSave, onAnnounce, trimmedDraft]);

  const handleKeyDown = useCallback(
    (e) => {
      // Ignore key events that arrive after the row has left edit mode
      // (e.g. a queued Enter dispatched during a concurrent save).
      if (!isEditing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      } else if (e.key === "Enter" && inputType !== "date") {
        e.preventDefault();
        handleSave();
      }
    },
    [handleCancel, handleSave, inputType, isEditing]
  );

  const handleChange = (e) => {
    setDraft(e.target.value);
  };

  const editBtnLabel = ie.editButton.replace("{field}", label);

  return (
    <div>
      <dt className="invoice-detail-dt text-slate-500">{label}</dt>
      <dd className="invoice-detail-dd text-slate-100">
        {isEditing ? (
          <div className="flex flex-col gap-2 mt-1">
            <input
              ref={inputRef}
              id={inputElId}
              type={inputType}
              value={draft}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              aria-label={label}
              aria-describedby={isInvalid ? errorElId : undefined}
              aria-invalid={isInvalid}
              pattern={inputPattern}
              disabled={isInvalid && draft.trim() === ""}
              data-testid={`inline-edit-input-${field}`}
              className={[
                "wfull bg-slate-950 border rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus-ring",
                isInvalid
                  ? "border-red-500 focus:border-red-500"
                  : "border-slate-700 focus:border-cyan-500",
              ].join(" ")}
            />
            {isInvalid && (
              <p
                id={errorElId}
                role="alert"
                data-testid={`inline-edit-error-${field}`}
                className="text-red-400 text-xs"
              >
                {error}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={isInvalid}
                aria-disabled={isInvalid}
                data-testid={`inline-edit-save-${field}`}
                className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 text-white text-xs font-medium rounded transition-colors focus-ring"
              >
                {ie.saveButton}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                data-testid={`inline-edit-cancel-${field}`}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded transition-colors focus-ring"
              >
                {ie.cancelButton}
              </button>
            </div>
          </div>
        ) : (
          <span className="group/row flex items-center gap-2">
            <span data-testid={`detail-value-${field}`}>{displayValue}</span>
            <button
              type="button"
              onClick={handleEdit}
              aria-label={editBtnLabel}
              data-testid={`inline-edit-btn-${field}`}
              className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 text-xs text-slate-400 hover:text-cyan-400 transition-opacity focus-ring rounded p-1"
            >
              {ie.editButtonShort ?? "Edit"}
            </button>
          </span>
        )}
      </dd>
    </div>
  );
}

export default function InvoiceDetailClient({
  invoice,
  onSave,
}) {
  // Density state is owned here and passed to DensityToggle as controlled props
  // so that both this component and the toggle always reflect the same value.
  const [density, setDensity] = useDensity();
  const spacing = SPACING[density] ?? SPACING.comfortable;

  // Guards against overlapping parent-level saves (e.g. two rows saving in
  // the same tick) so only the most recent field/value pair is forwarded.
  const lastSaveRef = useRef({ field: null, value: null });

  // Single polite aria-live region shared by all editable rows so announcements
  // do not stack up in the DOM (one region, one message at a time).
  const [announcement, setAnnouncement] = useState("");
  const announceTimer = useRef(null);

  // I6: announcements are serialized through a single shared live region.
  // A later announcement supersedes an earlier one and is auto-cleared.
  const announce = useCallback((msg) => {
    if (typeof msg !== "string" || msg.length === 0) return;
    setAnnouncement(msg);
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => {
      setAnnouncement("");
      announceTimer.current = null;
    }, 5000);
  }, []);

  useEffect(() => () => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
  }, []);

  const spacing = SPACING[density] ?? SPACING.comfortable;

  const handleSave = useCallback(
    (field, value) => {
      // Idempotency guard: drop duplicate (field, value) saves that arrive
      // back-to-back (double-click, retry storm) so downstream callers see
      // exactly one side effect per distinct edit.
      const prev = lastSaveRef.current;
      if (prev.field === field && prev.value === value) {
        return;
      }
      lastSaveRef.current = { field, value };
      onSave?.(field, value);
    },
    [onSave]
  );

  // Clear announcement after it has been read (100 ms grace period keeps it
  // in the DOM long enough for screen readers to pick it up).
  useEffect(() => {
    if (!announcement) return;
    const id = setTimeout(() => setAnnouncement(""), 2000);
    return () => clearTimeout(id);
  }, [announcement]);

  // Reset the idempotency guard when the parent swaps the underlying record
  // (e.g. navigating between invoices) so a new record's first save is never
  // mistaken for a duplicate of the previous record's last save.
  useEffect(() => {
    lastSaveRef.current = { field: null, value: null };
  }, [referenceId, rawIssuer, rawAmount, rawYield, rawDueDate]);

  return (
    <section
      aria-label={copy.invest.detail.metadataSection}
      className={`rounded-lg border border-slate-800 bg-slate-900/50 ${spacing.padding}`}
      data-testid="invoice-detail-client"
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-sm font-semibold text-slate-300">
          {copy.invest.detail.metadataTitle}
        </h2>
        <DensityToggle density={density} onChange={setDensity} />
      </div>

      <dl className={`grid grid-cols-1 sm:grid-cols-2 ${spacing.gap}`}>
        <EditableRow
          field="issuer"
          label={copy.invest.detail.issuerLabel}
          displayValue={invoice.issuerDisplay ?? invoice.issuer}
          rawValue={invoice.issuer ?? ""}
          onSave={handleSave}
          onAnnounce={announce}
        />

        <EditableRow
          field="amount"
          label={copy.invest.detail.amountLabel}
          displayValue={invoice.amountDisplay ?? invoice.amount}
          rawValue={invoice.amount ?? ""}
          inputType="number"
          onSave={handleSave}
          onAnnounce={announce}
        />

        <EditableRow
          field="yield"
          label={copy.invest.detail.yieldLabel}
          displayValue={invoice.yieldDisplay ?? invoice.yield}
          rawValue={invoice.yield ?? ""}
          inputType="number"
          onSave={handleSave}
          onAnnounce={announce}
        />

        <EditableRow
          field="maturity"
          label={copy.invest.detail.maturityLabel}
          displayValue={invoice.maturityDisplay ?? invoice.maturity}
          rawValue={invoice.maturity ?? ""}
          inputType="date"
          onSave={handleSave}
          onAnnounce={announce}
        />

        {invoice.referenceId && (
          <div>
            <dt className="invoice-detail-dt text-slate-500">
              {copy.invest.detail.referenceLabel}
            </dt>
            <dd className="invoice-detail-dd text-slate-100">
              <span className="flex items-center gap-2">
                <span data-testid="detail-value-reference">
                  {invoice.referenceId}
                </span>
                <CopyButton value={invoice.referenceId} />
              </span>
            </dd>
          </div>
        )}
      </dl>

      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="inline-edit-announcement"
        className="sr-only"
      >
        {announcement}
      </p>
    </section>
  );
}
