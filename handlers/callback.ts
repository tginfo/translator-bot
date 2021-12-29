import { Composer } from "https://deno.land/x/grammy/mod.ts";
import { answer, answerWithError } from "../utils.ts";
import { languages } from "../data.ts";

const composer = new Composer();

export default composer;

const cq = composer.on("callback_query").filter((
  ctx,
): ctx is typeof ctx & {
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
} => !!ctx.callbackQuery.message && !!ctx.callbackQuery.message.reply_markup);

cq.callbackQuery(/^idle/, (ctx) => {
  const inlineKeyboard = ctx.callbackQuery.message.reply_markup.inline_keyboard;

  if (ctx.callbackQuery.data != `idle_${ctx.from.id}`) {
    inlineKeyboard[1][0] = {
      text: `Idled by ${ctx.from.first_name}`,
      callback_data: `idle_${ctx.from.id}`,
    };

    return ctx.editMessageReplyMarkup({
      reply_markup: {
        inline_keyboard: inlineKeyboard,
      },
    });
  }

  inlineKeyboard[1][0] = {
    text: `Idle`,
    callback_data: `idle`,
  };

  return ctx.editMessageReplyMarkup({
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
  });
});

cq.callbackQuery(/^(?!idle)/, async (ctx) => {
  const [channel, id, mid] = ctx.callbackQuery.data.split("_");
  const isBeta = channel == "beta";

  const language = languages[id];

  if (!language) {
    await answer(ctx, "Language not found.");
    return;
  }

  if (!language.translators.includes(ctx.from.id)) {
    await answer(ctx, "Action not allowed.");
    return;
  }

  const chatId = isBeta ? language.beta : language.main;
  const messageId = Number(mid);

  let sentMessageId;

  try {
    if (messageId) {
      if (ctx.callbackQuery.message.text) {
        await ctx.api.editMessageText(
          chatId,
          messageId,
          ctx.callbackQuery.message.text,
          { entities: ctx.callbackQuery.message.entities },
        );
      } else if (ctx.callbackQuery.message.caption) {
        await ctx.api.editMessageCaption(chatId, messageId, {
          caption: ctx.callbackQuery.message.caption,
          caption_entities: ctx.callbackQuery.message.caption_entities,
        });
      }
    } else {
      if (ctx.callbackQuery.message.text) {
        const message = await ctx.api.sendMessage(
          chatId,
          ctx.callbackQuery.message.text,
          {
            entities: ctx.callbackQuery.message.entities,
          },
        );

        sentMessageId = message.message_id;
      } else if (ctx.callbackQuery.message.caption) {
        const message = await ctx.copyMessage(chatId, {
          caption: ctx.callbackQuery.message.caption,
          caption_entities: ctx.callbackQuery.message.caption_entities,
        });

        sentMessageId = message.message_id;
      }
    }
  } catch (err) {
    await answerWithError(ctx, err);
  }

  if (!sentMessageId) {
    return;
  }

  const inlineKeyboard = ctx.callbackQuery.message.reply_markup.inline_keyboard;

  inlineKeyboard[0][0].text = inlineKeyboard[0][0]
    .text.replace("Send to", "Edit in");

  await ctx.editMessageReplyMarkup({
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
});
