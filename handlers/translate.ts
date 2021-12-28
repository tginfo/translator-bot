import { Composer, InlineKeyboard } from "https://deno.land/x/grammy/mod.ts";
import { GTR } from "https://deno.land/x/gtr/mod.ts";
import { languages } from "../database/mod.ts";

const composer = new Composer();

export default composer;

const gtr = new GTR();

const alt = -1001253459535;

const tginfo = 1001003307527;
const betainfo = -1001313913616;

const tginfoen = -1001263222189;
const betainfoen = -1001335406586;

const froms = [alt, tginfo, betainfo, tginfoen, betainfoen];

const betas = [betainfo, betainfoen];

const keyFroms = {
  "ru": [tginfo, betainfo],
  "en": [tginfoen, betainfoen],
};

composer.on(["channel_post:text", "channel_post:caption"]).filter((ctx) =>
  froms.includes(ctx.chat.id)
).use(async (ctx) => {
  const text = ctx.channelPost.text || ctx.channelPost.caption!;
  const isAlt = ctx.chat.id == alt;
  const isBeta = betas.includes(ctx.chat.id);

  for (const language of await languages.getAll()) {
    if (!isAlt && !keyFroms[language.from].includes(ctx.chat.id)) {
      continue;
    }

    let translation;

    try {
      const result = await gtr.translate(text, {
        targetLang: language.targetLang ?? language.id,
        sourceLang: language.from,
      });

      translation = result.trans.replace(/> /g, ">")
        .replace(/# /g, "#")
        .replace(/ < \/ a>/g, "</a>")
        .replace(/< \/ a>/g, "</a>");
    } catch (_err) {
      translation = text;
    }

    const replyMarkup = isAlt ? undefined : new InlineKeyboard().text(
      `Send to @${isBeta ? "beta" : "tg"}info${language.id}`,
      `${isBeta ? "beta" : "tg"}_${language.id}`,
    ).row().url(
      "Original Message",
      `https://t.me/${
        String(ctx.chat.id).slice(4)
      }/${ctx.channelPost.message_id}`,
    ).row().text("Idle", "idle");

    if (ctx.channelPost.caption) {
      try {
        await ctx.copyMessage(language.edit, {
          caption: translation,
          reply_markup: replyMarkup,
        });
      } catch (_err) {
        await ctx.api.sendMessage(language.edit, translation);
      }
    } else {
      await ctx.api.sendMessage(language.edit, translation);
    }
  }
});
