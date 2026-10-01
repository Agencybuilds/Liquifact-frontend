import { render, screen, fireEvent } from "@testing-library/react";
import InvoiceDetailExport from "./InvoiceDetailExport";
import { exportAsCSV, exportAsJSON } from "@/utils/export";
import { ToastProvider, useToast } from "@/components/ToastProvider";
import { copy } from "@/app/copy/en";

// Mock the export utilities
jest.mock("@/utils/export", () => ({
  exportAsCSV: jest.fn(),
  exportAsJSON: jest.fn(),
}));

// Setup toast spy
const mockToastError = jest.fn();
jest.mock("@/components/ToastProvider", () => {
  return {
    ...jest.requireActual("@/components/ToastProvider"),
    useToast: () => ({
      error: mockToastError,
      success: jest.fn(),
    }),
  };
});

const detail = copy.invest.detail;

describe("InvoiceDetailExport", () => {
  const mockInvoice = {
    id: "inv-123",
    issuer: "Acme Corp",
    amount: 1000,
    currency: "USD",
    dueDate: "2026-10-31",
    yield: 5.5,
    status: "Open",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Spy on console.error to keep test output clean during error tests
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders export buttons", () => {
    render(<InvoiceDetailExport invoice={mockInvoice} />);
    expect(screen.getByRole("button", { name: detail.exportCSVLabel })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: detail.exportJSONLabel })).toBeInTheDocument();
  });

  it("disables buttons when invoice is missing", () => {
    render(<InvoiceDetailExport invoice={null} />);
    expect(screen.getByRole("button", { name: detail.exportCSVLabel })).toBeDisabled();
    expect(screen.getByRole("button", { name: detail.exportJSONLabel })).toBeDisabled();
  });

  it("calls exportAsCSV with correct data on CSV click", () => {
    render(<InvoiceDetailExport invoice={mockInvoice} />);
    fireEvent.click(screen.getByRole("button", { name: detail.exportCSVLabel }));
    
    expect(exportAsCSV).toHaveBeenCalledTimes(1);
    expect(exportAsCSV).toHaveBeenCalledWith(
      [mockInvoice],
      `invoice-${mockInvoice.id}.csv`
    );
  });

  it("calls exportAsJSON with correct data on JSON click", () => {
    render(<InvoiceDetailExport invoice={mockInvoice} />);
    fireEvent.click(screen.getByRole("button", { name: detail.exportJSONLabel }));
    
    expect(exportAsJSON).toHaveBeenCalledTimes(1);
    expect(exportAsJSON).toHaveBeenCalledWith(
      [mockInvoice],
      `invoice-${mockInvoice.id}.json`
    );
  });

  it("handles CSV export failure gracefully", () => {
    exportAsCSV.mockImplementationOnce(() => {
      throw new Error("CSV Export Failed");
    });
    
    render(<InvoiceDetailExport invoice={mockInvoice} />);
    fireEvent.click(screen.getByRole("button", { name: detail.exportCSVLabel }));
    
    expect(console.error).toHaveBeenCalledWith("CSV Export failed:", expect.any(Error));
    expect(mockToastError).toHaveBeenCalledWith(
      detail.exportErrorMsg || "Failed to export CSV. Please try again.",
      detail.exportErrorTitle || "Export Error"
    );
  });

  it("handles JSON export failure gracefully", () => {
    exportAsJSON.mockImplementationOnce(() => {
      throw new Error("JSON Export Failed");
    });
    
    render(<InvoiceDetailExport invoice={mockInvoice} />);
    fireEvent.click(screen.getByRole("button", { name: detail.exportJSONLabel }));
    
    expect(console.error).toHaveBeenCalledWith("JSON Export failed:", expect.any(Error));
    expect(mockToastError).toHaveBeenCalledWith(
      detail.exportErrorMsg || "Failed to export JSON. Please try again.",
      detail.exportErrorTitle || "Export Error"
    );
  });
});
