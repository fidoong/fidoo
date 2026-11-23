import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const children = [
  spawn("pnpm", ["dev:server"], { cwd: root, stdio: "inherit" }),
  spawn("pnpm", ["dev:web"], { cwd: root, stdio: "inherit" }),
];
let closing = false;

function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}

for (const child of children) {
  child.once("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    close(1);
  });
  child.once("exit", (code) => {
    if (!closing && code) close(code);
  });
}
process.once("SIGINT", () => close(130));
process.once("SIGTERM", () => close(143));
