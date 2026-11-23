#!/usr/bin/env node
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { errorMessage } from "@fidoo/core";
import { createObservabilityServer } from "./server.js";
import { FileObservabilitySource } from "./source.js";

try {
  const { values } = parseArgs({
    options: {
      home: { type: "string", default: process.env.FIDOO_HOME ?? join(homedir(), ".fidoo") },
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "4173" },
    },
    allowPositionals: false,
  });
  const host = values.host as string;
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(host)) {
    throw new Error("Observability server only supports loopback hosts");
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Invalid port");
  }
  const source = new FileObservabilitySource(resolve(values.home as string));
  const server = createObservabilityServer({ source });
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    process.stdout.write(`ƒ fidoo inspect  http://127.0.0.1:${actualPort}\n`);
  });
  process.once("SIGINT", () => server.close(() => process.exit(130)));
  process.once("SIGTERM", () => server.close(() => process.exit(143)));
} catch (error) {
  process.stderr.write(`Error: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}
