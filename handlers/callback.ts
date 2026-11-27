import * as log from "@std/log";
import { Composer, InlineKeyboard } from "grammy/mod.ts";
import type { InlineKeyboardMarkup, Message } from "grammy/types.ts";
import { removeRepeatedSpacesInTextAndEntities } from "../entities_html.ts";
import { truncateText } from "../html_common.ts";
import {
  plainTextToRichMessages,
  removeRepeatedSpacesInRichMessage,
  richMessageToPlainText,
  toInputRichMessage,
} from "../rich_message.ts";
import { TelegramGTR } from "../telegram_gtr.ts";
import {
  answer,
  answerError,
  Context,
  findLanguage,
  hasButton,
  removeButton,
  replaceButton,
} from "../utils.ts";

const MAX_TEXT_MESSAGE_LENGTH = 4096;
const MAX_ALERT_LENGTH = 200;

const composer = new Composer<Context>();

export default composer;

const gtr = new TelegramGTR();

function truncateAlert(text: string): string {
  return truncateText(text, MAX_ALERT_LENGTH);
}

const cq = composer.on("callback_query").filter(
  (
    ctx,
  ): ctx is typeof ctx & {
    chat: NonNullable<typeof ctx["chat"]>;
    from: NonNullable<typeof ctx["from"]>;
    callbackQuery: NonNullable<
      typeof ctx["callbackQuery"] & {
        message: Message & {
          reply_markup: InlineKeyboardMarkup;
        };
      }
    >;
  } =>
    !!ctx.chat &&
    !!ctx.from &&
    !!ctx.callbackQuery.message &&
    "reply_markup" in ctx.callbackQuery.message &&
    !!ctx.callbackQuery.message.reply_markup,
);

cq.callbackQuery("translate", async (ctx) => {
  const language = await findLanguage(ctx);
  const message = ctx.callbackQuery.message;

  if (message.rich_message) {
    const richMessage = message.rich_message;
    let translatedRichMessage;

    try {
      translatedRichMessage = await gtr.translateRichMessage(richMessage, {
        targetLang: language.targetLang ?? language.id,
        requestUser: language,
      });

      log.info(
        `[${ctx.from.id}] Request to Google Translate successful for rich message in ${language.id} middle.`,
      );
    } catch (err) {
      log.warning(
        `[${ctx.from.id}] Request to Google Translate unsuccessful for rich message in ${language.id} middle: ${err}`,
      );
      await answer(
        ctx,
        truncateAlert(`An error occurred while translating.\n\n${err}`),
      );
      return;
    }

    const translatedMarkup = structuredClone(message.reply_markup);
    replaceButton(
      translatedMarkup,
      ctx.callbackQuery.data,
      "Remove Repeated Spaces",
      "remove_repeated_spaces",
    );

    let alreadyAnswered = false;
    try {
      let failed = false;

      try {
        await ctx.editMessageText(translatedRichMessage, {
          reply_markup: translatedMarkup,
        });
      } catch (err) {
        failed = true;

        log.warning(
          `[${ctx.from.id}] Could not send rich message translation with formatting in ${language.id} middle: ${err}`,
        );

        try {
          await answer(
            ctx,
            "Could not send the translation with formatting. Use the alternative button to get the translation without formatting.",
          );
        } catch (answerErr) {
          log.warning(
            `[${ctx.from.id}] Could not answer callback query after rich message formatting failure in ${language.id} middle: ${answerErr}`,
          );
        }
        alreadyAnswered = true;
      }

      if (!failed) {
        await ctx.replyWithRichMessage(toInputRichMessage(richMessage), {
          reply_parameters: { message_id: message.message_id },
          reply_markup: new InlineKeyboard().text("Delete", "delete"),
        });
      } else {
        const fallbackMarkup = structuredClone(message.reply_markup);
        replaceButton(
          fallbackMarkup,
          ctx.callbackQuery.data,
          "Translate (Alt)",
          "alt-translate",
        );
        await ctx.editMessageReplyMarkup({
          reply_markup: fallbackMarkup,
        });
      }
    } catch (err) {
      if (!alreadyAnswered) {
        await answerError(ctx, err);
      } else {
        log.warning(
          `[${ctx.from.id}] Post-translation fallback update failed in ${language.id} middle: ${err}`,
        );
      }
    }

    return;
  }

  const text = message.text ?? message.caption;
  if (!text) {
    await answer(ctx, "Nothing to translate.");
    return;
  }
  const entities = message.entities ?? message.caption_entities;

  let translation;
  let translatedEntities;

  try {
    const result = await gtr.translate(text, {
      targetLang: language.targetLang ?? language.id,
      // sourceLang: language.from,
      entities,
      requestUser: language,
    });

    translation = result.trans;
    translatedEntities = result.entities;

    log.info(
      `[${ctx.from.id}] Request to Google Translate successful for ${language.id} middle.`,
    );
  } catch (err) {
    log.warning(
      `[${ctx.from.id}] Request to Google Translate unsuccessful for ${language.id} middle: ${err}`,
    );
    await answer(
      ctx,
      truncateAlert(`An error occurred while translating.\n\n${err}`),
    );
    return;
  }

  const translatedMarkup = structuredClone(message.reply_markup);
  replaceButton(
    translatedMarkup,
    ctx.callbackQuery.data,
    "Remove Repeated Spaces",
    "remove_repeated_spaces",
  );

  let alreadyAnswered = false;
  try {
    let failed = false;

    try {
      if (message.text != undefined) {
        await ctx.editMessageText(translation, {
          entities: translatedEntities,
          link_preview_options: message.link_preview_options,
          reply_markup: translatedMarkup,
        });
      } else {
        await ctx.editMessageCaption({
          caption: translation,
          caption_entities: translatedEntities,
          reply_markup: translatedMarkup,
        });
      }
    } catch (err) {
      failed = true;

      log.warning(
        `[${ctx.from.id}] Could not send translation with formatting in ${language.id} middle: ${err}`,
      );

      try {
        await answer(
          ctx,
          "Could not send the translation with formatting. Use the alternative button to get the translation without formatting.",
        );
      } catch (answerErr) {
        log.warning(
          `[${ctx.from.id}] Could not answer callback query after formatting failure in ${language.id} middle: ${answerErr}`,
        );
      }
      alreadyAnswered = true;
    }

    if (!failed) {
      await ctx.reply(text, {
        entities,
        reply_parameters: { message_id: message.message_id },
        reply_markup: new InlineKeyboard().text("Delete", "delete"),
      });
    } else {
      const fallbackMarkup = structuredClone(message.reply_markup);
      replaceButton(
        fallbackMarkup,
        ctx.callbackQuery.data,
        "Translate (Alt)",
        "alt-translate",
      );
      await ctx.editMessageReplyMarkup({
        reply_markup: fallbackMarkup,
      });
    }
  } catch (err) {
    if (!alreadyAnswered) {
      await answerError(ctx, err);
    } else {
      log.warning(
        `[${ctx.from.id}] Post-translation fallback update failed in ${language.id} middle: ${err}`,
      );
    }
  }
});

cq.callbackQuery("alt-translate", async (ctx) => {
  const language = await findLanguage(ctx);
  const message = ctx.callbackQuery.message;

  let translation;

  if (message.rich_message) {
    const plainText = richMessageToPlainText(message.rich_message);
    if (!plainText.trim()) {
      await answer(ctx, "Nothing to translate.");
      return;
    }

    try {
      const result = await gtr.translatePlainText(plainText, {
        targetLang: language.targetLang ?? language.id,
        requestUser: language,
      });

      translation = result.trans;

      log.info(
        `[${ctx.from.id}] Alternative request to Google Translate successful for rich message in ${language.id} middle.`,
      );
    } catch (err) {
      log.warning(
        `[${ctx.from.id}] Alternative request to Google Translate unsuccessful for rich message in ${language.id} middle: ${err}`,
      );
      await answer(
        ctx,
        truncateAlert(`An error occurred while translating.\n\n${err}`),
      );
      return;
    }
  } else {
    const text = message.text ?? message.caption;
    if (!text || !text.trim()) {
      await answer(ctx, "Nothing to translate.");
      return;
    }

    try {
      const result = await gtr.translatePlainText(text, {
        targetLang: language.targetLang ?? language.id,
        // sourceLang: language.from,
        requestUser: language,
      });

      translation = result.trans;

      log.info(
        `[${ctx.from.id}] Alternative request to Google Translate successful for ${language.id} middle.`,
      );
    } catch (err) {
      log.warning(
        `[${ctx.from.id}] Alternative request to Google Translate unsuccessful for ${language.id} middle: ${err}`,
      );
      await answer(
        ctx,
        truncateAlert(`An error occurred while translating.\n\n${err}`),
      );
      return;
    }
  }

  if (!translation.trim()) {
    await answer(ctx, "Nothing to translate.");
    return;
  }

  try {
    const deleteKeyboard = new InlineKeyboard().text("Delete", "delete");
    if (translation.length > MAX_TEXT_MESSAGE_LENGTH) {
      for (const richPart of plainTextToRichMessages(translation)) {
        await ctx.replyWithRichMessage(richPart, {
          reply_parameters: { message_id: message.message_id },
          reply_markup: deleteKeyboard,
        });
      }
    } else {
      await ctx.reply(translation, {
        reply_parameters: { message_id: message.message_id },
        reply_markup: deleteKeyboard,
      });
    }

    const updatedMarkup = structuredClone(message.reply_markup);
    removeButton(updatedMarkup, ctx.callbackQuery.data);
    await ctx.editMessageReplyMarkup({
      reply_markup: updatedMarkup,
    });
  } catch (err) {
    await answerError(ctx, err);
  }
});

cq.callbackQuery("delete", async (ctx) => {
  await findLanguage(ctx);
  await ctx.deleteMessage();
});

cq.callbackQuery(/^send/, async (ctx) => {
  const language = await findLanguage(ctx, true);
  const srcMessage = ctx.callbackQuery.message;

  if (hasButton(srcMessage.reply_markup, "idle_")) {
    await answer(ctx, "Can't send idled post.");
    return;
  }

  const isBeta = ctx.callbackQuery.data.split("_")[1] == "beta";
  const chatId = isBeta ? language.beta : language.main;
  const destination = isBeta ? "beta" : "main";

  let message;

  try {
    if (srcMessage.rich_message) {
      try {
        message = await ctx.copyMessage(chatId);
      } catch (copyErr) {
        log.warning(
          `[${ctx.from.id}] copyMessage failed for rich message to ${destination} in ${language.id} middle, falling back to sendRichMessage: ${copyErr}`,
        );
        message = await ctx.api.sendRichMessage(
          chatId,
          toInputRichMessage(srcMessage.rich_message),
        );
      }
    } else if (
      srcMessage.text !== undefined &&
      srcMessage.link_preview_options
    ) {
      message = await ctx.api.sendMessage(
        chatId,
        srcMessage.text,
        {
          entities: srcMessage.entities,
          link_preview_options: srcMessage.link_preview_options,
        },
      );
    } else {
      message = await ctx.copyMessage(chatId);
    }
    log.info(
      `[${ctx.from.id}] Sending to ${destination} successful in ${language.id} middle.`,
    );
  } catch (err) {
    await answerError(ctx, err);
    log.error(
      `[${ctx.from.id}] Sending to ${destination} unsuccessful in ${language.id} middle: ${err}`,
    );
    return;
  }

  removeButton(srcMessage.reply_markup, "translate");
  removeButton(srcMessage.reply_markup, "alt-translate");

  replaceButton(
    srcMessage.reply_markup,
    ctx.callbackQuery.data,
    (c) => c.replace("Send to", "Edit in"),
    `edit_${isBeta ? "beta" : "tg"}_${message.message_id}`,
  );

  await ctx.editMessageReplyMarkup({
    reply_markup: srcMessage.reply_markup,
  });
});

cq.callbackQuery(/^edit/, async (ctx) => {
  const language = await findLanguage(ctx, true);
  const message = ctx.callbackQuery.message;

  if (hasButton(message.reply_markup, "idle_")) {
    await answer(ctx, "Can't edit idled post.");
    return;
  }

  const isBeta = ctx.callbackQuery.data.split("_")[1] == "beta";
  const chatId = isBeta ? language.beta : language.main;
  const messageId = Number(ctx.callbackQuery.data.split("_")[2]);
  const destination = isBeta ? "beta" : "main";

  try {
    if (message.rich_message) {
      await ctx.api.editMessageText(
        chatId,
        messageId,
        toInputRichMessage(message.rich_message),
      );
    } else if (message.text) {
      await ctx.api.editMessageText(
        chatId,
        messageId,
        message.text,
        {
          entities: message.entities,
          link_preview_options: message.link_preview_options,
        },
      );
    } else {
      await ctx.api.editMessageCaption(chatId, messageId, {
        caption: message.caption,
        caption_entities: message.caption_entities,
      });
    }

    log.info(
      `[${ctx.from.id}] Editing post of ${destination} successful in ${language.id} middle.`,
    );
  } catch (err) {
    await answerError(ctx, err);
    log.warning(
      `[${ctx.from.id}] Editing post of ${destination} unsuccessful in ${language.id} middle.`,
    );
    return;
  }
});

cq.callbackQuery("remove_repeated_spaces", async (ctx) => {
  await findLanguage(ctx);
  const message = ctx.callbackQuery.message;

  if (hasButton(message.reply_markup, "idle_")) {
    await answer(ctx, "Can't edit idled post.");
    return;
  }

  try {
    if (message.rich_message) {
      const { richMessage, changed } = removeRepeatedSpacesInRichMessage(
        message.rich_message,
      );

      removeButton(message.reply_markup, ctx.callbackQuery.data);

      if (changed) {
        await ctx.editMessageText(richMessage, {
          reply_markup: message.reply_markup,
        });
      } else {
        await ctx.editMessageReplyMarkup({
          reply_markup: message.reply_markup,
        });
      }
      return;
    }

    const { text: newText, entities: newEntities, changed } =
      removeRepeatedSpacesInTextAndEntities(
        message.text ?? message.caption ?? "",
        message.entities ?? message.caption_entities ?? [],
      );

    removeButton(message.reply_markup, ctx.callbackQuery.data);

    if (changed) {
      if (message.text != undefined) {
        await ctx.editMessageText(newText, {
          entities: newEntities,
          link_preview_options: message.link_preview_options,
          reply_markup: message.reply_markup,
        });
      } else {
        await ctx.editMessageCaption({
          caption: newText,
          caption_entities: newEntities,
          reply_markup: message.reply_markup,
        });
      }
    } else {
      await ctx.editMessageReplyMarkup({
        reply_markup: message.reply_markup,
      });
    }
  } catch (err) {
    await answerError(ctx, err);
  }
});

cq.callbackQuery(/^idle/, async (ctx) => {
  await findLanguage(ctx);

  if (ctx.callbackQuery.data != `idle_${ctx.from.id}`) {
    replaceButton(
      ctx.callbackQuery.message.reply_markup,
      ctx.callbackQuery.data,
      `Idled by ${ctx.from.first_name}`,
      `idle_${ctx.from.id}`,
    );

    await ctx.editMessageReplyMarkup({
      reply_markup: ctx.callbackQuery.message.reply_markup,
    });
    return;
  }

  replaceButton(
    ctx.callbackQuery.message.reply_markup,
    ctx.callbackQuery.data,
    "Idle",
    "idle",
  );

  await ctx.editMessageReplyMarkup({
    reply_markup: ctx.callbackQuery.message.reply_markup,
  });
});
