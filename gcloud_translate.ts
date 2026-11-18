
import gax from "google-gax";
import { TranslationServiceClient } from "@google-cloud/translate";
import env from "./env.ts";
import { TranslatorInfo } from "./utils.ts";

const client = new TranslationServiceClient({ fallback: true }, gax.fallback);

const projectId = env.GCLOUD_TRANSLATION_PROJECT_ID;
const location = env.GCLOUD_TRANSLATION_LOCATION;

export interface GoogleCloudTranslationPayload {
    content: string;
    sourceLanguage?: string;
    targetLanguage: string;
    requestUser: TranslatorInfo;
}

export interface GoogleCloudTranslationResult extends GoogleCloudTranslationPayload {
    success: boolean;
    statusMessage?: string;
}

const gCloudTranslateUsage = new Map<string, number[]>();

export class CloudTranslationError extends Error {
    constructor(message: string, type: string, nextRequest: string) {
        super(message);
        this.type = type;
        this.nextRequest = nextRequest;
    }
    type: string;
    nextRequest: string;
}

function reserveQuota(key: string, quota: number, durationMs: number): () => void {
    const now = Date.now();
    const cutoff = now - durationMs;

    const timestamps = (gCloudTranslateUsage.get(key) ?? []).filter((t) => t > cutoff);

    if (timestamps.length >= quota) {
        gCloudTranslateUsage.set(key, timestamps);
        const nextReq = quota > 0
            ? new Date(timestamps[timestamps.length - quota] + durationMs).toISOString()
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

export async function gCloudTranslate(
    payload: GoogleCloudTranslationPayload,
): Promise<GoogleCloudTranslationResult> {
    const userQuotaKey = String(payload.requestUser.userId);
    const userQuota = payload.requestUser.userSettings.cloudTranslateQuota ?? 10;
    const userQuotaDuration =
        payload.requestUser.userSettings.cloudTranslateQuotaDuration ?? 1000 * 60 * 60 * 24;

    const refund = reserveQuota(userQuotaKey, userQuota, userQuotaDuration);

    const [response] = await client
        .translateText({
            parent: `projects/${projectId}/locations/${location}`,
            contents: [payload.content],
            mimeType: "text/html",
            sourceLanguageCode: payload.sourceLanguage,
            targetLanguageCode: payload.targetLanguage,
            model: `projects/${projectId}/locations/${location}/models/general/translation-llm`,
            labels: { user: userQuotaKey },
        })
        .catch((err) => {
            refund();
            throw err;
        });

    const translation = response?.translations?.[0];
    const result = translation?.translatedText;

    if (!result) {
        throw new Error("Unable to access translation result");
    }

    return {
        success: true,
        content: result,
        sourceLanguage: translation.detectedLanguageCode || undefined,
        targetLanguage: payload.targetLanguage,
        requestUser: payload.requestUser,
    };
}
