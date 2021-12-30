import { Composer, InlineKeyboard } from "https://deno.land/x/grammy/mod.ts";
import { GTR } from "https://deno.land/x/gtr/mod.ts";
import {
  answerError,
  findLanguage,
  removeButton,
  replaceButton,
} from "../utils.ts";

const composer = new Composer();

export default composer;

const gtr = new GTR();

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
      sourceLang: language.from,
    });

    translation = result.trans
      .replace(/# /g, "#");
  } catch (err) {
    translation = `An error occurred while translating.\n\n${String(err)}`;
  }

  const textLinks = entities?.filter((
    e,
  ): e is typeof e & { type: "text_link" } => e.type == "text_link").map((
    e,
  ) => e.url);

  translation += textLinks && textLinks.length != 0
    ? "\n\nLinks:\n" + textLinks.join("\n")
    : "";

  removeButton(ctx.callbackQuery.message.reply_markup, ctx.callbackQuery.data);

  try {
    await ctx.editMessageReplyMarkup({
      reply_markup: ctx.callbackQuery.message.reply_markup,
    });

    await ctx.reply(text, {
      entities,
      reply_markup: new InlineKeyboard().text("Delete", "delete"),
    });

    if (ctx.callbackQuery.message.text) {
      await ctx.editMessageText(translation);
    } else {
      await ctx.editMessageCaption({ caption: translation });
    }
  } catch (err) {
    await answerError(ctx, err);
  }
});

cq.callbackQuery("delete", (ctx) => ctx.deleteMessage());

cq.callbackQuery(/^send/, async (ctx) => {
  const language = await findLanguage(ctx);
  const isBeta = ctx.callbackQuery.data.split("_")[1] == "beta";
  const chatId = isBeta ? language.beta : language.main;

  let message;

  try {
    message = await ctx.copyMessage(chatId);
  } catch (err) {
    await answerError(ctx, err);
    return;
  }

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
    await answerError(ctx, err);
    return;
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
    `Idle`,
    `idle`,
  );

  await ctx.editMessageReplyMarkup({
    reply_markup: ctx.callbackQuery.message.reply_markup,
  });
});
