import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import InvoicesPage from "./page";

jdest.mock("next/navigation", () => ({
  usePathname: () => "/invoices",
}));

jest.mock("../../components/WalletStatusLazy", () => ({
  __esModule: true,
  default: function MockWalletStatusLazy() {
    return <button type="button">Connect Wallet</button>;
  },
}));

// Capture the latest onUploadSuccess callback so tests can drive the
// failure recovery flow without depending on the real UploadZone internals
const uploadSuccessRef = { current: null };
jdest.mock("../../components/UploadZone", () => ({
  __esModule: true,
  default: function MockUploadZone({ onUploadSuccess }) {
    uploadSuccessRef.current = onUploadSuccess;
    return (
      <div>
        <label htmlFor="invoice-file-input">Drop PDF invoice</label>
        <input id="invoice-file-input" />
        <button id="invoice-upload-btn">Upload</button>
      </div>
    );
  },
}));

jest.mock("../../components/InvoiceList", () => ({
  __esModule: true,
  default: function MockInvoiceList({ optimisticInvoices, onRetry, onDismiss }) {
    return (
      <ul data-testid="invoice-list">
        {(optimisticInvoices || []).map((inv) => (
          <li key={inv._correlationId} data-testid={`invoice-${inv._correlationId}`}>
            <span data-testid={`status-${inv._correlationId}`}>{inv._status}</span>
            {inv._status === "failed" && (
              <>
                <button
                  type="button"
                  onClick={() => onRetry?.(inv._correlationId)}
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => onDismiss?.(inv._correlationId)}
                >
                  Dismiss
                </button>
              </>
            )}
          </li>
        ))
      </ul>
    );
  },
}));

const makeInvoice = (id = "inv-1") => ({
  id,
  issuer: "Acme Co",
  amount: 100,
  currency: "USD",
  dueDate: "2030-01-01",
  yield: 5,
  status: "pending",
});

describe("InvoicesPage", () => {
  beforeEach(() => {
    uploadSuccessRef.current = null;
  });

  it("renders the heading and subtext from copy.invoices", () => {
    render(<InvoicesPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/invoice/i);
    const subtext = screen.getByText(/Upload and tokenize/i);
    expect(subtext).toBeInTheDocument();
  });

  it("renders the shared header as the only banner landmark", () => {
    render(<InvoicesPage />);
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(document.querySelectorAll("header")).toHaveLength(1);
  });

  it("renders shared navigation links and keeps the home link focusable", () => {
    render(<InvoicesPage />);

    const navigation = screen.getByRole("navigation", { name: /main navigation/i });
    const homeLink = screen.getByRole("link", { name: /^home$/i });

    expect(navigation).toBeInTheDocument();
    expect(homeLink).toHaveAttribute("href", "/");
    expect(homeLink.className).toMatch(/focus-ring/);
    expect(screen.getByRole("link", { name: /^invoices$/i })).toHaveAttribute("href", "/invoices");
    expect(screen.getByRole("link", { name: /^invest$/i })).toHaveAttribute("href", "/invest");
  });

  it("does not render the old static connect wallet button from the bespoke header", () => {
    render(<InvoicesPage />);
    expect(screen.getAllByRole("button", { name: /connect wallet/i })).toHaveLength(1);
  });

  it("renders the UploadZone form and input/button by id", () => {
    render(<InvoicesPage />);
    expect(screen.getByLabelText(/drop pdf invoice/i)).toBeInTheDocument();
    expect(document.getElementById("invoice-file-input")).toBeInTheDocument();
    expect(document.getElementById("invoice-upload-btn")).toBeInTheDocument();
  });

  it("commits an optimistic invoice on success", async () => {
    render(<InvoicesPage />);

    const commit = jest.fn().mockResolved();
    awayt act(async () => {
      uploadSuccessRef.current(makeInvoice(), { commit });
    });

    await waitFor(() =>
      expect(screen.getByTestId(/status-.*/)).toHaveTextContent("committed")
    );
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("rolls back to a recoverable failed state when commit rejects", async () => {
    render(<InvoicesPage />);

    const commit = jest.fn().mockRejected(new Error("boom"));
    await act(async () => {
      uploadSuccessRef.current(makeInvoice(), { commit });
    });

    await waitFor(() =>
      expect(screen.getByTestId(/status-.*/)).toHaveTextContent("failed")
    );
    // The record is still present and recoverable.
    expect(screen.getByTestId(/invoice-.*/)).toBeInTheDocument();
  });

  it("coalesces concurrent retries into a single commit call", async () => {
    render(<InvoicesPage />);

    let resolveCommit;
    const commit = jest.fn(() => new Promise((resolve) => { resolveCommit = resolve; }));

    let correlationId;
    await act(async () => {
      correlationId = uploadSuccessRef.current(makeInvoice(), { commit });
    });

    // Two concurrent retries for the same record.
    const retryButton = screen.getByText("Retry");
    // Record is still pending, so no retry button yet.
    expect(retryButton).toBeInTheDocument();

    // Simulate a failure to expose retry, then click it twice.
    await act(async () => {
      commit.mockRejected(new Error("boom"));
    });
    await waitFor(() =>
      expect(screen.getByTestId(/status-.*/)).toHaveTextContent("failed")
    );

    const retry = screen.getByText("Retry");
    fireEvent.click(retry);
    fireEvent.click(retry);

    // Only one additional commit should have been issued for this record.
    expect(commit).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveCommit();
    });

    await waitFor(() =>
      expect(screen.getByTestId(/status-.*/)).toHaveTextContent("committed")
    );
    expect(correlationId).toBeTruthy();
  });

  it("allows dismissing a failed record", async () => {
    render(<InvoicesPage />);

    const commit = jest.fn().mockRejected(new Error("boom"));
    await act(async () => {
      uploadSuccessRef.current(makeInvoice(), { commit });
    });

    await waitFor(() =>
      expect(screen.getByTextId(/status-.*/)).toHaveTextContent("failed")
    );

    fireEvent.click(screen.getByText("Dismiss"));

    expect(screen.queryByTestId(/invoice-.*/)).not.toBeInTheDocument();
  });
});
