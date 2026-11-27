import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import {
  createGhostAdminToken,
  getGhostConfig,
  isSupportedGhostImageMimeType,
  resolveImageFileInfo,
  uploadImageToGhost,
} from "./ghost.ts";

function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

Deno.test("createGhostAdminToken generates valid Ghost HS256 JWT", async () => {
  const id = "64b1f2c3d4e5f6a7b8c9d0e1";
  const secretHex =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const now = 1700000000;

  const token = await createGhostAdminToken(`${id}:${secretHex}`, now);
  const parts = token.split(".");
  assertEquals(parts.length, 3);

  const decoder = new TextDecoder();
  const header = JSON.parse(decoder.decode(base64UrlDecode(parts[0])));
  const payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1])));

  assertEquals(header, { alg: "HS256", typ: "JWT", kid: id });
  assertEquals(payload, { iat: now, exp: now + 300, aud: "/admin/" });

  const secretBuffer = new ArrayBuffer(secretHex.length / 2);
  const secretBytes = new Uint8Array(secretBuffer);
  for (let i = 0; i < secretHex.length; i += 2) {
    secretBytes[i / 2] = parseInt(secretHex.slice(i, i + 2), 16);
  }

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  assertEquals(valid, true);
});

Deno.test("createGhostAdminToken rejects malformed API keys", async () => {
  await assertRejects(() => createGhostAdminToken("no-colon"));
  await assertRejects(() => createGhostAdminToken(":abcd"));
  await assertRejects(() => createGhostAdminToken("id:abc"));
  await assertRejects(() => createGhostAdminToken("id:zzzz"));
});

Deno.test("uploadImageToGhost uploads multipart form data and returns URL", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  const mockFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(
      JSON.stringify({
        images: [
          {
            url: "https://blog.example.com/content/images/2026/11/post.jpg",
            ref: "42-@tginfo",
          },
        ],
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };

  const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const url = await uploadImageToGhost(
    {
      url: "https://blog.example.com///",
      adminApiKey:
        "64b1f2c3d4e5f6a7b8c9d0e1:0123456789abcdef0123456789abcdef",
    },
    {
      data: imageBytes,
      filename: "post.jpg",
      mimeType: "image/jpeg",
      ref: "42-@tginfo",
    },
    mockFetch,
  );

  assertEquals(
    url,
    "https://blog.example.com/content/images/2026/11/post.jpg",
  );
  assertEquals(
    capturedUrl,
    "https://blog.example.com/ghost/api/admin/images/upload/",
  );
  assertEquals(capturedInit?.method, "POST");

  const headers = new Headers(capturedInit?.headers);
  assertMatch(headers.get("Authorization") ?? "", /^Ghost [^.]+\.[^.]+\.[^.]+$/);
  assertEquals(headers.get("Accept-Version"), "v5.0");

  const formData = capturedInit?.body as FormData;
  assertEquals(formData.get("purpose"), "image");
  assertEquals(formData.get("ref"), "42-@tginfo");

  const uploadedFile = formData.get("file") as File;
  assertEquals(uploadedFile.name, "post.jpg");
  assertEquals(uploadedFile.type, "image/jpeg");
  assertEquals(new Uint8Array(await uploadedFile.arrayBuffer()), imageBytes);
});

Deno.test("uploadImageToGhost throws on error response or missing URL", async () => {
  const failFetch: typeof fetch = () =>
    Promise.resolve(new Response("Unauthorized", { status: 401 }));

  await assertRejects(
    () =>
      uploadImageToGhost(
        { url: "https://blog.example.com", adminApiKey: "abc:0123456789abcdef" },
        { data: new Uint8Array([1, 2]), filename: "a.png", mimeType: "image/png" },
        failFetch,
      ),
    Error,
    "401",
  );

  const emptyFetch: typeof fetch = () =>
    Promise.resolve(new Response(JSON.stringify({ images: [] }), { status: 200 }));

  await assertRejects(
    () =>
      uploadImageToGhost(
        { url: "https://blog.example.com", adminApiKey: "abc:0123456789abcdef" },
        { data: new Uint8Array([1, 2]), filename: "a.png", mimeType: "image/png" },
        emptyFetch,
      ),
    Error,
    "did not include an image URL",
  );
});

Deno.test("resolveImageFileInfo resolves Telegram file names and MIME types", () => {
  assertEquals(
    resolveImageFileInfo({
      filePath: "photos/file_42.jpg",
      responseContentType: "application/octet-stream",
      fallbackBaseName: "123-@tginfo",
    }),
    { filename: "file_42.jpg", mimeType: "image/jpeg" },
  );

  assertEquals(
    resolveImageFileInfo({
      fileName: "screenshot",
      mimeType: "image/png",
      fallbackBaseName: "123-@tginfo",
    }),
    { filename: "screenshot.png", mimeType: "image/png" },
  );

  assertEquals(
    resolveImageFileInfo({
      responseContentType: "image/webp; charset=binary",
      fallbackBaseName: "123-@tginfo",
    }),
    { filename: "123-@tginfo.webp", mimeType: "image/webp" },
  );
});

Deno.test("isSupportedGhostImageMimeType filters supported image MIME types", () => {
  assertEquals(isSupportedGhostImageMimeType("image/jpeg"), true);
  assertEquals(isSupportedGhostImageMimeType("image/png"), true);
  assertEquals(isSupportedGhostImageMimeType("image/webp; charset=utf-8"), true);
  assertEquals(isSupportedGhostImageMimeType("video/mp4"), false);
  assertEquals(isSupportedGhostImageMimeType("application/pdf"), false);
  assertEquals(isSupportedGhostImageMimeType(undefined), false);
});

Deno.test("getGhostConfig returns undefined unless both Ghost env vars are non-empty", () => {
  assertEquals(getGhostConfig({}), undefined);
  assertEquals(
    getGhostConfig({ GHOST_URL: "", GHOST_ADMIN_API_KEY: "" }),
    undefined,
  );
  assertEquals(
    getGhostConfig({ GHOST_URL: "https://blog.example.com" }),
    undefined,
  );
  assertEquals(
    getGhostConfig({ GHOST_ADMIN_API_KEY: "id:0123456789abcdef" }),
    undefined,
  );
  assertEquals(
    getGhostConfig({ GHOST_URL: "   ", GHOST_ADMIN_API_KEY: "id:0123" }),
    undefined,
  );
  assertEquals(
    getGhostConfig({
      GHOST_URL: " https://blog.example.com ",
      GHOST_ADMIN_API_KEY: " id:0123456789abcdef ",
    }),
    {
      url: "https://blog.example.com",
      adminApiKey: "id:0123456789abcdef",
    },
  );
});
