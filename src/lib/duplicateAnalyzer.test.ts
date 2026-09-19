import { describe, it, expect } from 'vitest';
import { analyzeDuplicates, areFileTypesCompatible } from './duplicateAnalyzer';
import { DriveFileItem } from '../types';

describe('duplicateAnalyzer Regression & Safety Test Suite', () => {
  const cat2Original: DriveFileItem = {
    id: 'cat2-orig-id',
    name: 'cat2_status_banner_original.png',
    mimeType: 'image/png',
    size: 15420,
    md5Checksum: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    contentHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    contentStatus: 'unavailable',
    modifiedTime: '2024-01-10T12:00:00Z',
  };

  const cat2Copy: DriveFileItem = {
    id: 'cat2-copy-id',
    name: 'cat2_status_banner_copy.png',
    mimeType: 'image/png',
    size: 15420,
    md5Checksum: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    contentHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    contentStatus: 'unavailable',
    modifiedTime: '2024-01-11T14:00:00Z',
  };

  const cat4NearDuplicateBanner: DriveFileItem = {
    id: 'cat4-banner-id',
    name: 'cat4_near_duplicate_banner_a.png',
    mimeType: 'image/png',
    size: 16800,
    md5Checksum: '9999c3d4e5f60718293a4b5c6d7e9999',
    contentHash: '9999c3d4e5f60718293a4b5c6d7e9999',
    contentStatus: 'unavailable',
    modifiedTime: '2024-02-01T10:00:00Z',
  };

  it('matches byte-identical binary files and keeps near-duplicates separate', () => {
    const result = analyzeDuplicates([cat2Original, cat2Copy, cat4NearDuplicateBanner]);

    expect(result.actionableMatches).toHaveLength(1);
    const match = result.actionableMatches[0];
    expect(match.type === 'exact' || match.type === 'byte-exact').toBe(true);
    expect(match.originalFile.id).toBe(cat2Original.id);
    expect(match.targetFile.id).toBe(cat2Copy.id);

    expect(result.actionableMatches.some(m => m.targetFile.id === cat4NearDuplicateBanner.id)).toBe(false);
    expect(result.uniqueFiles.map(f => f.id)).toContain(cat4NearDuplicateBanner.id);
  });

  it('resolves drafts and revised finals via content statement overriding timestamps', () => {
    const cat3Draft: DriveFileItem = {
      id: 'cat3-draft-id',
      name: 'cat3_client_update_early_draft.pdf',
      mimeType: 'application/pdf',
      size: 45000,
      contentStatus: 'extracted',
      content: `ACME Corp Quarterly Client Update
Status: Early Working Draft - Preliminary review only.
Summary: In Q3, client deliverables were reviewed across departments.`,
      extractedWordCount: 35,
      modifiedTime: '2024-03-01T12:00:00Z',
    };

    const cat3Final: DriveFileItem = {
      id: 'cat3-final-id',
      name: 'cat3_client_update_revised_final.pdf',
      mimeType: 'application/pdf',
      size: 48000,
      contentStatus: 'extracted',
      content: `ACME Corp Quarterly Client Update
Status: Revised Final Approved Version.
This document supersedes all earlier drafts including early draft.
Summary: In Q3, client deliverables were completed across departments.`,
      extractedWordCount: 42,
      modifiedTime: '2024-02-28T10:00:00Z',
    };

    const result = analyzeDuplicates([cat3Draft, cat3Final]);
    expect(result.actionableMatches).toHaveLength(1);
    const match = result.actionableMatches[0];
    expect(match.originalFile.id).toBe(cat3Final.id);
    expect(match.targetFile.id).toBe(cat3Draft.id);
    expect(match.signalUsed).toBe('content_statement');
    expect(match.isUncertain).toBeFalsy();
  });

  it('prevents pairing unrelated file types (PDF vs PNG)', () => {
    const museumNote: DriveFileItem = {
      id: 'museum-id',
      name: 'cat7_unique_museum_note.pdf',
      mimeType: 'application/pdf',
      size: 12000,
      contentStatus: 'unavailable',
      modifiedTime: '2024-04-10T11:00:00Z',
    };

    const starImage: DriveFileItem = {
      id: 'star-id',
      name: 'cat7_unique_star.png',
      mimeType: 'image/png',
      size: 8500,
      contentStatus: 'unavailable',
      modifiedTime: '2024-04-10T11:02:00Z',
    };

    expect(areFileTypesCompatible(museumNote, starImage)).toBe(false);

    const result = analyzeDuplicates([museumNote, starImage]);
    expect(result.actionableMatches).toHaveLength(0);
    expect(result.uncertainMatches).toHaveLength(0);
    expect(result.uniqueFiles).toHaveLength(2);
  });

  it('protects root documentation files like 00_README.txt from matching or trashing', () => {
    const readmeFile: DriveFileItem = {
      id: 'readme-id',
      name: '00_README.txt',
      mimeType: 'text/plain',
      size: 200,
      content: 'This is the protected answer key file.',
      contentStatus: 'extracted',
      modifiedTime: '2024-01-01T00:00:00Z',
    };

    const result = analyzeDuplicates([readmeFile, cat2Original, cat2Copy]);
    expect(result.actionableMatches.some(m => m.originalFile.id === readmeFile.id || m.targetFile.id === readmeFile.id)).toBe(false);
    expect(result.uncertainMatches.some(m => m.originalFile.id === readmeFile.id || m.targetFile.id === readmeFile.id)).toBe(false);
  });

  it('classifies Google Docs exports as content-exact with canonical_export, never byte-exact or byte/hash-identical', () => {
    const gDocOriginal: DriveFileItem = {
      id: 'gdoc-1',
      name: 'Meeting Notes.gdoc',
      mimeType: 'application/vnd.google-apps.document',
      size: 1024,
      contentStatus: 'extracted',
      content: 'Meeting notes from Monday morning standup.',
      modifiedTime: '2025-01-02T10:00:00Z',
    };

    const gDocCopy: DriveFileItem = {
      id: 'gdoc-2',
      name: 'Meeting Notes Copy.gdoc',
      mimeType: 'application/vnd.google-apps.document',
      size: 1024,
      contentStatus: 'extracted',
      content: 'Meeting notes from Monday morning standup.',
      modifiedTime: '2025-01-01T10:00:00Z',
    };

    const result = analyzeDuplicates([gDocOriginal, gDocCopy]);
    expect(result.actionableMatches).toHaveLength(1);
    const match = result.actionableMatches[0];

    // Must NOT be classified as byte-exact
    expect(match.type).not.toBe('byte-exact');
    expect(match.type).toBe('content-exact');
    expect(match.signalUsed).toBe('canonical_export');
    expect(match.comparisonMethod).toBe('text_similarity');

    // Must NOT say byte/hash-identical
    expect(match.reason).not.toContain('byte/hash-identical');
    expect(match.reason).not.toContain('byte-exact');
    expect(match.reason).toContain('Content-exact duplicate Google Workspace document verified by canonical export text');
  });

  it('accurately describes MD5-only matches without claiming SHA-256 verification (Point 2)', () => {
    const md5FileA: DriveFileItem = {
      id: 'md5-1',
      name: 'Asset_A.bin',
      mimeType: 'application/octet-stream',
      size: 5000,
      md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
      sha256Checksum: undefined, // no SHA-256
      contentStatus: 'unavailable',
      modifiedTime: '2025-01-01T10:00:00Z',
    };

    const md5FileB: DriveFileItem = {
      id: 'md5-2',
      name: 'Asset_A_copy.bin',
      mimeType: 'application/octet-stream',
      size: 5000,
      md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
      sha256Checksum: undefined, // no SHA-256
      contentStatus: 'unavailable',
      modifiedTime: '2025-01-02T10:00:00Z',
    };

    const result = analyzeDuplicates([md5FileA, md5FileB]);
    expect(result.actionableMatches).toHaveLength(1);
    const match = result.actionableMatches[0];

    expect(match.signalUsed).toBe('md5_checksum');
    expect(match.reason).toContain('MD5 checksum verified');
    expect(match.reason).not.toContain('SHA-256 verified');
  });

  it('classifies size-only matches with similar names as probable candidates ineligible for deletion (Point 3 & 9)', () => {
    const sizeMatchA: DriveFileItem = {
      id: 'sz-1',
      name: 'Project_Alpha_Spec.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 12345,
      contentStatus: 'unavailable',
      modifiedTime: '2025-01-01T10:00:00Z',
    };

    const sizeMatchB: DriveFileItem = {
      id: 'sz-2',
      name: 'Project_Alpha_Specification.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 12345,
      contentStatus: 'unavailable',
      modifiedTime: '2025-01-02T10:00:00Z',
    };

    const result = analyzeDuplicates([sizeMatchA, sizeMatchB]);
    if (result.actionableMatches.length > 0) {
      const match = result.actionableMatches[0];
      expect(match.type === 'probable-candidate' || match.type === 'near-duplicate').toBe(true);
      expect(match.deletionEligible).toBe(false);
      expect(match.requiresManualReview).toBe(true);
    }
  });

  it('keeps divergent client files (e.g. Priya onboarding vs Plain onboarding) out of trash proposals', () => {
    const plainOnboarding: DriveFileItem = {
      id: 'file-05',
      name: '05_Client-Onboarding-Plain.txt',
      mimeType: 'text/plain',
      size: 1500,
      content: `Standard Client Onboarding Guide
1. Create account
2. Verify domain
3. Set up SSO integration
General template for all clients.`,
      contentStatus: 'extracted',
      extractedWordCount: 22,
      modifiedTime: '2025-01-01T12:00:00Z',
    };

    const priyaOnboarding: DriveFileItem = {
      id: 'file-12',
      name: '12_Client-Onboarding-Priya.md',
      mimeType: 'text/markdown',
      size: 1800,
      content: `Client Onboarding: Priya Patel
1. Create account (Custom tier)
2. Verify domain (acme.priya.io)
3. Custom security audit and compliance setup.
Client-specific notes and requirements.`,
      contentStatus: 'extracted',
      extractedWordCount: 25,
      modifiedTime: '2025-01-05T15:00:00Z',
    };

    const result = analyzeDuplicates([plainOnboarding, priyaOnboarding]);

    // Neither file should ever be proposed for trash in actionableMatches!
    expect(result.actionableMatches.some(m => m.targetFile.id === priyaOnboarding.id)).toBe(false);
    expect(result.actionableMatches.some(m => m.targetFile.id === plainOnboarding.id)).toBe(false);

    // If matched due to similarity, it must be flagged as uncertain (manual review)
    if (result.uncertainMatches.length > 0) {
      const u = result.uncertainMatches[0];
      expect(u.isUncertain).toBe(true);
      expect(u.requiresManualReview).toBe(true);
      expect(u.deletionEligible).toBe(false);
    }
  });

  it('keeps weekly marketing updates without explicit superseding statements out of trash', () => {
    const weeklyMarketing: DriveFileItem = {
      id: 'file-14',
      name: '14_Weekly-Update-Marketing.md',
      mimeType: 'text/markdown',
      size: 2100,
      content: `# Weekly Marketing Update - Week 14
Key metrics:
- Lead volume up 12%
- Campaign A CTR: 3.4%
- Campaign B spend: $4,200`,
      contentStatus: 'extracted',
      extractedWordCount: 28,
      modifiedTime: '2025-01-14T10:00:00Z',
    };

    const weeklyGeneral: DriveFileItem = {
      id: 'file-10',
      name: '10_Weekly-Update-Company.md',
      mimeType: 'text/markdown',
      size: 2300,
      content: `# Company Weekly Update - Week 14
Highlights:
- Engineering shipped v2.1
- Marketing reports lead volume up 12%
- Sales closed 4 enterprise deals`,
      contentStatus: 'extracted',
      extractedWordCount: 32,
      modifiedTime: '2025-01-14T10:04:00Z',
    };

    const result = analyzeDuplicates([weeklyMarketing, weeklyGeneral]);

    // Neither file should be proposed for trash
    expect(result.actionableMatches.some(m => m.targetFile.id === weeklyMarketing.id)).toBe(false);
    expect(result.actionableMatches.some(m => m.targetFile.id === weeklyGeneral.id)).toBe(false);
  });

  it('enforces that total files reviewed reconciles with trash, uncertain, and unique counts', () => {
    const fileA: DriveFileItem = {
      id: 'a',
      name: 'Doc_A.txt',
      mimeType: 'text/plain',
      size: 100,
      content: 'Exact identical text',
      contentStatus: 'extracted',
      modifiedTime: '2025-01-01T10:00:00Z',
    };
    const fileB: DriveFileItem = {
      id: 'b',
      name: 'Doc_A_copy.txt',
      mimeType: 'text/plain',
      size: 100,
      content: 'Exact identical text',
      contentStatus: 'extracted',
      modifiedTime: '2025-01-01T10:01:00Z',
    };
    const fileC: DriveFileItem = {
      id: 'c',
      name: 'Draft_Proposal.txt',
      mimeType: 'text/plain',
      size: 300,
      content: 'Proposal draft with some notes and initial outline.',
      contentStatus: 'extracted',
      modifiedTime: '2025-01-02T10:00:00Z',
    };
    const fileD: DriveFileItem = {
      id: 'd',
      name: 'Draft_Proposal_Revised.txt',
      mimeType: 'text/plain',
      size: 350,
      content: 'Proposal draft revised with additional notes and budget.',
      contentStatus: 'extracted',
      modifiedTime: '2025-01-03T10:00:00Z',
    };
    const fileE: DriveFileItem = {
      id: 'e',
      name: 'Completely_Unique_Doc.txt',
      mimeType: 'text/plain',
      size: 500,
      content: 'Completely unique and independent content for the archives.',
      contentStatus: 'extracted',
      modifiedTime: '2025-01-04T10:00:00Z',
    };

    const allFiles = [fileA, fileB, fileC, fileD, fileE];
    const result = analyzeDuplicates(allFiles);

    // 1. Check mutual exclusivity: no file in actionableMatches targetFile is in uncertain or unique
    const actionableTargetIds = new Set(result.actionableMatches.map(m => m.targetFile.id));
    const uncertainTargetIds = new Set(result.uncertainMatches.map(m => m.targetFile.id));
    const uniqueIds = new Set(result.uniqueFiles.map(f => f.id));

    // Intersection of actionable and uncertain should be empty
    for (const id of actionableTargetIds) {
      expect(uncertainTargetIds.has(id)).toBe(false);
      expect(uniqueIds.has(id)).toBe(false);
    }

    // Intersection of uncertain and unique should be empty
    for (const id of uncertainTargetIds) {
      expect(uniqueIds.has(id)).toBe(false);
    }

    // 2. All actionableMatches must be strictly deletion-eligible and NOT uncertain
    for (const m of result.actionableMatches) {
      expect(m.deletionEligible).toBe(true);
      expect(m.isUncertain).toBe(false);
      expect(m.requiresManualReview).toBe(false);
      expect(m.signalUsed).not.toBe('none');
    }

    // 3. All uncertainMatches must be marked uncertain / manual review and NOT deletion eligible
    for (const u of result.uncertainMatches) {
      expect(u.isUncertain).toBe(true);
      expect(u.requiresManualReview).toBe(true);
      expect(u.deletionEligible).toBe(false);
    }

    // 4. Exact sum reconciliation: total reviewed = actionable + uncertain + unique
    const totalPartitioned = actionableTargetIds.size + uncertainTargetIds.size + uniqueIds.size;
    expect(totalPartitioned).toBe(allFiles.length);
  });
});
