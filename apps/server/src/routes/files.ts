import { schema } from "@synapse/db";
import { loadFiles, MAX_FILE_BYTES, metaOf, saveFile } from "@synapse/tools";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { type AppEnv, apiError } from "../http";

/** Types a browser may show inline. Everything else downloads, so nothing uploaded runs as a page. */
const INLINE =
  /^(image\/(png|jpe?g|gif|webp|avif|heic|heif)|video\/(mp4|webm|quicktime|ogg)|audio\/(mpeg|mp4|ogg|wav|webm|aac)|application\/pdf)$/;

/** Files attached in chat: any type up to 25 MB, private to their owner. */
export const files = new Hono<AppEnv>()
  .post("/", async (c) => {
    const form = await c.req
      .formData()
      .catch(() => apiError(400, "invalid_form", "Expected multipart form data."));
    const file = form.get("file");
    if (!(file instanceof File))
      apiError(422, "missing_file", "Attach a file in the `file` field.");
    if (file.size === 0) apiError(422, "empty_file", "That file is empty.");
    if (file.size > MAX_FILE_BYTES)
      apiError(413, "too_large", "Files up to 25 MB are supported, Gmail's limit for one email.");
    const { toolset } = c.var.services;
    const saved = await saveFile(toolset.db, toolset.embedder, {
      userId: c.var.user.id,
      name: file.name.slice(0, 200) || "file",
      mimeType: file.type,
      data: new Uint8Array(await file.arrayBuffer()),
    });
    return c.json({ file: saved }, 201);
  })
  .get("/:id", async (c) => {
    const [row] = await loadFiles(c.var.services.toolset.db, c.var.user.id, [c.req.param("id")]);
    if (!row) apiError(404, "not_found", "File not found.");
    return c.json({ file: metaOf(row) });
  })
  .get("/:id/content", async (c) => {
    const [row] = await loadFiles(c.var.services.toolset.db, c.var.user.id, [c.req.param("id")]);
    if (!row) apiError(404, "not_found", "File not found.");
    const inline = INLINE.test(row.mimeType);
    const name = encodeURIComponent(row.name);
    return c.body(Buffer.from(row.data), 200, {
      "content-type": inline ? row.mimeType : "application/octet-stream",
      "content-length": String(row.bytes),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
      "cache-control": "private, max-age=3600",
    });
  })
  .delete("/:id", async (c) => {
    const [row] = await c.var.services.toolset.db
      .delete(schema.files)
      .where(and(eq(schema.files.id, c.req.param("id")), eq(schema.files.userId, c.var.user.id)))
      .returning({ id: schema.files.id });
    if (!row) apiError(404, "not_found", "File not found.");
    return c.body(null, 204);
  });
