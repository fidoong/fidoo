import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { AgentError, defineTool, type ImageReference } from "@fidoo/core";
import { z } from "zod";
import { assertNotSensitive, relativePath, resolveExistingPath } from "../system/workspace.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const readImageTool = defineTool({
  name: "read_image",
  description:
    "Read a PNG, JPEG, WebP or GIF image for a vision-capable model. The image is stored as an Artifact reference and hydrated only for the model request, not embedded in the event log.",
  inputSchema: z.object({ path: z.string().min(1) }),
  effect: "read",
  risk: "low",
  concurrency: "safe",
  idempotency: "always",
  execute: async (input, context) => {
    const path = await resolveExistingPath(context.cwd, input.path);
    assertNotSensitive(path);
    const metadata = await stat(path);
    if (!metadata.isFile()) throw new AgentError("Not a file", "tool");
    if (metadata.size > MAX_IMAGE_BYTES) {
      throw new AgentError("Image exceeds the 5 MiB limit", "budget");
    }
    const bytes = await readFile(path);
    const mimeType = imageMime(bytes);
    if (!mimeType) {
      throw new AgentError("Unsupported image content; use PNG, JPEG, WebP or GIF", "tool");
    }
    const name = relativePath(context.cwd, path);
    const encoded = bytes.toString("base64");
    const artifact = await context.artifacts.save(
      context.runId,
      `${basename(name)}.base64.txt`,
      encoded,
    );
    const image: ImageReference = {
      artifactId: artifact.id,
      mimeType,
      name,
      bytes: bytes.length,
    };
    return {
      summary: `Read image ${name} (${bytes.length} bytes)`,
      content: JSON.stringify({
        path: name,
        mimeType,
        bytes: bytes.length,
        artifactId: artifact.id,
      }),
      artifacts: [{ id: artifact.id, name: basename(name), bytes: artifact.bytes }],
      images: [image],
    };
  },
});

function imageMime(bytes: Buffer): ImageReference["mimeType"] | undefined {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}
