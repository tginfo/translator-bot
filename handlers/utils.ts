import { Composer } from "grammy/mod.ts";
import { Context } from "../utils.ts";
import { smartypantsu } from "smartypants";

const composer = new Composer<Context>();

export default composer;

composer.command("fix_punctuation", async (ctx) => {
  const repliedMessage = ctx.msg.reply_to_message;
  if (repliedMessage) {
    if (repliedMessage.caption || repliedMessage.text) {
      const message = await ctx.copyMessage(ctx.chat.id);
      if (repliedMessage.text) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          message.message_id,
          smartypantsu(repliedMessage.text),
          { entities: repliedMessage.entities },
        );
      } else {
        await ctx.api.editMessageCaption(ctx.chat.id, message.message_id, {
          caption: smartypantsu(repliedMessage.caption),
          caption_entities: repliedMessage.caption_entities,
        });
      }
    }
  }
});
