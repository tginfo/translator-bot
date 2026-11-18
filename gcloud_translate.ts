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

type gCloudTranslateUser = { dates: Date[] };

const gCloudTranslateUsage: Record<string, gCloudTranslateUser> = {};

export class CloudTranslationError extends Error {
    constructor(message: string, type: string, nextRequest: string) {
        super(message);
        this.type = type;
        this.nextRequest = nextRequest;
    }
    type: string;
    nextRequest: string;
}

export async function gCloudTranslate(
    payload: GoogleCloudTranslationPayload,
): Promise<GoogleCloudTranslationResult> {
    const userQuotaKey = String(payload.requestUser.userId);

    if (!(userQuotaKey in gCloudTranslateUsage)) {
        gCloudTranslateUsage[userQuotaKey] = { dates: [] };
    }

    const userQuota = payload.requestUser.userSettings.cloudTranslateQuota ?? 10;
    const userQuotaDuration = payload.requestUser.userSettings.cloudTranslateQuotaDuration ?? 1000 * 60 * 60 * 24;

    gCloudTranslateUsage[userQuotaKey].dates.sort((a, b) => a.getTime() - b.getTime());
    const currentUsage = gCloudTranslateUsage[userQuotaKey].dates;

    const usageCutoff = new Date(Date.now() - userQuotaDuration);
    for (let i = 0; i < currentUsage.length; i++) {
        if (currentUsage[i] <= usageCutoff) delete currentUsage[i];
    }

    if (currentUsage.length >= userQuota) {
        const oldestRequest = currentUsage[0];
        let nextReq = "NEVER";

        if (oldestRequest) {
            nextReq = new Date(oldestRequest.getTime() + userQuotaDuration).toISOString();
        }
        
        throw new CloudTranslationError(`User ${payload.requestUser.userId} is over quota: ${currentUsage.length} out of ${userQuota}. Next available request: ${nextReq}`, 'QUOTA', nextReq);
    }
    

    const responseIterator = await client.translateText({
        parent: `projects/${projectId}/locations/${location}`,
        contents: [payload.content],
        mimeType: "text/html",
        sourceLanguageCode: payload.sourceLanguage,
        targetLanguageCode: payload.targetLanguage,
        model: `projects/${projectId}/locations/${location}/models/general/translation-llm`,
        labels: { user: userQuotaKey },
    });

    const response = responseIterator[0];
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
