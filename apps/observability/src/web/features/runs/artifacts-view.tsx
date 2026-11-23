import type { RunProjection } from "@fidoo/observability";
import type { ArtifactReference } from "@fidoo/protocol";
import { useState } from "react";
import { EmptyState, Icon } from "../../components/ui.js";
import { type ArtifactPage, getArtifact } from "../../lib/api.js";

export function ArtifactsView({ run }: { run: RunProjection }) {
  const [selected, setSelected] = useState<ArtifactReference>();
  const [page, setPage] = useState<ArtifactPage>();
  const load = async (artifact: ArtifactReference, offset = 0) => {
    setSelected(artifact);
    setPage(await getArtifact(run.runId, artifact.id, offset));
  };
  if (run.artifacts.length === 0) {
    return (
      <EmptyState
        title="No artifacts"
        detail="Large tool outputs will appear here with paginated access."
      />
    );
  }
  return (
    <div className="artifacts-workspace">
      <section className="artifact-list">
        <div className="section-heading">
          <span>ARTIFACTS</span>
          <span>{run.artifacts.length} files</span>
        </div>
        {run.artifacts.map((artifact) => (
          <button
            type="button"
            key={artifact.id}
            className={selected?.id === artifact.id ? "selected" : ""}
            onClick={() => void load(artifact)}
          >
            <Icon name="terminal" />
            <span>
              <strong>{artifact.name}</strong>
              <small>
                {artifact.id.slice(0, 12)} · {artifact.bytes} bytes
              </small>
            </span>
            <Icon name="arrow" />
          </button>
        ))}
      </section>
      <aside className="artifact-viewer">
        <div className="section-heading">
          <span>{page?.name ?? "OUTPUT VIEWER"}</span>
          {page ? (
            <span>
              {page.offset + 1}–{Math.min(page.offset + 300, page.totalLines)} / {page.totalLines}
            </span>
          ) : null}
        </div>
        <pre>{page?.content ?? "Select an artifact to read its redacted output."}</pre>
        {page?.nextOffset !== undefined && selected ? (
          <button
            type="button"
            className="load-more"
            onClick={() => void load(selected, page.nextOffset)}
          >
            Next page
          </button>
        ) : null}
      </aside>
    </div>
  );
}
