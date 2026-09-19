import { describe, it, expect, vi } from 'vitest';
import {
  isProtectedKeyFile,
  getReportFilename,
  exportReportToCsv,
  exportReportToMarkdown,
  exportReportToPlainText,
} from './exportReport';
import { CleanupReport } from '../types';

describe('exportReport - Report Generation & Formatting', () => {
  const mockReport: CleanupReport = {
    timestamp: '2025-01-15T12:00:00.000Z',
    folderName: 'Important Project Folder',
    totalFilesReviewed: 10,
    totalExactDuplicates: 2,
    totalVersionDrafts: 1,
    totalTrashed: 3,
    totalUniqueKept: 6,
    scanDurationMs: 450,
    metrics: {
      totalScanned: 10,
      exactDuplicatesCount: 2,
      versionDraftsCount: 1,
      uncertainCount: 1,
      uniqueKeptCount: 6,
      totalBytesReviewed: 1048576,
      totalBytesReclaimed: 524288,
      duplicationRate: 30,
      avgSimilarity: 98,
      scanDurationMs: 450,
      scanSpeedFilesPerSec: 22,
    },
    trashedFiles: [
      {
        trashedFile: {
          id: 'file-1-trash',
          name: 'Budget_2025_copy.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: 262144,
          modifiedTime: '2025-01-01T10:00:00.000Z',
          contentStatus: 'extracted',
        },
        keptOriginalFile: {
          id: 'file-1-orig',
          name: 'Budget_2025.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: 262144,
          modifiedTime: '2025-01-02T10:00:00.000Z',
          contentStatus: 'extracted',
        },
        type: 'exact',
        reason: 'Byte-exact binary match',
        signalUsed: 'sha256_checksum',
        similarity: 1.0,
        comparisonMethod: 'binary_checksum_match',
        trashedSuccess: true,
      },
    ],
    uncertainFiles: [
      {
        fileA: {
          id: 'file-unc-a',
          name: 'Notes_Draft.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 50000,
          modifiedTime: '2025-01-01T08:00:00.000Z',
          contentStatus: 'extracted',
        },
        fileB: {
          id: 'file-unc-b',
          name: 'Notes_v2.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 50000,
          modifiedTime: '2025-01-02T08:00:00.000Z',
          contentStatus: 'extracted',
        },
        reason: 'Significant content divergence detected (ratio 0.4)',
        similarity: 0.75,
        comparisonMethod: 'text_similarity',
      },
    ],
    keptFiles: [
      {
        id: 'file-kept-1',
        name: 'Architecture_Plan.pdf',
        mimeType: 'application/pdf',
        size: 500000,
        modifiedTime: '2025-01-10T15:00:00.000Z',
        contentStatus: 'extracted',
      },
    ],
  };

  it('correctly detects protected key documentation files', () => {
    expect(isProtectedKeyFile('readme.txt')).toBe(true);
    expect(isProtectedKeyFile('README.TXT')).toBe(true);
    expect(isProtectedKeyFile('00_readme.txt')).toBe(true);
    expect(isProtectedKeyFile('00_README.TXT')).toBe(true);
    expect(isProtectedKeyFile('  readme.txt  ')).toBe(true);

    expect(isProtectedKeyFile('my_readme.txt')).toBe(false);
    expect(isProtectedKeyFile('readme.docx')).toBe(false);
    expect(isProtectedKeyFile('project_notes.txt')).toBe(false);
    expect(isProtectedKeyFile('')).toBe(false);
    expect(isProtectedKeyFile(undefined)).toBe(false);
  });

  it('generates sanitized and informative report filenames for each format', () => {
    const csvName = getReportFilename(mockReport, 'csv');
    expect(csvName).toMatch(/^drive_cleanup_summary_important_project_folder_\d{4}-\d{2}-\d{2}\.csv$/);

    const mdName = getReportFilename(mockReport, 'markdown');
    expect(mdName).toMatch(/^drive_cleanup_summary_important_project_folder_\d{4}-\d{2}-\d{2}\.md$/);

    const txtName = getReportFilename(mockReport, 'text');
    expect(txtName).toMatch(/^drive_cleanup_summary_important_project_folder_\d{4}-\d{2}-\d{2}\.txt$/);

    const proposedReport: CleanupReport = {
      ...mockReport,
      isProposedReport: true,
    };
    const proposedCsvName = getReportFilename(proposedReport, 'csv');
    expect(proposedCsvName).toContain('proposed_plan');
  });

  it('handles CSV, Markdown, and PlainText report triggers without throwing', () => {
    // Mock URL and document methods in node/vitest environment
    const createObjectURLSpy = vi.fn().mockReturnValue('blob:dummy');
    const revokeObjectURLSpy = vi.fn();
    (globalThis as any).URL.createObjectURL = createObjectURLSpy;
    (globalThis as any).URL.revokeObjectURL = revokeObjectURLSpy;

    const mockAnchor = {
      href: '',
      setAttribute: vi.fn(),
      click: vi.fn(),
    };
    const mockDoc = {
      createElement: vi.fn().mockReturnValue(mockAnchor),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    };
    (globalThis as any).document = mockDoc;

    expect(() => exportReportToCsv(mockReport)).not.toThrow();
    expect(() => exportReportToMarkdown(mockReport)).not.toThrow();
    expect(() => exportReportToPlainText(mockReport)).not.toThrow();

    expect(mockAnchor.click).toHaveBeenCalled();
  });

  it('safely handles null, undefined, and invalid dates without throwing', () => {
    const brokenReport: CleanupReport = {
      timestamp: 'invalid-date-string',
      folderName: 'Corrupt Folder',
      totalFilesReviewed: 1,
      totalExactDuplicates: 0,
      totalVersionDrafts: 0,
      totalTrashed: 0,
      totalUniqueKept: 1,
      scanDurationMs: 0,
      trashedFiles: [
        {
          trashedFile: {
            id: 'file-bad-date',
            name: '=CMD|calc!A0', // formula injection attempt
            mimeType: 'text/plain',
            size: undefined as any,
            modifiedTime: 'not-a-date',
            contentStatus: 'unavailable',
          },
          keptOriginalFile: undefined as any,
          type: 'exact',
          reason: 'Testing bad dates, commas, and "quotes"\nand newlines',
          signalUsed: 'size_and_name',
          similarity: 1.0,
          trashedSuccess: false,
        },
      ],
      uncertainFiles: [],
      keptFiles: [
        {
          id: 'file-nulls',
          name: '+12345_Formula_Name.txt',
          mimeType: 'text/plain',
          size: null as any,
          modifiedTime: '',
          contentStatus: 'empty',
        },
      ],
    };

    expect(() => exportReportToCsv(brokenReport)).not.toThrow();
    expect(() => exportReportToMarkdown(brokenReport)).not.toThrow();
    expect(() => exportReportToPlainText(brokenReport)).not.toThrow();
  });
});
