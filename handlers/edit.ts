import { Composer, Context, p } from "$deps";
import { allChannels, channelNames } from "../data.ts";
import env from "../env.ts";

const composer = new Composer<Context>();

export default composer;

const ecp = composer.on("edited_channel_post");

ecp.use((ctx, next) => {
  if (allChannels.includes(ctx.chat.id)) {
    return next();
  }
});

ecp.use((ctx) => {
  const channel = channelNames[String(ctx.chat.id)];
  const { text, entities } = p.fmt`${
    p.link(
      ctx.msg.message_id,
      `https://t.me/c/${
        Math.abs(1000000000000 + ctx.chat.id)
      }/${ctx.msg.message_id}`,
    )
  } was edited in ${channel}.`;
  return ctx.api.sendMessage(env.NOTIFICATIONS_CHAT, text, { entities });
});
