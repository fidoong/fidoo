const layers = [
  {
    number: "01",
    label: "体验层",
    note: "只表达用户意图",
    nodes: [
      { slug: "cli", name: "CLI", detail: "text / json / jsonl" },
      { slug: "tui", name: "TUI", detail: "Ink + React" },
      { slug: "observability-app", name: "Inspector", detail: "只读观测 Web" },
    ],
  },
  {
    number: "02",
    label: "契约层",
    note: "稳定的公共语言",
    nodes: [
      { slug: "client", name: "AgentClient", detail: "SDK + reconnect" },
      { slug: "protocol", name: "Protocol", detail: "DTO + JSON-RPC" },
      { slug: "api", name: "AgentApi", detail: "用例 + 订阅" },
    ],
  },
  {
    number: "03",
    label: "领域层",
    note: "唯一任务事实源",
    nodes: [{ slug: "core", name: "Agent Core", detail: "Loop + State + Policy" }],
  },
  {
    number: "04",
    label: "基础设施层",
    note: "可替换的本地适配器",
    nodes: [
      { slug: "node-runtime", name: "Node Runtime", detail: "Provider + Tools + Store" },
      { slug: "observability", name: "Observability", detail: "Events → Trace" },
    ],
  },
];

export function ArchitectureMap() {
  return (
    <div className="architecture-map">
      <div className="architecture-rail" aria-hidden="true" />
      {layers.map((layer) => (
        <div className="architecture-layer" key={layer.number}>
          <div className="architecture-label">
            <span>{layer.number}</span>
            <div>
              <strong>{layer.label}</strong>
              <small>{layer.note}</small>
            </div>
          </div>
          <div className="architecture-nodes">
            {layer.nodes.map((node) => (
              <a href={`#/packages/${node.slug}`} className="architecture-node" key={node.slug}>
                <span>{node.name}</span>
                <small>{node.detail}</small>
                <span className="node-corner" aria-hidden="true">
                  ↗
                </span>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
