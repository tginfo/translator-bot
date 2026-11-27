import * as log from "@std/log";
import { Composer } from "grammy/mod.ts";
import * as p from "grammy_parse_mode/mod.ts";
import {
  channels,
  languages,
  pilotChats,
  sudoers,
  trackedPosts,
  update,
  UploadedImageRecord,
} from "../data.ts";
import env from "../env.ts";
import {
  deleteUpstreamPostFromMiddleChannels,
  extractUpstreamPostReferenceFromReply,
  findTrackedMiddleMessage,
  findTrackedPostsByReference,
  findUpstreamChannel,
  formatDeleteSummaryLines,
  formatEditSummaryLines,
  getMiddleMessageKey,
  getTrackedPostKey,
  markMiddleMessageTouched,
  type MiddleEditApi,
  parseUpstreamPostReference,
  shouldMarkTouchedOnMiddleEdit,
  syncUpstreamEditToMiddleChannels,
} from "../middle_posts.ts";
import { Context, linkMessage } from "../utils.ts";
import {
  notifyPilotsLongCaption,
  uploadChannelPostImageToGhost,
} from "./translate.ts";

const composer = new Composer<Context>();

export default composer;

const pendingSyncFingerprints = new Map<string, string>();

composer.on("edited_channel_post", async (ctx) => {
  const editedPost = ctx.editedChannelPost;
  const upstreamChannel = findUpstreamChannel(channels, ctx.chat.id);

  if (upstreamChannel) {
    const postId = `${editedPost.message_id}-${upstreamChannel.name}`;
    const postKey = getTrackedPostKey(ctx.chat.id, editedPost.message_id);
    const trackedPost = trackedPosts[postKey];
    let summaryLines: string[] = [];

    if (trackedPost) {
      let uploadedImageRecord: UploadedImageRecord | undefined;

      const editApi: MiddleEditApi = {
        editMessageText: (chatId, messageId, content, other) =>
          typeof content === "string"
            ? ctx.api.editMessageText(chatId, messageId, content, other)
            : ctx.api.editMessageText(chatId, messageId, content, other),
        editMessageCaption: (chatId, messageId, other) =>
          ctx.api.editMessageCaption(chatId, messageId, other),
        editMessageMedia: (chatId, messageId, media, other) =>
          ctx.api.editMessageMedia(chatId, messageId, media, other),
        sendMessage: (chatId, text, other) =>
          ctx.api.sendMessage(chatId, text, other),
        deleteMessage: (chatId, messageId) =>
          ctx.api.deleteMessage(chatId, messageId),
      };

      const result = await syncUpstreamEditToMiddleChannels({
        trackedPost,
        editedPost,
        channel: upstreamChannel,
        api: editApi,
        pendingSyncFingerprints,
        uploadGhostImage: async () => {
          try {
            const uploaded = await uploadChannelPostImageToGhost(
              ctx,
              ctx.chat.id,
              upstreamChannel,
              editedPost,
              postId,
            );
            if (!uploaded) {
              return undefined;
            }
            uploadedImageRecord = uploaded.record;
            log.info(
              `Uploaded updated image for ${postId} to Ghost: ${uploaded.url}`,
            );
            return {
              url: uploaded.url,
              fileUniqueId: uploaded.record.telegramFileUniqueId ?? "",
            };
          } catch (err) {
            log.error(
              `Failed to upload updated image for ${postId} to Ghost: ${err}`,
            );
            return undefined;
          }
        },
      });

      if (uploadedImageRecord) {
        for (
          const [langId, middleMsg] of Object.entries(
            trackedPost.middleMessages,
          )
        ) {
          if (
            middleMsg.kind === "ghost_text" &&
            middleMsg.ghostImageUrl === uploadedImageRecord.url
          ) {
            uploadedImageRecord.forwardedMessages[langId] = {
              chatId: middleMsg.chatId,
              messageId: middleMsg.messageId,
            };
          }
        }
      }

      if (result.longCaptionUnhandled) {
        await notifyPilotsLongCaption(
          ctx,
          ctx.chat.id,
          upstreamChannel,
          postId,
        );
      }

      for (const failure of result.failed) {
        log.warning(
          `Failed to sync edit of ${postId} to ${failure.langId} middle: ${failure.error}`,
        );
      }

      if (result.mutated || uploadedImageRecord) {
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
              if (record) {
                uploadedImages.push(record);
              }
            },
          );
        } catch (err) {
          log.error(
            `Failed to save edit sync state for ${postId} to database: ${err}`,
          );
        }
      }

      summaryLines = formatEditSummaryLines(result);
      log.info(
        `Synced edit of ${postId}: ${
          summaryLines.length > 0 ? summaryLines.join("; ") : "no middle posts"
        }.`,
      );
    }

    const postUrl = linkMessage(ctx.chat.id, editedPost.message_id);
    const summarySuffix = summaryLines.length > 0
      ? `\n${summaryLines.join("\n")}`
      : "";
    const { text, entities } = p.fmt`${p.link(postUrl)}${editedPost.message_id}${
      p.link(postUrl)
    } was edited in ${upstreamChannel.name}.${summarySuffix}`;

    try {
      await ctx.api.sendMessage(env.NOTIFICATIONS_CHAT, text, { entities });
      log.info(`Sent notification for an edit in ${upstreamChannel.name}.`);
    } catch (err) {
      log.warning(
        `Failed to send notification for an edit in ${upstreamChannel.name}: ${err}`,
      );
    }
    return;
  }

  const isMiddleChannel = Object.values(languages).some(
    (lang) => lang.edit === ctx.chat.id,
  );
  if (!isMiddleChannel) {
    return;
  }

  const found = findTrackedMiddleMessage(
    trackedPosts,
    ctx.chat.id,
    editedPost.message_id,
  );
  if (!found) {
    return;
  }

  const middleKey = getMiddleMessageKey(ctx.chat.id, editedPost.message_id);
  if (
    shouldMarkTouchedOnMiddleEdit(
      found.middleMessage,
      editedPost,
      pendingSyncFingerprints.get(middleKey),
    )
  ) {
    try {
      await update((_l, _s, _sup, _us, _ui, posts) => {
        markMiddleMessageTouched(posts, ctx.chat.id, editedPost.message_id);
      });
      log.info(
        `Marked middle message ${editedPost.message_id} in ${found.langId} middle as touched (edited manually).`,
      );
    } catch (err) {
      log.warning(
        `Failed to persist touched state for middle message ${editedPost.message_id} in ${found.langId} middle: ${err}`,
      );
    }
  }
});

composer.command("delete", async (ctx) => {
  const isAuthorized = (ctx.from && sudoers.includes(ctx.from.id)) ||
    ctx.chat.id === pilotChats.ru ||
    ctx.chat.id === pilotChats.en ||
    ctx.chat.id === env.NOTIFICATIONS_CHAT;

  if (!isAuthorized) {
    return;
  }

  const arg = ctx.match.trim();
  const repliedMessage =
    ctx.msg.reply_to_message && !ctx.msg.reply_to_message.forum_topic_created
      ? ctx.msg.reply_to_message
      : undefined;
  const parsed = arg
    ? parseUpstreamPostReference(arg, channels)
    : repliedMessage
    ? extractUpstreamPostReferenceFromReply(repliedMessage, channels)
    : undefined;

  if (!parsed) {
    await ctx.reply(
      "Pass an upstream post link (e.g. /delete https://t.me/tginfo/1234, /delete https://t.me/c/1719500532/123, or /delete rualt 123) or reply to a forwarded upstream post or notification.",
    );
    return;
  }

  if ("error" in parsed) {
    await ctx.reply(parsed.error);
    return;
  }

  const matchedPosts = findTrackedPostsByReference(
    trackedPosts,
    parsed.chatId,
    parsed.messageId,
  );
  if (matchedPosts.length === 0) {
    await ctx.reply(
      `No tracked middle-channel messages found for ${parsed.channel.name} post ${parsed.messageId}.`,
    );
    return;
  }

  const deleteApi = {
    deleteMessage: (chatId: number, messageId: number) =>
      ctx.api.deleteMessage(chatId, messageId),
  };

  let anyMutated = false;
  const notifications: Array<{
    postUrl: string;
    messageId: number;
    channelName: string;
    summaryLines: string[];
  }> = [];

  for (const trackedPost of matchedPosts) {
    const result = await deleteUpstreamPostFromMiddleChannels({
      trackedPost,
      api: deleteApi,
    });

    for (const failure of result.failed) {
      log.warning(
        `Failed to delete ${trackedPost.upstreamMessageId}-${trackedPost.channelName} from ${failure.langId} middle: ${failure.error}`,
      );
    }

    if (result.mutated) {
      anyMutated = true;
    }

    const summaryLines = formatDeleteSummaryLines(result);
    log.info(
      `[${ctx.from?.id}] Processed /delete for ${trackedPost.upstreamMessageId}-${trackedPost.channelName}: ${
        summaryLines.length > 0 ? summaryLines.join("; ") : "none"
      }.`,
    );

    notifications.push({
      postUrl: linkMessage(
        trackedPost.upstreamChatId,
        trackedPost.upstreamMessageId,
      ),
      messageId: trackedPost.upstreamMessageId,
      channelName: trackedPost.channelName,
      summaryLines,
    });
  }

  if (anyMutated) {
    try {
      await update(() => {});
    } catch (err) {
      log.error(
        `Failed to save delete sync state for ${parsed.messageId}-${parsed.channel.name}: ${err}`,
      );
    }
  }

  for (const note of notifications) {
    const summarySuffix = note.summaryLines.length > 0
      ? `\n${note.summaryLines.join("\n")}`
      : "\nNo middle-channel copies found.";
    const { text, entities } = p.fmt`${p.link(note.postUrl)}${note.messageId}${
      p.link(note.postUrl)
    } was deleted in ${note.channelName}.${summarySuffix}`;

    await ctx.reply(text, { entities });

    if (ctx.chat.id !== env.NOTIFICATIONS_CHAT) {
      try {
        await ctx.api.sendMessage(env.NOTIFICATIONS_CHAT, text, { entities });
      } catch (err) {
        log.warning(
          `Failed to send deletion notification for ${note.channelName}: ${err}`,
        );
      }
    }
  }
});
