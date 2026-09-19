import { describe, it, expect } from 'vitest';
import {
  evaluateTrashEligibility,
  validateMatchForTrash,
  filterEligibleMatchesForTrash,
  assertCanTrash,
  canSafelyTrashMatch,
  isMatchSelectable,
} from './cleanupActionGate';
import { evaluateAutoSelectMatchIds } from './autoSelectUtils';
import { DriveFileItem, DuplicateMatch, DEFAULT_AUTO_SELECT_PREFERENCES } from '../types';

describe('cleanupActionGate - Strict Safety & Deletion Validation', () => {
  const mockBaseFile: DriveFileItem = {
    id: 'f-orig',
    name: 'Report_Q1_Final.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    modifiedTime: '2025-01-01T10:00:00Z',
    md5Checksum: 'hash123',
    sha256Checksum: 'sha123',
    contentStatus: 'extracted',
  };

  const mockTargetFile: DriveFileItem = {
    id: 'f-dup',
    name: 'Report_Q1_Copy.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    modifiedTime: '2024-12-01T10:00:00Z',
    md5Checksum: 'hash123',
    sha256Checksum: 'sha123',
    contentStatus: 'extracted',
  };

  const validMatch: DuplicateMatch = {
    id: 'm-1',
    originalFile: mockBaseFile,
    targetFile: mockTargetFile,
    type: 'byte-exact',
    confidence: 1.0,
    isUncertain: false,
    reason: 'Verified identical byte checksum',
    similarityScore: 1.0,
    signalUsed: 'sha256_checksum',
    comparisonMethod: 'binary_checksum_match',
    deletionEligible: true,
  };

  it('approves legitimate byte-exact and content-exact duplicate matches when plan is approved', () => {
    const check = evaluateTrashEligibility(validMatch);
    expect(check.allowed).toBe(true);

    const result = validateMatchForTrash(validMatch, true);
    expect(result.valid).toBe(true);
    expect(canSafelyTrashMatch(validMatch, true)).toBe(true);
  });

  it('rejects any action if the cleanup plan was NOT explicitly approved by user', () => {
    const result = validateMatchForTrash(validMatch, false);
    expect(result.valid).toBe(false);
    expect(result.rejectionCode).toBe('PLAN_NOT_APPROVED');

    expect(() => assertCanTrash(validMatch, false)).toThrow(/plan has not been explicitly approved/i);
  });

  it('strictly rejects unreadable files from being deletion-eligible (Point 4)', () => {
    const unreadableMatch: DuplicateMatch = {
      ...validMatch,
      targetFile: {
        ...mockTargetFile,
        contentStatus: 'error',
        readError: 'Corrupt or unreadable file in Drive',
      },
      deletionEligible: true, // even if erroneously marked true upstream
    };

    const check = evaluateTrashEligibility(unreadableMatch);
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/unreadable or contains read errors/i);

    const validation = validateMatchForTrash(unreadableMatch, true);
    expect(validation.valid).toBe(false);
    expect(validation.rejectionCode).toBe('UNREADABLE_FILE');

    expect(() => assertCanTrash(unreadableMatch, true)).toThrow(/unreadable/);
  });

  it('strictly rejects matches where original keeper file is unreadable (Point 4)', () => {
    const unreadableOriginal: DuplicateMatch = {
      ...validMatch,
      originalFile: {
        ...mockBaseFile,
        contentStatus: 'error',
        readError: 'Failed to stream keeper content',
      },
    };

    const check = evaluateTrashEligibility(unreadableOriginal);
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/unreadable or contains read errors/i);
  });

  it('empty selection means strictly zero actions and never falls back (Points 5 & 6)', () => {
    // Calling filterEligibleMatchesForTrash with empty array
    const emptyResult = filterEligibleMatchesForTrash([], true);
    expect(emptyResult.approvedMatches).toHaveLength(0);
    expect(emptyResult.rejectedMatches).toHaveLength(0);
    expect(emptyResult.blockedCount).toBe(0);
  });

  it('rejects probable-candidate matches from deletion eligibility without manual review (Point 9)', () => {
    const candidateMatch: DuplicateMatch = {
      id: 'm-cand',
      originalFile: mockBaseFile,
      targetFile: {
        ...mockTargetFile,
        size: 2048,
        sha256Checksum: undefined,
        md5Checksum: undefined,
      },
      type: 'probable-candidate',
      confidence: 0.8,
      reason: 'Probable candidate: identical size and similar filename without byte or content verification',
      similarityScore: 0.85,
      signalUsed: 'filename_and_size',
      comparisonMethod: 'metadata_only',
      isUncertain: true,
      deletionEligible: false,
      requiresManualReview: true,
    };

    const check = evaluateTrashEligibility(candidateMatch);
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/probable candidate/i);

    const validation = validateMatchForTrash(candidateMatch, true);
    expect(validation.valid).toBe(false);
    expect(validation.rejectionCode).toBe('PROBABLE_CANDIDATE');
  });

  it('rejects matches with significant content divergence or manual review required', () => {
    const divergentMatch: DuplicateMatch = {
      ...validMatch,
      hasSignificantDivergence: true,
      divergenceInfo: {
        hasSignificantDivergence: true,
        uniqueToTargetCount: 50,
        uniqueToOriginalCount: 30,
        divergencePercentage: 45,
        divergenceRatio: 0.45,
        wordCountDelta: 200,
        characterCountDelta: 1200,
        divergentSegmentsPreview: ['Section 4 differs completely'],
        warningLevel: 'high',
        summaryMessage: 'Significant content divergence detected',
      },
      deletionEligible: false,
      requiresManualReview: true,
    };

    const check = evaluateTrashEligibility(divergentMatch);
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/content divergence/i);

    const validation = validateMatchForTrash(divergentMatch, true);
    expect(validation.valid).toBe(false);
    expect(validation.rejectionCode).toBe('DIVERGENT_CONTENT');
  });

  it('protects essential root files such as readme.txt and 00_readme.txt from being trashed', () => {
    const protectedMatch: DuplicateMatch = {
      ...validMatch,
      targetFile: {
        ...mockTargetFile,
        name: 'README.txt',
      },
    };

    const check = evaluateTrashEligibility(protectedMatch);
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/protected system or root documentation file/i);

    const validation = validateMatchForTrash(protectedMatch, true);
    expect(validation.valid).toBe(false);
    expect(validation.rejectionCode).toBe('PROTECTED_FILE');
  });

  it('filters a mixed list of matches cleanly separating approved and rejected items', () => {
    const candidateMatch: DuplicateMatch = {
      id: 'm-cand',
      originalFile: mockBaseFile,
      targetFile: mockTargetFile,
      type: 'probable-candidate',
      confidence: 0.7,
      isUncertain: true,
      reason: 'Probable candidate',
      similarityScore: 0.8,
      signalUsed: 'filename_and_size',
      comparisonMethod: 'metadata_only',
      deletionEligible: false,
    };

    const mixed = [validMatch, candidateMatch];
    const result = filterEligibleMatchesForTrash(mixed, true);

    expect(result.approvedMatches).toHaveLength(1);
    expect(result.approvedMatches[0].id).toBe('m-1');
    expect(result.rejectedMatches).toHaveLength(1);
    expect(result.rejectedMatches[0].match.id).toBe('m-cand');
    expect(result.blockedCount).toBe(1);
  });

  it('an unapproved plan executes zero trash operations', () => {
    const unapprovedBatch = filterEligibleMatchesForTrash([validMatch], false);
    expect(unapprovedBatch.totalApproved).toBe(0);
    expect(unapprovedBatch.approvedMatches).toHaveLength(0);
    expect(unapprovedBatch.rejectedMatches).toHaveLength(1);
    expect(unapprovedBatch.rejectedMatches[0].reason).toMatch(/plan has not been explicitly approved/i);

    const singleCheck = validateMatchForTrash(validMatch, false);
    expect(singleCheck.valid).toBe(false);
    expect(singleCheck.rejectionCode).toBe('PLAN_NOT_APPROVED');
  });

  it('probable-candidate cannot be selected in the UI or by auto-select', () => {
    const probableCandidate: DuplicateMatch = {
      id: 'size-match-p1-p2',
      originalFile: mockBaseFile,
      targetFile: mockTargetFile,
      type: 'probable-candidate',
      confidence: 0.6,
      reason: 'Probable candidate: identical size and near-identical filename alone',
      similarityScore: 1.0,
      signalUsed: 'size_and_name',
      comparisonMethod: 'size_and_name_match',
      isUncertain: true,
      deletionEligible: false,
      requiresManualReview: true,
    };

    expect(isMatchSelectable(probableCandidate)).toBe(false);

    // Auto-select must strictly exclude probable candidates even if autoSelectExact/autoSelectUncertain is enabled
    const autoSelected = evaluateAutoSelectMatchIds([probableCandidate], {
      enabled: true,
      autoSelectExact: true,
      autoSelectUncertain: true,
    });
    expect(autoSelected).not.toContain(probableCandidate.id);
    expect(autoSelected).toHaveLength(0);
  });

  it('unreadable candidate cannot be selected in the UI or by auto-select', () => {
    const unreadableCandidate: DuplicateMatch = {
      id: 'm-unreadable',
      originalFile: mockBaseFile,
      targetFile: {
        ...mockTargetFile,
        contentStatus: 'error',
        readError: 'Corrupted document binary stream',
      },
      type: 'requiresManualReview',
      confidence: 0.5,
      reason: 'Uncertain — Content Not Readable',
      similarityScore: 0,
      signalUsed: 'none',
      comparisonMethod: 'none',
      isUncertain: true,
      deletionEligible: false,
      requiresManualReview: true,
    };

    expect(isMatchSelectable(unreadableCandidate)).toBe(false);

    const autoSelected = evaluateAutoSelectMatchIds([unreadableCandidate], {
      enabled: true,
      autoSelectExact: true,
      autoSelectUncertain: true,
    });
    expect(autoSelected).not.toContain(unreadableCandidate.id);
    expect(autoSelected).toHaveLength(0);
  });

  it('every cleanup trash path uses the gate and assertCanTrash blocks non-approved or invalid files', () => {
    // Attempting to trash when plan is not approved throws an Error
    expect(() => assertCanTrash(validMatch, false)).toThrow(/plan has not been explicitly approved/i);

    // Attempting to trash a protected file throws an Error
    const protectedMatch: DuplicateMatch = {
      ...validMatch,
      targetFile: { ...mockTargetFile, name: '00_README.txt' },
    };
    expect(() => assertCanTrash(protectedMatch, true)).toThrow(/protected system or root documentation file/i);

    // Attempting to trash an unreadable file throws an Error
    const unreadableMatch: DuplicateMatch = {
      ...validMatch,
      targetFile: { ...mockTargetFile, contentStatus: 'error' },
    };
    expect(() => assertCanTrash(unreadableMatch, true)).toThrow(/unreadable or contains read errors/i);
  });

  it('verifies DEFAULT_AUTO_SELECT_PREFERENCES are review-only with all automatic actions disabled', () => {
    expect(DEFAULT_AUTO_SELECT_PREFERENCES.enabled).toBe(false);
    expect(DEFAULT_AUTO_SELECT_PREFERENCES.autoSelectExact).toBe(false);
    expect(DEFAULT_AUTO_SELECT_PREFERENCES.autoSelectDrafts).toBe(false);
    expect(DEFAULT_AUTO_SELECT_PREFERENCES.autoSelectDivergent).toBe(false);
    expect(DEFAULT_AUTO_SELECT_PREFERENCES.autoSelectUncertain).toBe(false);
    expect(DEFAULT_AUTO_SELECT_PREFERENCES.autoApplyOnScan).toBe(false);
    expect(DEFAULT_AUTO_SELECT_PREFERENCES.keeperPreference).toBe('newer');
    expect(DEFAULT_AUTO_SELECT_PREFERENCES.secondaryPreference).toBe('largest');
    expect(DEFAULT_AUTO_SELECT_PREFERENCES.respectContentSignals).toBe(true);

    // With defaults, auto-select returns strictly empty list (review-only)
    const selected = evaluateAutoSelectMatchIds([validMatch], DEFAULT_AUTO_SELECT_PREFERENCES);
    expect(selected).toHaveLength(0);
  });
});
