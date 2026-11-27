import * as log from "@std/log";
import { Composer, Filter, InlineKeyboard } from "grammy/mod.ts";
import {
  channels,
  copilotsChat,
  languages,
  pilotChats,
  update,
  UploadedImageRecord,
} from "../data.ts";
import env from "../env.ts";
import {
  getGhostConfig,
  isSupportedGhostImageMimeType,
  resolveImageFileInfo,
  uploadImageToGhost,
} from "../ghost.ts";
import {
  extractRichMessageHashtags,
  toInputRichMessage,
} from "../rich_message.ts";
import { Context, linkMessage } from "../utils.ts";

const MAX_CAPTION_LENGTH = 1024;

const composer = new Composer<Context>();

export default composer;

type ChannelPostContext = Filter<
  Context,
  "channel_post:text" | "channel_post:caption" | "channel_post:rich_message"
>;

function getUploadableImage(channelPost: ChannelPostContext["channelPost"]): {
  fileId: string;
  fileUniqueId: string;
  fileName?: string;
  mimeType?: string;
} | undefined {
  if (channelPost.photo?.length) {
    const largestPhoto = channelPost.photo[channelPost.photo.length - 1];
    return {
      fileId: largestPhoto.file_id,
      fileUniqueId: largestPhoto.file_unique_id,
    };
  }

  if (
    channelPost.document &&
    isSupportedGhostImageMimeType(channelPost.document.mime_type)
  ) {
    return {
      fileId: channelPost.document.file_id,
      fileUniqueId: channelPost.document.file_unique_id,
      fileName: channelPost.document.file_name,
      mimeType: channelPost.document.mime_type,
    };
  }

  return undefined;
}

async function notifyPilotsLongCaption(
  ctx: ChannelPostContext,
  channel: { name: string; flags?: string[] },
  postId: string,
) {
  try {
    const ru = ctx.chat.id in channels.ru;
    const chatId = pilotChats[ru ? "ru" : "en"];
    const isBetaChannel = channel.flags?.includes("beta");
    const isAltChannel = channel.flags?.includes("alt");
    const englishMessage =
      `🖼️⚠️ A post with a long caption was made in ${channel.name}. English editors are expected to forward an adapted version to enAlt.` +
      (isBetaChannel
        ? "\nℹ️ Reminder: Beta Info posts should be sent to enAlt with a #betainfo hashtag."
        : "") +
      (isAltChannel
        ? " \n🛑 THE POST WAS NOT FORWARDED TO TRANSLATORS. SEND A NEW POST TO ALT CHANNEL THAT FITS THE REQUIREMENTS."
        : "");
    await Promise.any([
      ctx.api.sendMessage(
        chatId,
        ru
          ? `🖼️⚠️ В ${channel.name} появилось сообщение с длинной надписью. Не забудьте переслать его в ruAlt с картинкой через ссылку.` +
            (isBetaChannel
              ? "\nℹ️ Напоминание: посты Beta Info нужно отправлять в ruAlt с хэштегом #betainfo."
              : "") +
            (isAltChannel
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
}

composer
  .on([
    "channel_post:text",
    "channel_post:caption",
    "channel_post:rich_message",
  ])
  .filter((ctx) =>
    Object.keys(channels.ru).concat(Object.keys(channels.en)).includes(
      String(ctx.chat.id),
    )
  )
  .use(async (ctx: ChannelPostContext) => {
    const channel = { ...channels.en, ...channels.ru }[ctx.chat.id];
    const hashtags = ctx.channelPost.rich_message
      ? extractRichMessageHashtags(ctx.channelPost.rich_message)
      : ctx.entities("hashtag").map((v) => v.text);
    const isBeta = channel.flags?.includes("beta") ||
      (channel.flags?.includes("alt") &&
        hashtags.some((v) => v == "#betainfo"));
    const postId = `${ctx.channelPost.message_id}-${channel.name}`;

    log.info(`Received a post from the ${channel.name}.`);

    if (
      hashtags.some((v) =>
        ["#ad", "#df", "#реклама", "#промо"].includes(v.toLowerCase())
      )
    ) {
      log.info(`Ignored ${postId}.`);
      return;
    }

    let ghostImageUrl: string | undefined;
    let uploadedImageRecord: UploadedImageRecord | undefined;

    if (
      ctx.channelPost.caption &&
      ctx.channelPost.caption.length > MAX_CAPTION_LENGTH
    ) {
      const ghostConfig = getGhostConfig(env);
      if (!ghostConfig) {
        log.info(`Ignored ${postId}: caption too long.`);
        await notifyPilotsLongCaption(ctx, channel, postId);
        return;
      }

      const uploadableImage = getUploadableImage(ctx.channelPost);
      if (!uploadableImage) {
        log.info(
          `Ignored ${postId}: caption too long and media is not a supported image.`,
        );
        await notifyPilotsLongCaption(ctx, channel, postId);
        return;
      }

      log.info(
        `Post ${postId} has a long caption (${ctx.channelPost.caption.length} chars); uploading image to Ghost...`,
      );
      try {
        const file = await ctx.api.getFile(uploadableImage.fileId);
        const response = await fetch(file.getUrl());
        if (!response.ok) {
          throw new Error(
            `Failed to download image from Telegram (${response.status} ${response.statusText}).`,
          );
        }

        const data = new Uint8Array(await response.arrayBuffer());
        const { filename, mimeType } = resolveImageFileInfo({
          filePath: file.file_path,
          fileName: uploadableImage.fileName,
          mimeType: uploadableImage.mimeType,
          responseContentType: response.headers.get("content-type"),
          fallbackBaseName: postId,
        });

        ghostImageUrl = await uploadImageToGhost(
          ghostConfig,
          {
            data,
            filename,
            mimeType,
            ref: postId,
          },
        );
        uploadedImageRecord = {
          url: ghostImageUrl,
          ref: postId,
          filename,
          mimeType,
          size: data.byteLength,
          telegramFileId: uploadableImage.fileId,
          telegramFileUniqueId: uploadableImage.fileUniqueId,
          uploadedAt: new Date().toISOString(),
          post: {
            id: postId,
            chatId: ctx.chat.id,
            channelName: channel.name,
            messageId: ctx.channelPost.message_id,
            url: linkMessage(ctx.chat.id, ctx.channelPost.message_id),
          },
          forwardedMessages: {},
        };
        log.info(`Uploaded image for ${postId} to Ghost: ${ghostImageUrl}`);
      } catch (err) {
        log.error(`Failed to upload image for ${postId} to Ghost: ${err}`);
        await notifyPilotsLongCaption(ctx, channel, postId);
        return;
      }
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
        const reply_markup = new InlineKeyboard()
	.url(
	  "View Post",
	  linkMessage(ctx.chat.id, ctx.channelPost.message_id)
	)
	.url(
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
        
        continue;
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

        if (ghostImageUrl) {
          const sent = await ctx.api.sendMessage(
            language.edit,
            ctx.channelPost.caption!,
            {
              entities: ctx.channelPost.caption_entities,
              link_preview_options: {
                url: ghostImageUrl,
                show_above_text: true,
                prefer_large_media: true,
              },
              reply_markup,
            },
          );
          if (uploadedImageRecord) {
            uploadedImageRecord.forwardedMessages[id] = {
              chatId: language.edit,
              messageId: sent.message_id,
            };
          }
        } else if (ctx.channelPost.rich_message) {
          try {
            await ctx.copyMessage(language.edit, {
              reply_markup,
            });
          } catch (copyErr) {
            log.warning(
              `copyMessage failed for rich post ${postId} to ${id} middle, falling back to sendRichMessage: ${copyErr}`,
            );
            await ctx.api.sendRichMessage(
              language.edit,
              toInputRichMessage(ctx.channelPost.rich_message),
              { reply_markup },
            );
          }
        } else {
          await ctx.copyMessage(language.edit, {
            reply_markup,
          });
        }

        log.info(`Copied ${postId} to ${id} middle.`);

        s++;
      } catch (err) {
        log.error(`Failed to copy ${postId} to ${id} middle: ${err}`);

        f++;
      }
    }

    if (uploadedImageRecord) {
      const record = uploadedImageRecord;
      try {
        await update(
          (
            _languages,
            _sudoers,
            _supervisors,
            _userSettings,
            uploadedImages,
          ) => {
            uploadedImages.push(record);
          },
        );
        log.info(`Saved uploaded image record for ${postId} to database.`);
      } catch (err) {
        log.error(
          `Failed to save uploaded image record for ${postId} to database: ${err}`,
        );
      }
    }

    const dt = (Date.now() - t1) / 1000;

    log.info(
      `Finished copying ${postId} to the middle channels in ${dt}s: ${s} succeeded and ${f} failed.`,
    );
  });
