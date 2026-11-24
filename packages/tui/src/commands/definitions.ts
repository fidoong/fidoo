export interface CommandDefinition {
  name: string;
  description: string;
  usage?: string;
  duringRun?: boolean;
  palette?: boolean;
}

export const commandDefinitions: CommandDefinition[] = [
  { name: "/new", description: "Start a clean session" },
  { name: "/sessions", description: "Browse and restore saved runs" },
  { name: "/trace", description: "Inspect canonical run events", duringRun: true },
  { name: "/theme", description: "Choose and save the interface theme", duringRun: true },
  { name: "/setup", description: "Run the guided model setup" },
  { name: "/settings", description: "Change provider, model, endpoint or API key" },
  {
    name: "/reasoning",
    description: "Expand or collapse model reasoning",
    duringRun: true,
  },
  { name: "/plan", description: "Expand or collapse the task plan", duringRun: true },
  { name: "/output", description: "Open the latest tool output", duringRun: true },
  {
    name: "/status",
    description: "Show run, model, token and verification status",
    duringRun: true,
  },
  { name: "/cancel", description: "Cancel the active run", duringRun: true },
  { name: "/help", description: "Show keyboard and command help", duringRun: true },
  { name: "/quit", description: "Close fidoo" },
  {
    name: "/resume",
    description: "Restore a run by id",
    usage: "/resume <run-id>",
    palette: false,
  },
  {
    name: "/artifact",
    description: "Read a saved artifact by id",
    usage: "/artifact <id>",
    duringRun: true,
    palette: false,
  },
];

export const paletteDefinitions = commandDefinitions.filter((command) => command.palette !== false);

export function commandLabel(command: CommandDefinition): string {
  return command.usage ?? command.name;
}
