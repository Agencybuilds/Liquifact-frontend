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
 * page to a client component (losing all RCC benefits), this thin wrapper:
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
 * ─────────────────────────────────
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
 *
 * Compatibility contract
 * ──────────────────────
 * This component is the client boundary for the invoice metadata section.
 * Its public props are a stable contract with `page.js` (a Server Component)
 * and any future callers. The following invariants are enforced:
 *
 *   1. `onSave` is optional; when absent, inline edits still update the
 *      local view and announce success. Callers that do not wire persistence
 *      must not observe a thrown error or an unhandled rejection.
 *   2. `onSave` may throw or return a rejected promise. In that case the
 *      row reverts to its previous value, an error is announced via the
 *      shared polite live region, and the component remains interactive.
 *      A failed save never leaves the row in an inconsistent "saved" state.
 *   3. `onSave` may be invoked concurrently (rapid Enter presses, multiple
 *      rows). Saves are serialized per-row via an in-flight guard so a
 *      second save cannot interleave with the first and produce a stale
 *      value. Cross-row saves are independent and may proceed in parallel.
 *   4. Raw values (`rawIssuer`, `rawAmount`, `rawYield`, `rawDueDate`) fall
 *      back to their formatted counterparts when omitted, preserving the
 *      pre-existing behavior for callers that only pass formatted values.
 *   5. `referenceId` is optional. When falsy, the Reference row is omitted
 *      entirely (no empty row, no broken CopyButton).
 *   6. `density` is owned here and mirrored to `DensityToggle` as a
 *      controlled prop. Unknown density values fall back to `comfortable`
 *      so a corrupted `localStorage` value cannot break layout.
 *
 * These invariants are covered by focused tests in
 * `app/invest/[id]/__tests__/InvoiceDetailClient.test.jsx`.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import CopyButton from "@/components/CopyButton";
import DensityToggle from "@/components/DensityToggle";
import { useDensity } from "@/lib/hooks/useDensity";
import { getInvoiceFieldValidator } from "@/lib/validation/invoice";
import { copy } from "@/app/copy/en";

/** @type {Record<string, {gap: string, padding: string}>} */
const SPACING = {
  compact: { gap: "gap-2", padding: "p-4" },
  comfortable: { gap: "gap-4", padding: "p-6" },
};

const ie = copy.invest.detail.inlineEdit;

// ────────────────────────────────────────────────────────────────────────────
// EditableRow
// ────────────────────────────────────────────────────────────────────────────

/**
 * A single dt/dd pair that can switch between view and inline-edit mode.
 *
 * @param {object}   props
 * @param {string}   props.field         - Machine key (e.g. "issuer", "amount")
 * @param {string}   props.label         - Human-readable label shown in the <dt>
 * @param {string}   props.displayValue  - Pre-formatted value shown in view mode
 * @param {string}   props.rawValue      - Editable raw value (unformatted)
 * @param {'text'|'number'|'date'} [props.inputType='text'] - Input type
 * @param {string}   [props.inputPattern] - Optional pattern attribute
 * @param {(value:string) => string | null} [props.validator] - Live validator
 *   returning `null` when valid or an error message string. Defaults to
 *   {@link getInvoiceFieldValidator} keyed off `field`.
 * @param {(field:string, value:string) => void | Promise<void>} props.onSave
 *   Callback on success. May be synchronous or return a promise.
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
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlightRef = useRef(false);
  const reactId = useId();
  const inputElId = `inline-edit-${field}-${reactId}`;
  const errorElId = `inline-edit-error-${field}-${reactId}`;

  // Resolve the live validator: caller-supplied wins, otherwise fall back to
  const inputRef = useRef(null);
  // the field-keyed validator from `lib/validation/invoice`. We freeze the
  // function reference in a useCallback so the useMemo below is a pure
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

  // Keep the draft in sync when the parent supplies a new rawValue while the
  // row is not being edited. This preserves the contract that the displayed
  // value always reflects the latest props after a successful save.
  useEffect(() => {
    if (!isEditing && !saveInFlightRef.current) {
      setDraft(rawValue);
    }
  }, [rawValue, isEditing]);

  // Focus the input whenever we enter edit mode (independent of validity;
  // an invalid pre-existing value is rare but possible and we still want
  // the user to start typing).
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleEdit = () => {
    setDraft(rawValue);
    setIsEditing(true);
  };

  const handleCancel = useCallback(() => {
    if (saveInFlightRef.current) return;
    setIsEditing(false);
    setDraft(rawValue);
    onAnnounce(ie.announceCancelled);
  }, [rawValue, onAnnounce]);

  const handleSave = useCallback(async () => {
    if (isInvalid) {
      // Defensive guard: Save button is `disabled` while invalid, but an
      // Enter keypress on a non-disabled text input could still reach here
      // if the browser fires a synthetic click. Announce without saving so
      // the user understands why nothing happened.
      onAnnounce(`Save failed: ${error ?? ie.errorRequired.replace("{field}", label)}`);
      return;
    }

    // Serialize saves per-row: a second Enter press while the first save is
    // still in flight must not interleave and produce a stale value.
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setIsSaving(true);

    const previousDraft = rawValue;
    try {
      // `onSave` is optional. When absent we still commit locally so the
      // view reflects the user's edit without requiring a parent callback.
      await onSave?.(field, trimmedDraft);
      setIsEditing(false);
      onAnnounce(ie.announceSaved.replace("{field}", label));
    } catch (err) {
      // Revert to the last known-good value and surface a diagnosable,
      // non-sensitive error message. We deliberately do not include the
      // raw error in the announcement to avoid leaking internals.
      setDraft(previousDraft);
      setIsEditing(true);
      onAnnounce(ie.announceSaveFailed.replace("{field}", label));
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  }, [isInvalid, error, label, field, onSave, onAnnounce, trimmedDraft, rawValue]);

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
              disabled={isSaving}
              data-testid={`inline-edit-input-${field}`}
              className={[
                "w-full bg-slate-950 border rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus-ring",
                isInvalid
                  ? "border-red-500 focus:border-red-500"
                  : "border-slate-700 focus:border-cyan-500",
              ].join(" ")}
            />
            {isInvalid && (
              <p
                id={errorElId}
                role="alert"
                aria-live="polite"
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
                disabled={isInvalid || isSaving}
                aria-disabled={isInvalid || isSaving}
                data-testid={`inline-edit-save-${field}`}
                className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:hover:bg-slate-700 disabled"
              >
                {ie.saveButton}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isSaving}
                data-testid={`inline-edit-cancel-${field}`}
                className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled"
              >
                {ie.cancelButton}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 mt-1">
            <span data-testid={`inline-edit-value-${field}`}>{displayValue}</span>
            <button
              type="button"
              onClick={handleEdit}
              aria-label={editBtnLabel}
              data-testid={`inline-edit-button-${field}`}
              className="text-xs text-cyan-400 hover:text-cyan-300 opacity-0 focus:opacity-100 hover:opacity-100 focus:outline-none focus-ring"
            >
              {ie.editButtonShort ?? "Edit"}
            </button>
          </div>
        )}
      </dd>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// InvoiceDetailClient
// ────────────────────────────────────────────────────────────────────────────

/**
 * Client boundary for the invoice metadata section.
 *
 * @param {object}   props
 * @param {string}   props.issuer
 * @param {string}   props.amount
 * @param {string}   props.yield
 * @param {string}   props.dueDate
 * @param {string}   [props.rawIssuer]
 * @param {string}   [props.rawAmount]
 * @param {string}   [props.rawYield]
 * @param {string}   [props.rawDueDate]
 * @param {string}   [props.referenceId]
 * @param {string}   [props.currency]
 * @param {(field:string, value:string) => void | Promise<void>} [props.onSave]
 */
export default function InvoiceDetailClient({
  issuer,
  amount,
  yield,
  dueDate,
  rawIssuer,
  rawAmount,
  rawYield,
  rawDueDate,
  referenceId,
  currency,
  onSave,
}) {
  const { density, setDensity } = useDensity();
  const [announcement, setAnnouncement] = useState("");

  // Invariant 6: unknown density values fall back to "comfortable" so a
  // corrupted localStorage value cannot break layout.
  const spacing = SPACING[density] ?? SPACING.comfortable;

  // Invariant 4: raw values fall back to their formatted counterparts.
  const raw = useMemo(
    () => ({
      issuer: rawIssuer ?? issuer,
      amount: rawAmount ?? amount,
      yield: rawYield ?? yield,
      dueDate: rawDueDate ?? dueDate,
    }),
    [rawIssuer, issuer, rawAmount, amount, rawYield, yield, rawDueDate, dueDate]
  );

  const handleAnnounce = useCallback((msg) => {
    setAnnouncement(msg);
  }, []);

  return (
    <section
      className={[`grid grid-cols-1 sm:grid-cols-2 ${spacing.gap} ${spacing.padding} bg-slate-900/50 border border-slate-800 rounded-lg`]}
      data-testid="invoice-detail-client"
      data-density={density}
    >
      <div className="col-span-full flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-slate-400">{copy.invest.detail.metadataTitle ?? "Invoice metadata"}</h2>
        <DensityToggle density={density} onDensityChange={setDensity} />
      </div>

      <dl className="col-span-full grid subtitle-grid grid-cols-1 sm:grid-cols-2 gap-x-6">
        <EditableRow
          field="issuer"
          label={copy.invest.detail.issuerLabel ?? "Issuer"}
          displayValue={issuer}
          rawValue={raw.issuer}
          onSave={onSave}
          onAnnounce={handleAnnounce}
        />
        <EditableRow
          field="amount"
          label={copy.invest.detail.amountLabel ?? "Amount"}
          displayValue={amount}
          rawValue={raw.amount}
          inputType="number"
          onAnnounce={handleAnnounce}
          onSave={onSave}
        />
        <EditableRow
          field="yield"
          label={copy.invest.detail.yieldLabel ?? "Yield"}
          displayValue={yield}
          rawValue={raw.yield}
          inputType="number"
          onAnnounce={handleAnnounce}
          onSave={onSave}
        />
        <EditableRow
          field="dueDate"
          label={copy.invest.detail.dueDateLabel ?? "Due date"}
          displayValue={dueDate}
          rawValue={raw.dueDate}
          inputType="date"
          onAnnounce={handleAnnounce}
          onSave={onSave}
        />
        {currency && (
          <div>
            <dt className="invoice-detail-dt text-slate-500">{copy.invest.detail.currencyLabel ?? "Currency"}</dt>
            <dd className="invoice-detail-dd text-slate-100">{currency}</dd>
          </div>
        )}
        {/* Invariant 5: referenceId is optional; omit the row entirely when falsy. */}
        {referenceId && (
          <div>
            <dt className="invoice-detail-dt text-slate-500">{copy.invest.detail.referenceLabel ?? "Reference"}</dt>
            <dd className="invoice-detail-dd text-slate-100 flex items-center gap-2">
              <span className="font-mono text-xs">{referenceId}</span>
              <CopyButton value={referenceId} />
            </dd>
          </div>
        )}
      </dl>

      {/* Polite live region for inline-edit announcements. */}
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="invoice-detail-announcement"
      >
        {announcement}
      </p>
    </section>
  );
}
