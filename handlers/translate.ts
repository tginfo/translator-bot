import { Composer, InlineKeyboard } from "https://deno.land/x/grammy/mod.ts";
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

const allChannels = [alt, tginfo, betainfo, tginfoen, betainfoen];

const betaChannels = [betainfo, betainfoen];

const keyChannels = {
  "ru": [tginfo, betainfo],
  "en": [tginfoen, betainfoen],
};

composer.on(["channel_post:text", "channel_post:caption"]).filter((
  ctx,
) => allChannels.includes(ctx.chat.id)).use(async (ctx) => {
  const isAlt = ctx.chat.id == alt;
  const isBeta = betaChannels.includes(ctx.chat.id);

  for (const id in languages) {
    const language = languages[id];

    if (!isAlt && !keyChannels[language.from].includes(ctx.chat.id)) {
      continue;
    }

    await ctx.copyMessage(language.edit, {
      reply_markup: new InlineKeyboard().text("translate").row().text(
        `Send to ${isBeta ? "Beta" : "Main"} Channel`,
        `send_${isBeta ? "beta" : "tg"}}`,
      ).row().text("Idle", `idle_${id}`),
    });
  }
});
