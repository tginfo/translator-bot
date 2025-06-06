import { Composer } from "grammy/mod.ts";
import { Context } from "../utils.ts";
import { smartypantsu } from "smartypants";

const composer = new Composer<Context>();

export default composer;

composer.command(["fp", "fix_punctuation"], async (ctx) => {
  const repliedMessage = ctx.msg.reply_to_message;
  if (repliedMessage) {
    if (repliedMessage.caption || repliedMessage.text) {
      const hasLongCaption = repliedMessage.caption !== undefined &&
        repliedMessage.caption.length > 1_024;
      const isTextMessage = repliedMessage.text || hasLongCaption;
      const message = hasLongCaption
        ? await ctx.reply(repliedMessage.text ?? repliedMessage.caption ?? "", {
          entities: repliedMessage.entities ?? repliedMessage.caption_entities,
        })
        : await ctx.api.copyMessage(
          ctx.chat.id,
          ctx.chat.id,
          repliedMessage.message_id,
          { reply_to_message_id: repliedMessage.message_id },
        );
      const text = repliedMessage.text
        ? smartypantsu(repliedMessage.text)
        : smartypantsu(repliedMessage.text);
      if (text === repliedMessage.text || text === repliedMessage.caption) {
        await ctx.reply("Nothing to fix.");
        return;
      }
      if (isTextMessage) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          message.message_id,
          text,
          { entities: repliedMessage.entities },
        );
      } else {
        await ctx.api.editMessageCaption(ctx.chat.id, message.message_id, {
          caption: text,
          caption_entities: repliedMessage.caption_entities,
        });
      }
    }
  }
});
