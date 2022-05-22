import { error, info } from "https://deno.land/std@0.140.0/log/mod.ts";

import { Composer, InlineKeyboard } from "https://deno.land/x/grammy@v1.8.3/mod.ts";

import {
  enAlt,
  ruAlt,
  betainfo,
  betainfoen,
  languages,
  tginfo,
  tginfoen,
} from "../data.ts";

const composer = new Composer();

export default composer;

const allChannels = [enAlt, ruAlt, tginfo, betainfo, tginfoen, betainfoen];

const altChannels = [enAlt, ruAlt];

const betaChannels = [betainfo, betainfoen];

const keyChannels = {
  ru: [tginfo, betainfo],
  en: [tginfoen, betainfoen],
};

composer
  .on(["channel_post:text", "channel_post:caption"])
  .filter((ctx) => allChannels.includes(ctx.chat.id))
  .use(async (ctx) => {
    const isAlt = altChannels.includes(ctx.chat.id);
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

    info(`Received a post from the ${channel}.`);
    info(`Copying ${postId}...`);

    const t1 = Date.now();
    let s = 0;
    let f = 0;

    for (const id in languages) {
      const language = languages[id];

      if (!isAlt && !keyChannels[language.from].includes(ctx.chat.id)) {
        continue;
      }

      if (
        isAlt &&
        ((language.from == "ru" && ctx.chat.id != ruAlt) ||
          (language.from == "en" && ctx.chat.id != enAlt))
      ) {
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

        info(`Copied ${postId} to ${id} middle.`);

        s++;
      } catch (err) {
        error(`Failed to copy ${postId} to ${id} middle: ${err}`);

        f++;
      }
    }

    const dt = (Date.now() - t1) / 1000;

    info(
      `Finished copying ${postId} to the middle channels in ${dt}s: ${s} succeeded and ${f} failed.`
    );
  });
