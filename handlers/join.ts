import * as log from "std/log/mod.ts";
import { Composer } from "grammy/mod.ts";
import { Context } from "../utils.ts";
import { INLINE_INVITE_LINK_NAME, languages, update } from "../data.ts";

const composer = new Composer<Context>();

export default composer;

composer.on("chat_member", async (ctx) => {
  if (
    ctx.chatMember.invite_link &&
    ctx.chatMember.invite_link.name == INLINE_INVITE_LINK_NAME
  ) {
    const lang = Object.entries(languages).find((v) => v[1].edit == ctx.chat.id)
      ?.[0];
    if (lang) {
      await ctx.promoteAuthor({
        can_delete_messages: true,
        can_edit_messages: true,
        can_pin_messages: true,
        can_post_messages: true,
      });
      if (languages[lang].translators.includes(ctx.chatMember.from.id)) {
        log.info(
          `Automatic promotion: ${ctx.chatMember.from.id} is already a translator in ${lang}.`,
        );
        return;
      }
      await update((languages) => {
        languages[lang].translators.push(ctx.chatMember.from.id);
      });
      log.info(
        `Automatic promotion: Promoted ${ctx.chatMember.from.id} in ${lang}.`,
      );
    }
  }
});
