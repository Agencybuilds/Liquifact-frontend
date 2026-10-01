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
 * State-transition invariants owned by EditableRow / InvoiceDetailClient:
 *
 *  I1. A row is in exactly one of two states: `view` or `edit`. Transitions
 *      are: view → edit (handleEdit), edit → view (handleSave / handleCancel).
 *      There is no direct edit → edit transition; re-entering edit always
 *      resets `draft` from the current `rawValue` (I2).
 *  I2. While in `edit`, `draft` is the single source of truth for the input
 *      and for validation. On entering edit, `draft` MUST equal `rawValue`.
 *  I3. A save is only committed when the current `draft` passes the effective
 *      validator. Invalid drafts MUST NOT call `onSave` and MUST NOT leave
 *      edit mode (the user can correct or cancel).
 *  I4. `onSave` is invoked at most once per successful save, with the trimmed
 *      draft value, and only after the row has transitioned back to `view`.
 *  I5. Cancel is idempotent w.r.t. state: it always restores `draft` to
 *      `rawValue` and returns to `view`, regardless of prior draft contents.
 *  I6. Announcements are serialized through a single shared live region; a
 *      later announcement supersedes an earlier one and is auto-cleared.
 *
 * These invariants are enforced by the guards below and covered by the
 * focused tests in __tests__/InvoiceDetailClient.test.jsx.
 */

// ─────────────────────────────────────────────────────────────────────────────
// State invariants
// ─────────────────────────────────────────────────────────────────────────────
//
// The inline-edit state machine in this module owns the following invariants.
// They must hold for every render, every event handler, and every async
// boundary (including StrictMode double-invocation and concurrent renders):
//
//   I1. Draft isolation: while `isEditing === false`, `draft` is never
//       observable in the UI. The view-mode `<dd>` renders `displayValue`
//       only. This prevents a stale draft from leaking into the read-only
//       view after a cancel or a parent-driven prop change.
//
//   I2. Commit atomicity: a successful save transitions `isEditing` from
//       true → false and invokes `onSave(field, trimmedDraft)` exactly once.
//       A rejected save (invalid draft) leaves `isEditing === true` and
//       `draft` unchanged, and never invokes `onSave`.
//
//   I3. Idempotent cancel: `handleCancel` is safe to call from any state.
//       It resets `draft` to the current `rawValue` and forces
//       `isEditing === false`. Repeated cancels are no-ops.
//
//   I4. Validator purity: the effective validator is a pure function of
//       `(field, draft)` and never mutates component state. Validation
//       errors are derived, never stored.
//
//   I5. Announcement liveness: at most one announcement is pending at a
//       time. A new announcement replaces the previous one and resets the
//       auto-clear timer, so screen readers never observe interleaved
//       messages.
//
//   I6. Prop-change safety: when `rawValue` changes while not editing, the
//       next `handleEdit` seeds `draft` from the new `rawValue`. When
//       `rawValue` changes while editing, the in-flight draft is preserved
//       (the user's input is authoritative until they cancel or save).
//
//   I7. Unmount safety: the announcement auto-clear timer is cleared on
//       unmount and on every announcement change, so no `setState` fires
//       after unmount.
//
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
  const savingRef = useRef(false);
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
    // I2: entering edit always resets draft from the authoritative rawValue.
    setDraft(rawValue);
    setIsEditing(true);
  };

  const handleCancel = useCallback(() => {
    // I5: cancel is idempotent — always restore draft and return to view.
    savingRef.current = false;
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
    // I4: guard against re-entrant saves (e.g. rapid Enter + click) so the
    // callback fires at most once per successful transition.
    if (savingRef.current) return;
    savingRef.current = true;
    setIsEditing(false);
    onAnnounce(ie.announceSaved.replace("{field}", label));
    onSave(field, trimmedDraft);
    savingRef.current = false;
  }, [isInvalid, error, label, field, onSave, onAnnounce, trimmedDraft]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      } else if (e.key === "Enter" && inputType !== "date") {
        e.preventDefault();
        handleSave();
      }
    },
    [handleCancel, handleSave, inputType]
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
  const { density, setDensity } = useDensity();
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
      if (typeof onSave === "function") {
        onSave(field, value);
      }
    },
    [onSave]
  );

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
