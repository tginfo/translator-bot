import { Composer } from "grammy/mod.ts";
import { smartypantsu } from "smartypants";
import { fixPunctuationInTextAndEntities } from "../entities_html.ts";
import { createPlainTextSmartypants } from "../html_common.ts";
import { fixPunctuationInRichMessage } from "../rich_message.ts";
import { Context } from "../utils.ts";

const fixSmartTypography = createPlainTextSmartypants(smartypantsu);

const composer = new Composer<Context>();

export default composer;

composer.command(["fp", "fix_punctuation"], async (ctx) => {
  const repliedMessage = ctx.msg.reply_to_message;
  if (!repliedMessage) return;

  if (repliedMessage.rich_message) {
    const { richMessage, changed } = fixPunctuationInRichMessage(
      repliedMessage.rich_message,
      fixSmartTypography,
    );
    if (!changed) {
      await ctx.reply("Nothing to fix.");
      return;
    }
    await ctx.replyWithRichMessage(richMessage, {
      reply_parameters: { message_id: repliedMessage.message_id },
    });
    return;
  }

  if (repliedMessage.caption || repliedMessage.text) {
    const sourceText = repliedMessage.text ?? repliedMessage.caption ?? "";
    const sourceEntities = repliedMessage.entities ??
      repliedMessage.caption_entities ?? [];
    const { text, entities, changed } = fixPunctuationInTextAndEntities(
      sourceText,
      sourceEntities,
      fixSmartTypography,
    );

    if (!changed) {
      await ctx.reply("Nothing to fix.");
      return;
    }

    const hasLongCaption = repliedMessage.caption !== undefined &&
      repliedMessage.caption.length > 1_024;
    if (hasLongCaption) {
      await ctx.reply(text, {
        entities,
        reply_parameters: { message_id: repliedMessage.message_id },
      });
      return;
    }

    const isTextMessage = repliedMessage.text !== undefined;
    const message = await ctx.api.copyMessage(
      ctx.chat.id,
      ctx.chat.id,
      repliedMessage.message_id,
      { reply_parameters: { message_id: repliedMessage.message_id } },
    );

    if (isTextMessage) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        message.message_id,
        text,
        {
          entities,
          link_preview_options: repliedMessage.link_preview_options,
        },
      );
    } else {
      await ctx.api.editMessageCaption(ctx.chat.id, message.message_id, {
        caption: text,
        caption_entities: entities,
      });
    }
  }
});
