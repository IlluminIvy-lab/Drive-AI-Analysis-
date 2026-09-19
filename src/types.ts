export type ContentStatus = 'extracted' | 'unavailable' | 'empty' | 'error';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string | number;
  md5Checksum?: string;
  sha256Checksum?: string;
  parents?: string[];
  content?: string;
  contentHash?: string;
  contentStatus?: ContentStatus;
  readError?: string;
  extractedWordCount?: number;
  trashed?: boolean;
  summaryDescription?: string;
  suggestedFolder?: {
    name: string;
    icon: string;
    reason: string;
    confidence: number;
  };
  suggestedRename?: {
    suggestedName: string;
    reason: string;
  };
}

export type DuplicateType =
  | 'exact'
  | 'near-duplicate'
  | 'unique'
  | 'byte-exact'
  | 'content-exact'
  | 'probable-candidate'
  | 'requiresManualReview';

export type ViewMode = 'grid' | 'list';

export type ScanType = 'exact_only' | 'duplicates_and_drafts';

export type FileTypeFilter = 'all' | 'documents' | 'markdown_text' | 'office' | 'custom';

export interface DriveFolderItem {
  id: string;
  name: string;
  parentId?: string;
  modifiedTime?: string;
}

export interface ScanConfig {
  targetFolder: DriveFolderItem;
  scanType: ScanType;
  fileTypeFilter: FileTypeFilter;
  customExtensions: string[];
}

export interface HistoryActionItem {
  fileId: string;
  fileName: string;
  previousName?: string;
  newName?: string;
  folderName?: string;
}

export interface HistoryAction {
  id: string;
  type: 'trash' | 'restore' | 'rename' | 'bulk_trash' | 'organize_folder' | 'keep_all';
  timestamp: number;
  title: string;
  description: string;
  items: HistoryActionItem[];
  undoAvailableUntil: number; // epoch timestamp ms (expires after 7-10s)
  canUndo: boolean;
  isUndone?: boolean;
}

export interface ContentDivergenceInfo {
  hasSignificantDivergence: boolean;
  uniqueToTargetCount: number;
  uniqueToOriginalCount: number;
  uniqueToTargetLines?: string[];
  uniqueToOriginalLines?: string[];
  divergencePercentage: number;
  divergenceRatio?: number;
  wordCountDelta?: number;
  characterCountDelta?: number;
  divergentSegmentsPreview?: string[];
  warningLevel: 'high' | 'medium' | 'none';
  summaryMessage: string;
}

export interface DuplicateMatch {
  id: string;
  type: DuplicateType;
  confidence: number; // 0 to 1
  reason: string;
  signalUsed?: 'canonical_export' | 'content_hash' | 'content_statement' | 'modified_timestamp' | 'size_and_name' | 'md5_checksum' | 'sha256_checksum' | 'filename_and_size' | 'none';
  signalDetails?: string;
  comparisonMethod?: 'text_similarity' | 'size_and_name_match' | 'binary_checksum_match' | 'metadata_only' | 'none';
  originalFile: DriveFileItem; // The most recently modified or verified newer copy to KEEP
  targetFile: DriveFileItem;   // The older or superseded copy to TRASH
  similarityScore: number;
  isUncertain: boolean;
  uncertaintyReason?: string;
  hasSignificantDivergence?: boolean;
  divergenceInfo?: ContentDivergenceInfo;
  deletionEligible?: boolean;
  requiresManualReview?: boolean;
}

export interface CleanupMetrics {
  totalScanned: number;
  exactDuplicatesCount: number;
  versionDraftsCount: number;
  uncertainCount: number;
  uniqueKeptCount: number;
  totalBytesReviewed?: number;
  totalBytesReclaimed: number;
  duplicationRate: number; // 0 - 100 percentage
  avgSimilarity: number;   // 0 - 100 percentage
  scanDurationMs: number;
  scanSpeedFilesPerSec: number;
}

export interface CleanupReport {
  timestamp: string;
  folderName: string;
  isProposedReport?: boolean;
  totalFilesReviewed: number;
  totalExactDuplicates: number;
  totalVersionDrafts: number;
  totalTrashed: number;
  totalUniqueKept: number;
  scanDurationMs?: number;
  metrics?: CleanupMetrics;
  cleanupInsight?: string;
  isLoadingInsight?: boolean;
  trashedFiles: Array<{
    trashedFile: DriveFileItem;
    keptOriginalFile: DriveFileItem;
    type: DuplicateType;
    reason: string;
    signalUsed?: 'canonical_export' | 'content_hash' | 'content_statement' | 'modified_timestamp' | 'size_and_name' | 'md5_checksum' | 'sha256_checksum' | 'filename_and_size' | 'none';
    comparisonMethod?: 'text_similarity' | 'size_and_name_match' | 'binary_checksum_match' | 'metadata_only' | 'none';
    similarity: number;
    trashedSuccess: boolean;
    isProposed?: boolean;
    error?: string;
  }>;
  uncertainFiles: Array<{
    fileA: DriveFileItem;
    fileB: DriveFileItem;
    reason: string;
    similarity: number;
    comparisonMethod?: 'text_similarity' | 'size_and_name_match' | 'binary_checksum_match' | 'metadata_only' | 'none';
  }>;
  keptFiles: DriveFileItem[];
}

export type ScanStage = 
  | 'idle'
  | 'locating_folder'
  | 'fetching_files'
  | 'reading_contents'
  | 'analyzing_duplicates'
  | 'ready_for_review'
  | 'smart_review'
  | 'trashing'
  | 'completed'
  | 'error';

export type KeeperPreference = 'newer' | 'older' | 'largest' | 'smallest' | 'cleanest_name';

export interface AutoSelectPreferences {
  enabled: boolean; // Master toggle: true = auto-select duplicates for cleanup; false = OFF (manual selection only)
  keeperPreference: KeeperPreference;
  secondaryPreference: KeeperPreference;
  respectContentSignals: boolean; // if true, explicit v2/v1 or "final" in content takes precedence
  autoSelectExact: boolean; // Auto-select 100% exact / checksum duplicates
  autoSelectDrafts: boolean; // Auto-select near-duplicate drafts
  autoSelectDivergent: boolean; // Auto-select divergent files with unique edits (default false for safety)
  minSimilarityThreshold: number; // 0.5 to 1.0 (e.g. 0.75)
  autoSelectUncertain: boolean; // Auto-select uncertain matches (default false for safety)
  autoApplyOnScan: boolean; // Automatically apply upon scan completion
}

export const DEFAULT_AUTO_SELECT_PREFERENCES: AutoSelectPreferences = {
  enabled: false,
  keeperPreference: 'newer',
  secondaryPreference: 'largest',
  respectContentSignals: true,
  autoSelectExact: false,
  autoSelectDrafts: false,
  autoSelectDivergent: false,
  minSimilarityThreshold: 0.75,
  autoSelectUncertain: false,
  autoApplyOnScan: false,
};
