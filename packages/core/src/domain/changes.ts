export type WorkspaceChangeStatus = "added" | "modified" | "deleted";

export interface WorkspaceFileChange {
  path: string;
  status: WorkspaceChangeStatus;
  beforeRevision?: string;
  currentRevision?: string;
  addedLines: number;
  deletedLines: number;
  diff: string;
  canUndo: boolean;
}

export interface WorkspaceChangeSummary {
  files: number;
  addedLines: number;
  deletedLines: number;
  changes: WorkspaceFileChange[];
}
