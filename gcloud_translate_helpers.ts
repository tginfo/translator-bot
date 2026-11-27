export const MAX_BATCH_CHARS = 24_000;
export const MAX_BATCH_ITEMS = 128;

export interface QuotaUserInfo {
  userId: number;
  userSettings: {
    cloudTranslateQuota?: number;
    cloudTranslateQuotaDuration?: number;
  };
}

export interface BatchTranslationInput<TUser extends QuotaUserInfo = QuotaUserInfo> {
  contents: string[];
  sourceLanguage?: string;
  targetLanguage: string;
  requestUser: TUser;
  mimeType?: "text/html" | "text/plain";
}

export interface BatchTranslationOutput<TUser extends QuotaUserInfo = QuotaUserInfo>
  extends BatchTranslationInput<TUser> {
  success: boolean;
  statusMessage?: string;
}

const gCloudTranslateUsage = new Map<string, number[]>();

export function resetQuota(userId: number | string): boolean {
  const key = String(userId);
  const hadUsage = (gCloudTranslateUsage.get(key)?.length ?? 0) > 0;
  gCloudTranslateUsage.delete(key);
  return hadUsage;
}

export class CloudTranslationError extends Error {
  constructor(message: string, type: string, nextRequest: string) {
    super(message);
    this.type = type;
    this.nextRequest = nextRequest;
  }
  type: string;
  nextRequest: string;
}

export function reserveQuota(
  key: string,
  quota: number,
  durationMs: number,
): () => void {
  const now = Date.now();
  const cutoff = now - durationMs;

  const timestamps = (gCloudTranslateUsage.get(key) ?? []).filter((t) =>
    t > cutoff
  );

  if (timestamps.length >= quota) {
    gCloudTranslateUsage.set(key, timestamps);
    const nextReq = quota > 0
      ? new Date(timestamps[timestamps.length - quota] + durationMs)
        .toISOString()
      : "NEVER";
    throw new CloudTranslationError(
      `User ${key} is over quota: ${timestamps.length} out of ${quota}. Next available request: ${nextReq}`,
      "QUOTA",
      nextReq,
    );
  }

  timestamps.push(now);
  gCloudTranslateUsage.set(key, timestamps);

  return () => {
    const arr = gCloudTranslateUsage.get(key);
    const idx = arr?.indexOf(now) ?? -1;
    if (arr && idx !== -1) arr.splice(idx, 1);
  };
}

export function chunkContents(
  contents: string[],
  maxBatchChars = MAX_BATCH_CHARS,
  maxBatchItems = MAX_BATCH_ITEMS,
): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const item of contents) {
    const itemLen = item.length;
    if (
      current.length > 0 &&
      (current.length >= maxBatchItems ||
        currentChars + itemLen > maxBatchChars)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += itemLen;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

export type BatchExecutor<TUser extends QuotaUserInfo = QuotaUserInfo> = (
  payload: BatchTranslationInput<TUser>,
  userQuotaKey: string,
) => Promise<BatchTranslationOutput<TUser>>;

/**
 * Creates a quota-scoped translation session that charges the user's quota at
 * most once across multiple batch requests for a single logical translation
 * (e.g. a rich message containing oversized blocks). Quota is reserved lazily
 * on the first non-empty call and refunded if that initial call fails.
 */
export function createQuotaTranslateSession<TUser extends QuotaUserInfo>(
  requestUser: TUser,
  executor: BatchExecutor<TUser>,
  options?: { maxBatchChars?: number; maxBatchItems?: number },
) {
  const userQuotaKey = String(requestUser.userId);
  let refund: (() => void) | undefined;
  let anySuccess = false;

  return {
    async translateBatch(
      payload: Omit<BatchTranslationInput<TUser>, "requestUser">,
    ): Promise<BatchTranslationOutput<TUser>> {
      if (payload.contents.length === 0) {
        return {
          success: true,
          contents: [],
          sourceLanguage: payload.sourceLanguage,
          targetLanguage: payload.targetLanguage,
          requestUser,
          mimeType: payload.mimeType,
        };
      }

      if (!refund) {
        const userQuota = requestUser.userSettings.cloudTranslateQuota ?? 10;
        const userQuotaDuration =
          requestUser.userSettings.cloudTranslateQuotaDuration ??
            1000 * 60 * 60 * 24;
        refund = reserveQuota(userQuotaKey, userQuota, userQuotaDuration);
      }

      const batches = chunkContents(
        payload.contents,
        options?.maxBatchChars,
        options?.maxBatchItems,
      );
      const translatedAll: string[] = [];
      let detectedSourceLanguage: string | undefined;

      try {
        for (const batch of batches) {
          const res = await executor(
            { ...payload, contents: batch, requestUser },
            userQuotaKey,
          );
          anySuccess = true;
          if (!detectedSourceLanguage && res.sourceLanguage) {
            detectedSourceLanguage = res.sourceLanguage;
          }
          translatedAll.push(...res.contents);
        }
        return {
          success: true,
          contents: translatedAll,
          sourceLanguage: detectedSourceLanguage ?? payload.sourceLanguage,
          targetLanguage: payload.targetLanguage,
          requestUser,
          mimeType: payload.mimeType,
        };
      } catch (err) {
        if (!anySuccess && refund) {
          refund();
          refund = undefined;
        }
        throw err;
      }
    },
  };
}
