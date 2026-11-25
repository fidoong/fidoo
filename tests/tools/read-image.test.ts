import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readImageTool } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { assistant, call } from "../helpers/fake-model.js";
import { testRuntime } from "../helpers/runtime.js";
import { executeTool } from "../helpers/tool.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("read_image", () => {
  it("validates image content and saves an Artifact-backed reference", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "read-image-"));
    directories.push(cwd);
    await writeFile(join(cwd, "pixel.png"), png);
    const result = await executeTool(readImageTool, { path: "pixel.png" }, { cwd });
    expect(result.images).toMatchObject([
      { mimeType: "image/png", name: "pixel.png", bytes: png.length },
    ]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.content).not.toContain(png.toString("base64"));
  });

  it("hydrates image data into the next model request", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "read-image-"));
    directories.push(cwd);
    await writeFile(join(cwd, "pixel.png"), png);
    const { service, model } = testRuntime([
      assistant("Inspecting", [call("image", "read_image", { path: "pixel.png" })]),
      assistant("The image is a pixel"),
    ]);
    const state = await service.start("Inspect the image", cwd, new AbortController().signal);
    expect(state.status).toBe("completed");
    const toolMessage = model.requests[1]?.messages.find((message) => message.role === "tool");
    expect(toolMessage).toMatchObject({
      role: "tool",
      images: [
        {
          mimeType: "image/png",
          data: png.toString("base64"),
        },
      ],
    });
  });

  it("rejects text renamed as an image", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "read-image-"));
    directories.push(cwd);
    await writeFile(join(cwd, "fake.png"), "not an image");
    await expect(executeTool(readImageTool, { path: "fake.png" }, { cwd })).rejects.toThrow(
      "Unsupported image content",
    );
  });
});
