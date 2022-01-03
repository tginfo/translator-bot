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

    const postId = `${ctx.channelPost.message_id}-${
      keyChannels.en.includes(ctx.chat.id)
        ? "en"
        : keyChannels.ru.includes(ctx.chat.id)
        ? "ru"
        : "alt"
    }-${isBeta ? "beta" : ""}`;

    const channel =
      (keyChannels.en.includes(ctx.chat.id)
        ? "English"
        : keyChannels.ru.includes(ctx.chat.id)
        ? "Russian"
        : "alt") + ` ${isBeta ? "beta " : ""}channel`;

    log(`Received a post from the ${channel}.`, "primary");
    log(`Copying ${postId}...`, "primary");

    const t1 = Date.now();
    let s = 0;
    let f = 0;

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
            .text(
              `Send to ${isBeta ? "Beta" : "Main"} Channel`,
              `send_${isBeta ? "beta" : "tg"}`
            )
            .row()
            .text("Idle", `idle`),
        });

        log(`Copied ${postId} to ${id} middle.`, "success");

        s++;
      } catch (err) {
        log(
          `Failed to copy ${postId} to ${id} middle: ${err}`,
          "error"
        );

        f++;
      }
    }

    const dt = (Date.now() - t1) / 1000;

    log(
      `Finished copying ${postId} to the middle channels in ${dt}s: ${s} succeeded and ${f} failed.`,
      "primary"
    );
  });
