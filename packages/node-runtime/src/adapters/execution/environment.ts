const DEFAULT_ENVIRONMENT = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TZ",
  "CI",
  "NODE_ENV",
  "NO_COLOR",
] as const;

const WINDOWS_ENVIRONMENT = ["SystemRoot", "WINDIR", "ComSpec", "PATHEXT"] as const;

export function isolatedEnvironment(options: {
  base?: NodeJS.ProcessEnv;
  allow?: readonly string[];
  set?: Record<string, string>;
  home: string;
  temporaryDirectory: string;
  platform?: NodeJS.Platform;
}): NodeJS.ProcessEnv {
  const base = options.base ?? process.env;
  const platform = options.platform ?? process.platform;
  const allowed = new Set([
    ...DEFAULT_ENVIRONMENT,
    ...(platform === "win32" ? WINDOWS_ENVIRONMENT : []),
    ...(options.allow ?? []),
  ]);
  const env: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    const value = environmentValue(base, name, platform);
    if (value !== undefined) env[name] = value;
  }
  if (!env.PATH) {
    const systemRoot = env.SystemRoot ?? "C:\\Windows";
    env.PATH =
      platform === "win32"
        ? `${systemRoot}\\System32;${systemRoot}`
        : "/usr/local/bin:/usr/bin:/bin";
  }
  for (const [name, value] of Object.entries(options.set ?? {})) {
    env[name] = value;
  }
  env.HOME = options.home;
  env.TMPDIR = options.temporaryDirectory;
  if (platform === "win32") {
    env.USERPROFILE = options.home;
    env.TMP = options.temporaryDirectory;
    env.TEMP = options.temporaryDirectory;
  }
  return env;
}

function environmentValue(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}
