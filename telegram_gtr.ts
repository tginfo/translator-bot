import type {
  InputRichMessage,
  MessageEntity,
  RichMessage,
} from "grammy/types.ts";
import { TranslateOptions } from "gtr/mod.ts";
import { translateTextAndEntitiesHtml } from "./entities_html.ts";
import {
  createCloudTranslateSession,
  gCloudTranslateBatch,
} from "./gcloud_translate.ts";
import {
  splitTextPreservingSeparators,
  type TextSplitChunk,
  translatePlainTextChunks,
} from "./html_common.ts";
import { translateRichMessageHtml } from "./rich_message.ts";
import { TranslatorInfo } from "./utils.ts";

const MAX_PLAIN_TEXT_CHUNK = 18_000;

export type PlainTextChunk = TextSplitChunk;

export function splitPlainText(
  text: string,
  maxChunkChars = MAX_PLAIN_TEXT_CHUNK,
): PlainTextChunk[] {
  return splitTextPreservingSeparators(text, maxChunkChars);
}

export class TelegramGTR {
  async translate(
    text: string,
    opts: TranslateOptions & {
      entities?: MessageEntity[];
      requestUser: TranslatorInfo;
    },
  ) {
    let orig: string | undefined;
    const targetLanguage = opts.targetLang || "en";
    const session = createCloudTranslateSession(opts.requestUser);

    const translated = await translateTextAndEntitiesHtml(
      text,
      opts.entities,
      async (html) => {
        const res = await session.translateBatch({
          contents: [html],
          sourceLanguage: opts.sourceLang,
          targetLanguage,
          mimeType: "text/html",
        });
        if (!orig && res.sourceLanguage) {
          orig = res.sourceLanguage;
        }
        const content = res.contents[0];
        if (content === undefined || content === null) {
          throw new Error("Unable to access translation result");
        }
        return content;
      },
    );

    return {
      trans: translated.text,
      entities: translated.entities,
      orig,
      lang: targetLanguage,
    };
  }

  async translatePlainText(
    text: string,
    opts: TranslateOptions & { requestUser: TranslatorInfo },
  ) {
    let orig: string | undefined;
    const targetLanguage = opts.targetLang || "en";
    const joined = await translatePlainTextChunks(
      text,
      async (contents) => {
        const res = await gCloudTranslateBatch({
          contents,
          sourceLanguage: opts.sourceLang,
          targetLanguage,
          requestUser: opts.requestUser,
          mimeType: "text/plain",
        });
        orig = res.sourceLanguage;
        return res.contents;
      },
      MAX_PLAIN_TEXT_CHUNK,
    );

    return {
      trans: joined,
      orig: orig ?? opts.sourceLang,
      lang: targetLanguage,
    };
  }

  translateRichMessage(
    richMessage: RichMessage,
    opts: TranslateOptions & { requestUser: TranslatorInfo },
  ): Promise<InputRichMessage> {
    const session = createCloudTranslateSession(opts.requestUser);
    return translateRichMessageHtml(richMessage, async (htmlDocs) => {
      const res = await session.translateBatch({
        contents: htmlDocs,
        sourceLanguage: opts.sourceLang,
        targetLanguage: opts.targetLang || "en",
        mimeType: "text/html",
      });
      return res.contents;
    });
  }
}
