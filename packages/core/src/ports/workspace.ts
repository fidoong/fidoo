export interface WorkspacePort {
  assertDirectory(cwd: string): Promise<string>;
}
