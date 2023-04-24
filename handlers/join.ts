import { Composer } from "grammy/mod.ts";
import { Context } from "../utils.ts";
import { INLINE_INVITE_LINK_NAME } from "../data.ts";

const composer = new Composer<Context>();

export default composer;

composer.on("chat_member", async (ctx) => {
  if (
    ctx.chatMember.invite_link &&
    ctx.chatMember.invite_link.name == INLINE_INVITE_LINK_NAME
  ) {
    await ctx.promoteAuthor({
      can_delete_messages: true,
      can_edit_messages: true,
      can_pin_messages: true,
      can_post_messages: true,
    });
  }
});
