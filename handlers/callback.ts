import { Composer } from "https://deno.land/x/grammy/mod.ts";
import { languages } from "../database/mod.ts";

const composer = new Composer();

export default composer;

const cq = composer.on("callback_query").filter((
  ctx,
): ctx is typeof ctx & {
  callbackQuery: typeof ctx["callbackQuery"] & {
    message: NonNullable<typeof ctx["callbackQuery"]["message"]> & {
      reply_markup: NonNullable<
        NonNullable<
          typeof ctx["callbackQuery"]["message"]
        >["reply_markup"]
      >;
    };
  };
} => !!ctx.callbackQuery.message && !!ctx.callbackQuery.message.reply_markup)

cq.callbackQuery(/^idle/, (ctx) => {
  if (ctx.callbackQuery.data != `idle_${ctx.from.id}`) {
    return ctx.editMessageReplyMarkup({
      reply_markup: {
        inline_keyboard: [
          ...ctx.callbackQuery.message.reply_markup.inline_keyboard.slice(0, 2),
          [
            {
              text: `Idled by ${ctx.from.first_name}`,
              callback_data: `idle_${ctx.from.id}`,
            },
          ],
        ],
      },
    });
  }

  return ctx.editMessageReplyMarkup({
    reply_markup: {
      inline_keyboard: [
        ...ctx.callbackQuery.message.reply_markup.inline_keyboard.slice(0, 2),
        [
          {
            text: `Idle`,
            callback_data: `idle`,
          },
        ],
      ],
    },
  });
});

cq.callbackQuery(/^(?!idle)/, async (ctx) => {
  const [channel, code, mid] = ctx.callbackQuery.data.split("_");
  const isBeta = channel == "beta";

  const language = await languages.get(code);

  if (!language) {
    await ctx.answerCallbackQuery({
      text: "Language not found.",
      show_alert: true,
    });
    return;
  }

  if (!language.translators.includes(ctx.from.id)) {
    await ctx.answerCallbackQuery({
      text: "Action not allowed.",
      show_alert: true,
    });
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
  } catch (_err) {
    //
  }

  if (!sentMessageId) {
    return;
  }

  await ctx.editMessageReplyMarkup({
    reply_markup: {
      inline_keyboard: [
        [
          {
            text:
              ctx.callbackQuery.message.reply_markup.inline_keyboard[0][0].text,
            callback_data: ctx.callbackQuery.data + "_" + sentMessageId,
          },
        ],
        ...ctx.callbackQuery.message.reply_markup.inline_keyboard.slice(1),
      ],
    },
  });
});
