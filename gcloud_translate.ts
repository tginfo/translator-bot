import gax from "google-gax";
import { TranslationServiceClient } from "@google-cloud/translate";
import env from "./env.ts";
import {
  type BatchExecutor,
  CloudTranslationError,
  createQuotaTranslateSession,
  resetQuota,
} from "./gcloud_translate_helpers.ts";
import { TranslatorInfo } from "./utils.ts";

export { CloudTranslationError, resetQuota };

const client = new TranslationServiceClient({ fallback: true }, gax.fallback);

const projectId = env.GCLOUD_TRANSLATION_PROJECT_ID;
const location = env.GCLOUD_TRANSLATION_LOCATION;

export interface GoogleCloudTranslationPayload {
  content: string;
  sourceLanguage?: string;
  targetLanguage: string;
  requestUser: TranslatorInfo;
  mimeType?: "text/html" | "text/plain";
}

export interface GoogleCloudTranslationResult
  extends GoogleCloudTranslationPayload {
  success: boolean;
  statusMessage?: string;
}

export interface GoogleCloudBatchTranslationPayload {
  contents: string[];
  sourceLanguage?: string;
  targetLanguage: string;
  requestUser: TranslatorInfo;
  mimeType?: "text/html" | "text/plain";
}

export interface GoogleCloudBatchTranslationResult
  extends GoogleCloudBatchTranslationPayload {
  success: boolean;
  statusMessage?: string;
}

async function executeTranslateBatch(
  payload: GoogleCloudBatchTranslationPayload,
  userQuotaKey: string,
): Promise<GoogleCloudBatchTranslationResult> {
  const [response] = await client.translateText({
    parent: `projects/${projectId}/locations/${location}`,
    contents: payload.contents,
    mimeType: payload.mimeType ?? "text/html",
    sourceLanguageCode: payload.sourceLanguage,
    targetLanguageCode: payload.targetLanguage,
    model:
      `projects/${projectId}/locations/${location}/models/general/translation-llm`,
    labels: { user: userQuotaKey },
  });

  const translations = response?.translations;
  if (!translations || translations.length !== payload.contents.length) {
    throw new Error("Unable to access translation result");
  }

  const translatedAll: string[] = [];
  let detectedSourceLanguage: string | undefined;

  for (const translation of translations) {
    if (
      translation.translatedText === undefined ||
      translation.translatedText === null
    ) {
      throw new Error("Unable to access translation result");
    }
    if (!detectedSourceLanguage && translation.detectedLanguageCode) {
      detectedSourceLanguage = translation.detectedLanguageCode;
    }
    translatedAll.push(translation.translatedText);
  }

  return {
    success: true,
    contents: translatedAll,
    sourceLanguage: detectedSourceLanguage ?? payload.sourceLanguage,
    targetLanguage: payload.targetLanguage,
    requestUser: payload.requestUser,
    mimeType: payload.mimeType,
  };
}

export function createCloudTranslateSession(
  requestUser: TranslatorInfo,
  executor: BatchExecutor<TranslatorInfo> = executeTranslateBatch,
) {
  return createQuotaTranslateSession(requestUser, executor);
}

export function gCloudTranslateBatch(
  payload: GoogleCloudBatchTranslationPayload,
): Promise<GoogleCloudBatchTranslationResult> {
  const session = createCloudTranslateSession(payload.requestUser);
  return session.translateBatch({
    contents: payload.contents,
    sourceLanguage: payload.sourceLanguage,
    targetLanguage: payload.targetLanguage,
    mimeType: payload.mimeType,
  });
}

export async function gCloudTranslate(
  payload: GoogleCloudTranslationPayload,
): Promise<GoogleCloudTranslationResult> {
  const res = await gCloudTranslateBatch({
    contents: [payload.content],
    sourceLanguage: payload.sourceLanguage,
    targetLanguage: payload.targetLanguage,
    requestUser: payload.requestUser,
    mimeType: payload.mimeType,
  });

  const result = res.contents[0];
  if (result === undefined || result === null) {
    throw new Error("Unable to access translation result");
  }

  return {
    success: true,
    content: result,
    sourceLanguage: res.sourceLanguage,
    targetLanguage: payload.targetLanguage,
    requestUser: payload.requestUser,
    mimeType: payload.mimeType,
  };
}
