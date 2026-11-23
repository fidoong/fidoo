export interface Artifact {
  id: string;
  path: string;
  bytes: number;
}

export interface ArtifactReference {
  id: string;
  name: string;
  bytes: number;
}

export interface ArtifactPage extends ArtifactReference {
  offset: number;
  limit: number;
  totalLines: number;
  content: string;
  nextOffset?: number;
}

export interface ArtifactStore {
  save(runId: string, name: string, content: string): Promise<Artifact>;
  read(runId: string, id: string, offset: number, limit: number): Promise<ArtifactPage>;
}
