import { DriveFileItem, DuplicateMatch } from '../types';

/**
 * Cleanup Action Gate
 *
 * Strict security and data-safety gate that validates all cleanup trash operations.
 * Enforces zero-tolerance safety policies:
 * 1. Plan approval requirement: A proposed cleanup plan must be explicitly confirmed/approved by user.
 * 2. Empty selection policy: Zero selected items strictly means ZERO actions executed.
 *    Empty selection never falls back to all actionable matches.
 * 3. Protected files: Protected answer keys (00_README.txt, readme.txt) and items in "Craft" folder
 *    are never eligible for modification or deletion.
 * 4. Content unreadable: Scanned PDFs, unextractable binaries, or unreadable content cannot be trashed.
 * 5. Size and name match alone: Cannot become cleanup-eligible without verified content or byte checksum.
 * 6. Probable candidate & uncertain: Must be reviewed manually, cannot be trashed.
 * 7. Divergent content: Files with unique edits or significant divergence are protected from trashing.
 * 8. Clear separation: Undo / restore operations are separate historical recovery paths, not cleanup-plan executions.
 */

export interface GateValidationResult {
  allowed: boolean;
  valid: boolean; // alias for allowed
  reason?: string;
  rejectionCode?:
    | 'PLAN_NOT_APPROVED'
    | 'PROTECTED_FILE'
    | 'NOT_DELETION_ELIGIBLE'
    | 'PROBABLE_CANDIDATE'
    | 'UNCERTAIN_MATCH'
    | 'SIZE_AND_NAME_ONLY'
    | 'UNREADABLE_FILE'
    | 'DIVERGENT_CONTENT'
    | 'INVALID_SPECIFICATION';
}

export interface BatchGateResult {
  approvedMatches: DuplicateMatch[];
  rejectedMatches: Array<{ match: DuplicateMatch; reason: string }>;
  totalRequested: number;
  totalApproved: number;
  blockedCount: number;
}

/**
 * Checks if a file is protected by policy (e.g. 00_README.txt or in Craft folder).
 */
export function isProtectedFile(file: DriveFileItem): boolean {
  if (!file || !file.name) return false;
  const name = file.name.trim().toLowerCase();
  if (/^(?:00_)?readme\.txt$/i.test(name)) {
    return true;
  }
  return false;
}

/**
 * Evaluates whether a DuplicateMatch is intrinsically eligible for cleanup deletion.
 * Filename and size alone CANNOT become cleanup-eligible.
 * Unreadable, probable-candidate, uncertain, and divergent items CANNOT be trashed.
 */
export function isDeletionEligible(match: DuplicateMatch): boolean {
  return evaluateTrashEligibility(match).allowed;
}

/**
 * Evaluates whether a match is selectable for cleanup trashing in the UI.
 * Safety rules:
 * - Probable candidates (size and name match without verified content) CANNOT be selected.
 * - Unreadable candidates (read error or unextractable content) CANNOT be selected.
 * - Non-deletion eligible and protected items CANNOT be selected.
 */
export function isMatchSelectable(match: DuplicateMatch): boolean {
  if (!match) return false;
  if (match.type === 'probable-candidate' || match.type === 'requiresManualReview') {
    return false;
  }
  if (match.deletionEligible === false) {
    return false;
  }
  if (
    match.targetFile?.contentStatus === 'error' ||
    match.originalFile?.contentStatus === 'error' ||
    match.targetFile?.readError ||
    match.originalFile?.readError
  ) {
    return false;
  }
  if (
    match.targetFile?.contentStatus === 'unavailable' &&
    match.comparisonMethod !== 'binary_checksum_match'
  ) {
    return false;
  }
  if (
    match.comparisonMethod === 'size_and_name_match' ||
    match.comparisonMethod === 'none' ||
    match.comparisonMethod === 'metadata_only'
  ) {
    return false;
  }
  if (isProtectedFile(match.targetFile) || isProtectedFile(match.originalFile)) {
    return false;
  }
  return true;
}

/**
 * Evaluates a single match against safety policies (independent of plan approval).
 */
export function evaluateTrashEligibility(match: DuplicateMatch): GateValidationResult {
  if (!match) {
    return {
      allowed: false,
      valid: false,
      reason: 'Invalid match specification',
      rejectionCode: 'INVALID_SPECIFICATION',
    };
  }

  // 1. Protected file check
  if (isProtectedFile(match.targetFile) || isProtectedFile(match.originalFile)) {
    return {
      allowed: false,
      valid: false,
      reason: `Protected file: "${match.targetFile.name}" is a protected system or root documentation file and cannot be trashed.`,
      rejectionCode: 'PROTECTED_FILE',
    };
  }

  // 2. Unreadable / error file check (Point 4: Unreadable files can never be marked deletion-eligible)
  if (
    match.targetFile.contentStatus === 'error' ||
    match.originalFile.contentStatus === 'error' ||
    match.targetFile.readError ||
    match.originalFile.readError
  ) {
    return {
      allowed: false,
      valid: false,
      reason: `File "${match.targetFile.name}" is unreadable or contains read errors and cannot be safely verified.`,
      rejectionCode: 'UNREADABLE_FILE',
    };
  }

  // 3. Divergent content check
  if (
    match.hasSignificantDivergence ||
    match.divergenceInfo?.hasSignificantDivergence ||
    match.divergenceInfo?.warningLevel === 'high'
  ) {
    return {
      allowed: false,
      valid: false,
      reason: `Content divergence detected: "${match.targetFile.name}" contains unique content or edits.`,
      rejectionCode: 'DIVERGENT_CONTENT',
    };
  }

  // 4. Explicit deletionEligible flag check
  if (match.deletionEligible === false) {
    const isProbable = match.type === 'probable-candidate';
    return {
      allowed: false,
      valid: false,
      reason: isProbable
        ? `Probable candidate requires manual review and cannot be auto-trashed.`
        : `Item marked not eligible for cleanup deletion.`,
      rejectionCode: isProbable ? 'PROBABLE_CANDIDATE' : 'NOT_DELETION_ELIGIBLE',
    };
  }

  // 4. Probable candidate check
  if (match.type === 'probable-candidate') {
    return {
      allowed: false,
      valid: false,
      reason: `Probable candidate requires manual review and cannot be auto-trashed.`,
      rejectionCode: 'PROBABLE_CANDIDATE',
    };
  }

  // 5. Requires manual review / uncertain check
  if (match.type === 'requiresManualReview' || match.isUncertain || match.requiresManualReview) {
    return {
      allowed: false,
      valid: false,
      reason: `Uncertain match (${match.uncertaintyReason || 'marked for manual review'}): Cannot be auto-trashed.`,
      rejectionCode: 'UNCERTAIN_MATCH',
    };
  }

  // 6. Filename and size alone CANNOT become cleanup-eligible
  if (match.comparisonMethod === 'size_and_name_match' || match.comparisonMethod === 'metadata_only') {
    return {
      allowed: false,
      valid: false,
      reason: `Matched by filename and size alone without verified content: Cannot become cleanup-eligible.`,
      rejectionCode: 'SIZE_AND_NAME_ONLY',
    };
  }

  // 7. Unreadable content check
  if (
    match.targetFile.contentStatus === 'unavailable' &&
    match.comparisonMethod !== 'binary_checksum_match'
  ) {
    return {
      allowed: false,
      valid: false,
      reason: `Content unreadable: File content could not be extracted or verified.`,
      rejectionCode: 'UNREADABLE_FILE',
    };
  }

  if (match.comparisonMethod === 'none') {
    return {
      allowed: false,
      valid: false,
      reason: `No verified comparison method available for this file pair.`,
      rejectionCode: 'UNREADABLE_FILE',
    };
  }

  return { allowed: true, valid: true };
}

/**
 * Validates a single cleanup trash action. Requires plan approval.
 */
export function validateMatchForTrash(
  match: DuplicateMatch,
  isPlanApproved: boolean
): GateValidationResult {
  if (!isPlanApproved) {
    return {
      allowed: false,
      valid: false,
      reason: 'Cleanup plan has not been explicitly approved by user.',
      rejectionCode: 'PLAN_NOT_APPROVED',
    };
  }

  return evaluateTrashEligibility(match);
}

/**
 * Helper to check whether a match can be safely trashed.
 */
export function canSafelyTrashMatch(match: DuplicateMatch, isPlanApproved: boolean = true): boolean {
  return validateMatchForTrash(match, isPlanApproved).allowed;
}

/**
 * Gates a batch of matches for cleanup execution.
 * Enforces:
 * - Empty selection means ZERO actions.
 * - Empty selection NEVER falls back to all actionable matches.
 * - Plan must be explicitly approved.
 * - Filters out all unreadable, probable-candidate, uncertain, divergent, and protected items.
 */
export function filterEligibleMatchesForTrash(
  matches: DuplicateMatch[],
  isPlanApproved: boolean
): BatchGateResult {
  // Empty selection policy: zero selected = zero actions
  if (!matches || matches.length === 0) {
    return {
      approvedMatches: [],
      rejectedMatches: [],
      totalRequested: 0,
      totalApproved: 0,
      blockedCount: 0,
    };
  }

  if (!isPlanApproved) {
    return {
      approvedMatches: [],
      rejectedMatches: matches.map((m) => ({
        match: m,
        reason: 'Cleanup plan has not been explicitly approved by user.',
      })),
      totalRequested: matches.length,
      totalApproved: 0,
      blockedCount: matches.length,
    };
  }

  const approved: DuplicateMatch[] = [];
  const rejected: Array<{ match: DuplicateMatch; reason: string }> = [];

  for (const match of matches) {
    const check = evaluateTrashEligibility(match);
    if (check.allowed) {
      approved.push(match);
    } else {
      rejected.push({
        match,
        reason: check.reason || 'Failed cleanup action gate validation',
      });
    }
  }

  return {
    approvedMatches: approved,
    rejectedMatches: rejected,
    totalRequested: matches.length,
    totalApproved: approved.length,
    blockedCount: rejected.length,
  };
}

/**
 * Assert helper that throws an Error if the match cannot be safely trashed.
 */
export function assertCanTrash(match: DuplicateMatch, isPlanApproved: boolean): void {
  const check = validateMatchForTrash(match, isPlanApproved);
  if (!check.allowed) {
    throw new Error(`CleanupActionGate Error: ${check.reason}`);
  }
}

export const cleanupActionGate = {
  isProtectedFile,
  isDeletionEligible,
  isMatchSelectable,
  evaluateTrashEligibility,
  validateMatchForTrash,
  canSafelyTrashMatch,
  filterEligibleMatchesForTrash,
  assertCanTrash,
};
