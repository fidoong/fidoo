export interface CommandDefinition {
  name: string;
  description: string;
}

export const commandDefinitions: CommandDefinition[] = [
  { name: "/new", description: "Start a clean session" },
  { name: "/sessions", description: "Browse and restore saved runs" },
  { name: "/resume ", description: "Restore a run by id" },
  { name: "/trace", description: "Inspect canonical run events" },
  { name: "/theme", description: "Choose and save the interface theme" },
  { name: "/reasoning", description: "Expand or collapse model reasoning" },
  { name: "/help", description: "Show keyboard and command help" },
  { name: "/quit", description: "Close fidoo" },
];

export const paletteDefinitions = commandDefinitions.filter(
  (command) => command.name !== "/resume ",
);
