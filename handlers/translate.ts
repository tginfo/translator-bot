import * as log from "@std/log";
import { Composer, InlineKeyboard, Filter, Context } from "grammy/mod.ts";
import { channels, copilotsChat, languages, pilotChats } from "../data.ts";
import env from "../env.ts";
import { linkMessage } from "../utils.ts";

const composer = new Composer();

export default composer;

composer
  .on(["channel_post:text", "channel_post:caption"])
  .filter((ctx) =>
    Object.keys(channels.ru).concat(Object.keys(channels.en)).includes(
      String(ctx.chat.id),
    )
  )
  .use(async (ctx: Filter<Context, "channel_post:text" | "channel_post:caption">) => {
    const channel = { ...channels.en, ...channels.ru }[ctx.chat.id];
    const isBeta = channel.flags?.includes("beta") ||
      (channel.flags?.includes("alt") &&
        ctx.entities("hashtag")
          .some((v) => v.text == "#betainfo"));
    const postId = `${ctx.channelPost.message_id}-${channel.name}`;

    log.info(`Received a post from the ${channel.name}.`);

    if (
      ctx.entities("hashtag").some((v) =>
        ["#ad", "#df", "#реклама", "#промо"].includes(v.text.toLowerCase())
      )
    ) {
      log.info(`Ignored ${postId}.`);
      return;
    }

    if (ctx.channelPost.caption && ctx.channelPost.caption.length > 1048) {
      log.info(`Ignored ${postId}: caption too long.`);
      try {
        const ru = ctx.chat.id in channels.ru;
        const chatId = pilotChats[ru ? "ru" : "en"];
        const englishMessage =
            `🖼️⚠️ A post with a long caption was made in ${channel.name}.` +
            (channel.flags?.includes("alt")
                ? " \n🛑 THE POST WAS NOT FORWARDED TO TRANSLATORS. SEND A NEW POST TO ALT CHANNEL THAT FITS THE REQUIREMENTS."
                : "");
        await Promise.any([
          ctx.api.sendMessage(
            chatId,
            ru
              ? `🖼️⚠️ В ${channel.name} появилось сообщение с длинной надписью.` + 
                (channel.flags?.includes("alt")
                  ? " \n🛑 ПОСТ НЕ ПЕРЕСЛАН ПЕРЕВОДЧИКАМ. ИСПРАВЬТЕ ПОСТ И ОТПРАВЬТЕ ЕГО В АЛЬТ КАНАЛ ЗАНОВО."
                  : "")
              : englishMessage,
          ),
          ctx.api.sendMessage(env.NOTIFICATIONS_CHAT, englishMessage),
          ctx.api.sendMessage(copilotsChat, englishMessage),
        ]);
        log.info(`Pilots were notified of ${postId}.`);
      } catch (err) {
        log.info(`Failed to notify pilots of ${postId}: ${err}`);
      }
      return;
    }

    const ru = ctx.chat.id in channels.ru;
    if (ru && ctx.channelPost.reply_to_message) {
      log.info(
        `Notifying English pilots about ${postId}: replies to another post.`,
      );
      try {
        const chatId = pilotChats.en;
        const englishMessage =
          `🖼️⚠️ The last post in ${channel.name} replies to another post.`;
        const reply_markup = new InlineKeyboard().url(
          "View Replied Post",
          linkMessage(ctx.chat.id, ctx.channelPost.reply_to_message.message_id),
        );
        await Promise.any([
          ctx.api.sendMessage(chatId, englishMessage, { reply_markup }),
          ctx.api.sendMessage(env.NOTIFICATIONS_CHAT, englishMessage, {
            reply_markup,
          }),
          ctx.api.sendMessage(copilotsChat, englishMessage, { reply_markup }),
        ]);
        log.info(`Pilots were notified of ${postId}.`);
      } catch (err) {
        log.info(`Failed to notify pilots of ${postId}: ${err}`);
      }
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

      // Some translators want to post APKs in Beta Info channel immediately,
      // without translating the changelogs.
      if (isBeta && ctx.msg.document && language.shouldBetaApkSkipMiddleChannel) {
        log.info(`A file was posted (${postId}) to Beta and language ${id} has auto APK enabled`)
        const fileName = ctx.msg.document.file_name;
        
        if (fileName && fileName.toLowerCase().endsWith(".apk")) {
          log.info(`Detected the file to be an APK, posting to ${language.beta}`)
          try {
            await ctx.copyMessage(language.beta);
          } catch (e) {
            log.error(`Failed to post APK ${postId}: ${e}`);
          }
        } else {
          log.info("Detected the file to not be an APK, skipping auto-post")
        }
        
        return;
      }

      try {
        const reply_markup = new InlineKeyboard()
          .text("Translate", "translate")
          .row()
          .text(
            `Send to ${isBeta ? "Beta" : "Main"} Channel`,
            `send_${isBeta ? "beta" : "tg"}`,
          );

        if (ctx.channelPost.reply_to_message) {
          reply_markup
            .row()
            .url(
              "View Replied Post",
              linkMessage(
                ctx.chat.id,
                ctx.channelPost.reply_to_message.message_id,
              ),
            );
        }

        reply_markup
          .row()
          .text("Idle", "idle");

        await ctx.copyMessage(language.edit, {
          reply_markup,
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
