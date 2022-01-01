import { Composer, InlineKeyboard } from "https://deno.land/x/grammy/mod.ts";
import { log } from "../utils.ts";
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
  ru: [tginfo, betainfo],
  en: [tginfoen, betainfoen],
};

composer
  .on(["channel_post:text", "channel_post:caption"])
  .filter((ctx) => allChannels.includes(ctx.chat.id))
  .use(async (ctx) => {
    const isAlt = ctx.chat.id == alt;
    const isBeta = betaChannels.includes(ctx.chat.id);

    log(
      `Received a post [${ctx.channelPost.message_id}] from the ` +
        (keyChannels.en.includes(ctx.chat.id)
          ? "English"
          : keyChannels.ru.includes(ctx.chat.id)
          ? "Russian"
          : isAlt
          ? "alt"
          : "") +
        ` ${isBeta ? "beta " : ""}channel.`,
      "primary",
    );

    for (const id in languages) {
      const language = languages[id];

      if (!isAlt && !keyChannels[language.from].includes(ctx.chat.id)) {
        continue;
      }

      try {
        await ctx.copyMessage(language.edit, {
          reply_markup: new InlineKeyboard()
          .text("Translate", "translate")
          .row()
          .text("Translate (Alt)", "alt-translate")
          .row()
            .text(
              `Send to ${isBeta ? "Beta" : "Main"} Channel`,
              `send_${isBeta ? "beta" : "tg"}`,
            )
            .row()
            .text("Idle", `idle`),
        });

        log(`Copied ${ctx.channelPost.message_id} to ${id} middle.`, "success");
      } catch (err) {
        log(
          `Failed to copy ${ctx.channelPost.message_id} to ${id} middle: ${err}`,
          "error",
        );
      }
    }
  });
