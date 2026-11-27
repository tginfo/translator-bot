export interface GhostConfig {
  url: string;
  adminApiKey: string;
}

export function getGhostConfig(env: {
  GHOST_URL?: string;
  GHOST_ADMIN_API_KEY?: string;
}): GhostConfig | undefined {
  const url = env.GHOST_URL?.trim();
  const adminApiKey = env.GHOST_ADMIN_API_KEY?.trim();
  if (!url || !adminApiKey) {
    return undefined;
  }
  return { url, adminApiKey };
}

export interface GhostImageUpload {
  data: Uint8Array;
  filename: string;
  mimeType: string;
  ref?: string;
}

export const SUPPORTED_GHOST_IMAGE_MIME_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

const EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const GHOST_ACCEPT_VERSION = "v5.0";
const JWT_LIFETIME_SECONDS = 5 * 60;

export function isSupportedGhostImageMimeType(
  mimeType: string | undefined,
): mimeType is keyof typeof SUPPORTED_GHOST_IMAGE_MIME_TYPES {
  if (!mimeType) return false;
  return normalizeMimeType(mimeType) in SUPPORTED_GHOST_IMAGE_MIME_TYPES;
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

function getExtension(filename: string): string | undefined {
  const base = filename.split("/").pop() ?? filename;
  const dotIndex = base.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === base.length - 1) return undefined;
  return base.slice(dotIndex).toLowerCase();
}

export function resolveImageFileInfo(options: {
  filePath?: string;
  fileName?: string;
  mimeType?: string;
  responseContentType?: string | null;
  fallbackBaseName?: string;
}): { filename: string; mimeType: string } {
  const pathName = options.filePath?.split("/").pop();
  const rawName = options.fileName || pathName;
  const extFromName = rawName ? getExtension(rawName) : undefined;
  const mimeFromExt = extFromName
    ? EXTENSION_TO_MIME_TYPE[extFromName]
    : undefined;

  const candidates = [
    options.mimeType,
    options.responseContentType ?? undefined,
    mimeFromExt,
  ];

  let mimeType = "image/jpeg";
  for (const candidate of candidates) {
    if (candidate) {
      const normalized = normalizeMimeType(candidate);
      if (normalized in SUPPORTED_GHOST_IMAGE_MIME_TYPES) {
        mimeType = normalized;
        break;
      }
    }
  }

  const defaultExt = SUPPORTED_GHOST_IMAGE_MIME_TYPES[mimeType] ?? ".jpg";
  const baseFallback = options.fallbackBaseName || "image";
  let filename = rawName?.trim() || `${baseFallback}${defaultExt}`;
  const currentExt = getExtension(filename);

  if (!currentExt || !(currentExt in EXTENSION_TO_MIME_TYPE)) {
    filename = `${filename}${defaultExt}`;
  }

  return { filename, mimeType };
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Invalid Ghost Admin API secret: expected even-length hex.");
  }

  const buffer = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function base64UrlEncode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createGhostAdminToken(
  adminApiKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const parts = adminApiKey.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      "Invalid Ghost Admin API key format: expected '<id>:<secret>'.",
    );
  }

  const [id, secret] = parts;
  const secretBytes = hexToBytes(secret);

  const encoder = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT", kid: id };
  const payload = {
    iat: nowSeconds,
    exp: nowSeconds + JWT_LIFETIME_SECONDS,
    aud: "/admin/",
  };

  const encodedHeader = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(
    encoder.encode(JSON.stringify(payload)),
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function uploadImageToGhost(
  config: GhostConfig,
  image: GhostImageUpload,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const trimmedUrl = config.url.trim().replace(/\/+$/, "");
  if (!trimmedUrl) {
    throw new Error("Ghost URL is empty.");
  }

  const endpoint = `${trimmedUrl}/ghost/api/admin/images/upload/`;
  const token = await createGhostAdminToken(config.adminApiKey.trim());

  const formData = new FormData();
  const bytes = new Uint8Array(image.data);
  formData.append(
    "file",
    new Blob([bytes], { type: image.mimeType }),
    image.filename,
  );
  formData.append("purpose", "image");
  if (image.ref) {
    formData.append("ref", image.ref);
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Ghost ${token}`,
      "Accept-Version": GHOST_ACCEPT_VERSION,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Ghost image upload failed (${response.status} ${response.statusText})${
        errorBody ? `: ${errorBody}` : ""
      }`,
    );
  }

  const result = await response.json() as {
    images?: Array<{ url?: string; ref?: string }>;
  };

  const uploadedUrl = result?.images?.[0]?.url;
  if (!uploadedUrl) {
    throw new Error("Ghost image upload response did not include an image URL.");
  }

  return uploadedUrl;
}
