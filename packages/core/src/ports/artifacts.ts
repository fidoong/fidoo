export interface Artifact {
  id: string;
  path: string;
  bytes: number;
}

export interface ArtifactStore {
  save(runId: string, name: string, content: string): Promise<Artifact>;
}
