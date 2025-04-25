import * as log from "@std/log";
import { Composer, InlineKeyboard } from "grammy/mod.ts";
import { TelegramGTR } from "../telegram_gtr.ts";
import {
  answer,
  answerError,
  Context,
  escape,
  findLanguage,
  hasButton,
  removeButton,
  replaceButton,
  unparse,
} from "../utils.ts";

const composer = new Composer<Context>();

export default composer;

const gtr = new TelegramGTR();

const cq = composer.on("callback_query").filter(
  (
    ctx,
  ): ctx is typeof ctx & {
    chat: NonNullable<typeof ctx["chat"]>;
    from: NonNullable<typeof ctx["from"]>;
    callbackQuery: NonNullable<
      typeof ctx["callbackQuery"] & {
        message: NonNullable<typeof ctx["callbackQuery"]["message"]> & {
          reply_markup: NonNullable<
            NonNullable<typeof ctx["callbackQuery"]["message"]>["reply_markup"]
          >;
        };
      }
    >;
  } =>
    !!ctx.chat &&
    !!ctx.from &&
    !!ctx.callbackQuery.message &&
    !!ctx.callbackQuery.message.reply_markup,
);

cq.callbackQuery("translate", async (ctx) => {
  const language = await findLanguage(ctx);
  const text = ctx.callbackQuery.message.text ||
    ctx.callbackQuery.message.caption!;
  const entities = ctx.callbackQuery.message.entities ||
    ctx.callbackQuery.message.caption_entities;

  let translation;

  try {
    const result = await gtr.translate(text, {
      targetLang: language.targetLang ?? language.id,
      // sourceLang: language.from,
      entities,
    });

    translation = result.trans;

    log.info(
      `[${ctx.from.id}] Request to Google Translate successful for ${language.id} middle.`,
    );
  } catch (err) {
    translation = `An error occurred while translating.\n\n${escape(err)}`;
    log.warning(
      `[${ctx.from.id}] Request to Google Translate unsuccessful for ${language.id} middle: ${err}`,
    );
  }

  replaceButton(
    ctx.callbackQuery.message.reply_markup,
    ctx.callbackQuery.data,
    "Remove Repeated Spaces",
    "remove_repeated_spaces",
  );

  try {
    let failed = false;

    try {
      const other = {
        parse_mode: "HTML" as const,
        reply_markup: ctx.callbackQuery.message.reply_markup,
      };

      if (ctx.callbackQuery.message.text != undefined) {
        await ctx.editMessageText(translation, other);
      } else {
        await ctx.editMessageCaption({ caption: translation, ...other });
      }
    } catch (_err) {
      failed = true;

      log.warning(
        `[${ctx.from.id}] Could not send translation with formatting in ${language.id} middle.`,
      );

      await answer(
        ctx,
        "Could not send the translation with formatting. Use the alternative button to get the translation without formatting.",
      );
    }

    if (!failed) {
      await ctx.reply(text, {
        entities,
        reply_to_message_id: ctx.callbackQuery.message.message_id,
        reply_markup: new InlineKeyboard().text("Delete", "delete"),
      });
    } else {
      await ctx.editMessageReplyMarkup({
        reply_markup: {
          inline_keyboard: [
            [{ text: "Translate (Alt)", callback_data: "alt-translate" }],
            ...ctx.callbackQuery.message.reply_markup.inline_keyboard,
          ],
        },
      });
    }
  } catch (err) {
    await answerError(ctx, err);
  }
});

cq.callbackQuery("alt-translate", async (ctx) => {
  const language = await findLanguage(ctx);
  const text = ctx.callbackQuery.message.text ||
    ctx.callbackQuery.message.caption!;

  let translation;

  try {
    const result = await gtr.translate(text, {
      targetLang: language.targetLang ?? language.id,
      // sourceLang: language.from,
    });

    translation = result.trans;

    log.info(
      `[${ctx.from.id}] Alternative request to Google Translate successful for ${language.id} middle.`,
    );
  } catch (err) {
    translation = `An error occurred while translating.\n\n${escape(err)}`;
    log.warning(
      `[${ctx.from.id}] Alternative request to Google Translate unsuccessful for ${language.id} middle: ${err}`,
    );
  }

  removeButton(ctx.callbackQuery.message.reply_markup, ctx.callbackQuery.data);

  try {
    await ctx.editMessageReplyMarkup({
      reply_markup: ctx.callbackQuery.message.reply_markup,
    });

    await ctx.reply(translation, {
      reply_to_message_id: ctx.callbackQuery.message.message_id,
      reply_markup: new InlineKeyboard().text("Delete", "delete"),
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

  if (hasButton(ctx.callbackQuery.message.reply_markup, "idle_")) {
    await answer(ctx, "Can't send idled post.");
    return;
  }

  const isBeta = ctx.callbackQuery.data.split("_")[1] == "beta";
  const chatId = isBeta ? language.beta : language.main;
  const destination = isBeta ? "beta" : "main";

  let message;

  try {
    message = await ctx.copyMessage(chatId);
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

  removeButton(ctx.callbackQuery.message.reply_markup, "translate");

  replaceButton(
    ctx.callbackQuery.message.reply_markup,
    ctx.callbackQuery.data,
    (c) => c.replace("Send to", "Edit in"),
    `edit_${isBeta ? "beta" : "tg"}_${message.message_id}`,
  );

  await ctx.editMessageReplyMarkup({
    reply_markup: ctx.callbackQuery.message.reply_markup,
  });
});

cq.callbackQuery(/^edit/, async (ctx) => {
  const language = await findLanguage(ctx, true);

  if (hasButton(ctx.callbackQuery.message.reply_markup, "idle_")) {
    await answer(ctx, "Can't edit idled post.");
    return;
  }

  const isBeta = ctx.callbackQuery.data.split("_")[1] == "beta";
  const chatId = isBeta ? language.beta : language.main;
  const messageId = Number(ctx.callbackQuery.data.split("_")[2]);
  const destination = isBeta ? "beta" : "main";

  try {
    if (ctx.callbackQuery.message.text) {
      await ctx.api.editMessageText(
        chatId,
        messageId,
        ctx.callbackQuery.message.text,
        { entities: ctx.callbackQuery.message.entities },
      );
    } else {
      await ctx.api.editMessageCaption(chatId, messageId, {
        caption: ctx.callbackQuery.message.caption,
        caption_entities: ctx.callbackQuery.message.caption_entities,
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
  if (hasButton(ctx.callbackQuery.message.reply_markup, "idle_")) {
    await answer(ctx, "Can't edit idled post.");
    return;
  }

  const text = unparse(
    ctx.callbackQuery.message.text! ?? ctx.callbackQuery.message.caption,
    ctx.callbackQuery.message.entities ??
      ctx.callbackQuery.message.caption_entities ?? [],
  );
  let newText = text;
  while (/ {2,}/.test(newText)) {
    newText = newText.replace(/ {2,}/g, " ");
  }

  removeButton(ctx.callbackQuery.message.reply_markup, ctx.callbackQuery.data);

  if (newText != text) {
    const other = {
      parse_mode: "HTML" as const,
      reply_markup: ctx.callbackQuery.message.reply_markup,
    };

    if (ctx.callbackQuery.message.text != undefined) {
      await ctx.editMessageText(newText, other);
    } else {
      await ctx.editMessageCaption({ caption: newText, ...other });
    }
  } else {
    await ctx.editMessageReplyMarkup({
      reply_markup: ctx.callbackQuery.message.reply_markup,
    });
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
