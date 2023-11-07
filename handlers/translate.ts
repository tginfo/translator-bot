import * as log from "std/log/mod.ts";
import { Composer, InlineKeyboard } from "grammy/mod.ts";
import { channels, languages, pilotChats } from "../data.ts";

const composer = new Composer();

export default composer;

composer
  .on(["channel_post:text", "channel_post:caption"])
  .filter((ctx) =>
    Object.keys(channels.ru).concat(Object.keys(channels.en)).includes(
      String(ctx.chat.id),
    )
  )
  .use(async (ctx) => {
    const channel = { ...channels.en, ...channels.ru }[ctx.chat.id];
    const isBeta = channel.flags?.includes("beta") ||
      (channel.flags?.includes("alt") &&
        ctx.entities("hashtag").some((v) => v.text.toLowerCase() == "#beta"));
    const postId = `${ctx.channelPost.message_id}-${channel.name}`;

    log.info(`Received a post from the ${channel.name}.`);

    if (ctx.entities("hashtag").some((v) => v.text.toLowerCase() == "#df")) {
      log.info(`Ignored ${postId}.`);
      return;
    }

    if (ctx.channelPost.caption && ctx.channelPost.caption.length > 2048) {
      log.info(`Ignored ${postId}: caption too long.`);
      try {
        const ru = ctx.chat.id in channels.ru;
        const chatId = pilotChats[ru ? "ru" : "en"];
        await ctx.api.sendMessage(
          chatId,
          ru
            ? `В ${channel.name} появилось сообщение с длинной надписью.`
            : `A post with a long caption was made in ${channel.name}.`,
        );
        log.info(`Pilots were notified of ${postId}.`);
      } catch (err) {
        log.info(`Failed to notify pilots of ${postId}: ${err}`);
      }
      return;
    }

    log.info(`Copying ${postId}...`);

    const t1 = Date.now();
    let s = 0;
    let f = 0;

    for (const id in languages) {
      const language = languages[id];

      if (!Object.keys(channels[language.from]).includes(String(ctx.chat.id))) {
        continue;
      }

      try {
        await ctx.copyMessage(language.edit, {
          reply_markup: new InlineKeyboard()
            .text("Translate", "translate")
            .row()
            .text(
              `Send to ${isBeta ? "Beta" : "Main"} Channel`,
              `send_${isBeta ? "beta" : "tg"}`,
            )
            .row()
            .text("Idle", "idle"),
        });

        log.info(`Copied ${postId} to ${id} middle.`);

        s++;
      } catch (err) {
        log.error(`Failed to copy ${postId} to ${id} middle: ${err}`);

        f++;
      }
    }

    const dt = (Date.now() - t1) / 1000;

    log.info(
      `Finished copying ${postId} to the middle channels in ${dt}s: ${s} succeeded and ${f} failed.`,
    );
  });
