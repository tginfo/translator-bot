import { Composer, InlineKeyboard } from "https://deno.land/x/grammy/mod.ts";
import { GTR } from "https://deno.land/x/gtr/mod.ts";
import {
  alt,
  betainfo,
  betainfoen,
  languages,
  tginfo,
  tginfoen,
} from "../data.ts";

const composer = new Composer();

export default composer;

const gtr = new GTR();

const allChannels = [alt, tginfo, betainfo, tginfoen, betainfoen];

const betaChannels = [betainfo, betainfoen];

const keyChannels = {
  "ru": [tginfo, betainfo],
  "en": [tginfoen, betainfoen],
};

composer.on(["channel_post:text", "channel_post:caption"]).filter((
  ctx,
) => allChannels.includes(ctx.chat.id)).use(async (ctx) => {
  const text = ctx.channelPost.text || ctx.channelPost.caption!;
  const isAlt = ctx.chat.id == alt;
  const isBeta = betaChannels.includes(ctx.chat.id);

  for (const id in languages) {
    const language = languages[id];

    if (!isAlt && !keyChannels[language.from].includes(ctx.chat.id)) {
      continue;
    }

    let translation;

    try {
      const result = await gtr.translate(text, {
        targetLang: language.targetLang ?? id,
        sourceLang: language.from,
      });

      translation = result.trans
        .replace(/# /g, "#");
    } catch (err) {
      translation = `An error occurred while translating.\n\n${String(err)}`;
    }

    const textLinks =
      (ctx.channelPost.entities || ctx.channelPost.caption_entities)?.filter((
        e,
      ): e is typeof e & { type: "text_link" } => e.type == "text_link").map((
        e,
      ) => e.url);

    translation += textLinks && textLinks.length != 0
      ? "\n\nLinks:\n" + textLinks.join("\n")
      : "";

    const { message_id: messageId } = await ctx.copyMessage(language.edit, {
      reply_markup: new InlineKeyboard().text(
        `Send to ${isBeta ? "Beta" : "Main"} Channel`,
        `send_${isBeta ? "beta" : "tg"}}`,
      ).row().text("Idle", `idle_${id}`),
    });

    await ctx.api.sendMessage(language.edit, translation, {
      disable_web_page_preview: true,
      reply_to_message_id: messageId,
      reply_markup: new InlineKeyboard().text("Delete", "delete"),
    });

    await ctx.api.pinChatMessage(language.edit, messageId);
  }
});
