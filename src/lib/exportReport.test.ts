import { describe, it, expect, vi } from 'vitest';
import {
  isProtectedKeyFile,
  getReportFilename,
  exportReportToCsv,
  exportReportToMarkdown,
  exportReportToPlainText,
  generateMarkdownReport,
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

  it('strictly reconciles counts and ensures mutual exclusivity across categories in Markdown report', () => {
    // Simulate a case with 16 total files:
    // e.g. 4 proposed for trash, 3 uncertain, 9 unique/kept -> 4 + 3 + 9 = 16
    const reportWithPotentials: CleanupReport = {
      timestamp: '2025-01-15T12:00:00.000Z',
      folderName: 'TEST',
      isProposedReport: true,
      totalFilesReviewed: 16,
      totalExactDuplicates: 4,
      totalVersionDrafts: 0,
      totalTrashed: 0,
      totalUniqueKept: 9,
      trashedFiles: [
        {
          trashedFile: {
            id: 'f1',
            name: '01_Doc_Copy.md',
            mimeType: 'text/markdown',
            size: 1000,
            modifiedTime: '2025-01-01T10:00:00Z',
          },
          keptOriginalFile: {
            id: 'f2',
            name: '01_Doc.md',
            mimeType: 'text/markdown',
            size: 1000,
            modifiedTime: '2025-01-02T10:00:00Z',
          },
          type: 'exact',
          reason: 'Exact byte-identical file. SHA-256 verified.',
          signalUsed: 'sha256_checksum',
          similarity: 1.0,
          isProposed: true,
          trashedSuccess: false,
        },
      ],
      uncertainFiles: [
        {
          fileA: {
            id: 'f3',
            name: '05_Client-Onboarding-Plain.txt',
            mimeType: 'text/plain',
            size: 1200,
            modifiedTime: '2025-01-03T10:00:00Z',
          },
          fileB: {
            id: 'f4',
            name: '12_Client-Onboarding-Priya.md',
            mimeType: 'text/markdown',
            size: 1400,
            modifiedTime: '2025-01-04T10:00:00Z',
          },
          reason: 'Client-specific divergence detected. Requires manual review.',
          similarity: 0.72,
          comparisonMethod: 'text_similarity',
        },
        {
          fileA: {
            id: 'f5',
            name: '10_Weekly-Update-Company.md',
            mimeType: 'text/markdown',
            size: 2000,
            modifiedTime: '2025-01-10T10:00:00Z',
          },
          fileB: {
            id: 'f6',
            name: '14_Weekly-Update-Marketing.md',
            mimeType: 'text/markdown',
            size: 1900,
            modifiedTime: '2025-01-10T10:02:00Z',
          },
          reason: 'Marketing-specific metrics divergence. Signal used: None.',
          similarity: 0.78,
          comparisonMethod: 'text_similarity',
        },
      ],
      keptFiles: [
        {
          id: 'f2', // The kept original
          name: '01_Doc.md',
          mimeType: 'text/markdown',
          size: 1000,
          modifiedTime: '2025-01-02T10:00:00Z',
        },
        {
          id: 'f3',
          name: '05_Client-Onboarding-Plain.txt',
          mimeType: 'text/plain',
          size: 1200,
          modifiedTime: '2025-01-03T10:00:00Z',
        },
        {
          id: 'f5',
          name: '10_Weekly-Update-Company.md',
          mimeType: 'text/markdown',
          size: 2000,
          modifiedTime: '2025-01-10T10:00:00Z',
        },
        {
          id: 'f7',
          name: 'Unique_Analysis.pdf',
          mimeType: 'application/pdf',
          size: 50000,
          modifiedTime: '2025-01-12T10:00:00Z',
        },
      ],
    };

    const md = generateMarkdownReport(reportWithPotentials);

    // 1. Check that uncertain files do NOT appear as [PROPOSED FOR TRASH]
    expect(md).not.toContain('[PROPOSED FOR TRASH] 12_Client-Onboarding-Priya.md');
    expect(md).not.toContain('[PROPOSED FOR TRASH] 05_Client-Onboarding-Plain.txt');
    expect(md).not.toContain('[PROPOSED FOR TRASH] 14_Weekly-Update-Marketing.md');

    // 2. Check that uncertain files appear under [KEPT SAFE]
    expect(md).toContain('`[KEPT SAFE]` 12_Client-Onboarding-Priya.md');
    expect(md).toContain('`[KEPT SAFE]` 14_Weekly-Update-Marketing.md');

    // 3. Check mutual exclusivity: f4 and f6 must NOT appear in Retained Unique table
    // because they are in the Uncertain section
    const uniqueSectionStart = md.indexOf('Retained Unique & Primary Files');
    const uniqueSection = md.slice(uniqueSectionStart);
    expect(uniqueSection).not.toContain('12_Client-Onboarding-Priya.md');
    expect(uniqueSection).not.toContain('14_Weekly-Update-Marketing.md');

    // 4. Proposed trash file f1 must not appear in unique section
    expect(uniqueSection).not.toContain('01_Doc_Copy.md');
  });
});
