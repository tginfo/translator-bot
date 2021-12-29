import { Composer } from "https://deno.land/x/grammy/mod.ts";
import { answerWithError, findLanguage } from "../utils.ts";

const composer = new Composer();

export default composer;

const cq = composer.on("callback_query").filter((
  ctx,
): ctx is typeof ctx & {
  chat: NonNullable<typeof ctx["chat"]>;
  from: NonNullable<typeof ctx["from"]>;
  callbackQuery: NonNullable<
    typeof ctx["callbackQuery"] & {
      message: NonNullable<typeof ctx["callbackQuery"]["message"]> & {
        reply_markup: NonNullable<
          NonNullable<
            typeof ctx["callbackQuery"]["message"]
          >["reply_markup"]
        >;
      };
    }
  >;
} =>
  !!ctx.chat && !!ctx.from && !!ctx.callbackQuery.message &&
  !!ctx.callbackQuery.message.reply_markup
);

cq.callbackQuery(/^idle/, async (ctx) => {
  await findLanguage(ctx);

  const inlineKeyboard = ctx.callbackQuery.message.reply_markup.inline_keyboard;

  if (ctx.callbackQuery.data != `idle_${ctx.from.id}`) {
    inlineKeyboard[1][0] = {
      text: `Idled by ${ctx.from.first_name}`,
      callback_data: `idle_${ctx.from.id}`,
    };

    await ctx.editMessageReplyMarkup({
      reply_markup: {
        inline_keyboard: inlineKeyboard,
      },
    });
    return;
  }

  inlineKeyboard[1][0] = {
    text: `Idle`,
    callback_data: `idle`,
  };

  await ctx.editMessageReplyMarkup({
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
  });
});

cq.callbackQuery(/^send/, async (ctx) => {
  const language = await findLanguage(ctx);
  const isBeta = ctx.callbackQuery.data.split("_")[1] == "beta";
  const chatId = isBeta ? language.beta : language.main;

  let message;

  try {
    message = await ctx.copyMessage(chatId);
  } catch (err) {
    await answerWithError(ctx, err);
    return;
  }

  const inlineKeyboard = ctx.callbackQuery.message.reply_markup.inline_keyboard;

  inlineKeyboard[0][0] = {
    text: inlineKeyboard[0][0]
      .text.replace("Send to", "Edit in"),
    callback_data: `edit_${isBeta ? "beta" : "tg"}_${message.message_id}`,
  };

  await ctx.editMessageReplyMarkup({
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
});

cq.callbackQuery(/^edit/, async (ctx) => {
  const language = await findLanguage(ctx);
  const isBeta = ctx.callbackQuery.data.split("_")[1] == "beta";
  const chatId = isBeta ? language.beta : language.main;
  const messageId = Number(ctx.callbackQuery.data.split("_")[2]);

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
  } catch (err) {
    await answerWithError(ctx, err);
    return;
  }
});
