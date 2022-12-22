import * as log from "std/log/mod.ts";
import { MINUTE } from "std/datetime/mod.ts";
import { Composer, InputFile } from "grammy/mod.ts";
import * as p from "grammy_parse_mode/mod.ts";
import { Context, getUserLink } from "../utils.ts";
import {
  dump,
  languages,
  sudoers,
  support,
  update,
  updateWithFileData,
} from "../data.ts";

const composer = new Composer<Context>();

export default composer;

const su = composer.filter(
  (ctx): ctx is typeof ctx & { from: NonNullable<typeof ctx["from"]> } =>
    !!ctx.from && sudoers.includes(ctx.from.id),
);

su.command("import", async (ctx) => {
  const document = ctx.message?.reply_to_message?.document;

  if (!document || document.mime_type != "application/json") {
    await ctx.reply("Reply a json file.");
    return;
  }

  const url = (await ctx.api.getFile(document.file_id)).getUrl();

  log.info("Received a request to update data.");

  let data;

  try {
    data = await (await fetch(url)).json();
  } catch (err) {
    await ctx.reply(`An error occurred.\n\n${err}`);
    log.warning(`Failed to fetch the URL: ${err}`);
    return;
  }

  const result = await updateWithFileData(data);

  if (result) {
    await ctx.reply("Data updated.");
    log.info("Data updated.");
    return;
  }

  await ctx.reply("Data not updated.");
  log.info("Data not updated.");
});

su.command("export", (ctx) => {
  return ctx.replyWithDocument(new InputFile(dump(), "data.json"));
});

su.command("add", async (ctx) => {
  const id = ctx.message.text.split(/\s/)[1];
  const translator = ctx.message.reply_to_message?.from?.id;

  if (!id || !translator) {
    await ctx.reply("Reply to someone and pass the language ID.");
    return;
  }

  const language = languages[id];

  if (typeof language === "undefined") {
    await ctx.reply(`Language ${id} not found.`);
    return;
  }

  if (language.translators.includes(translator)) {
    await ctx.reply("The replied user is already a translator.");
    return;
  }

  await update((languages) => {
    languages[id].translators.push(translator);
  });

  log.info(`Added ${translator} to ${id}.`);

  try {
    await ctx.api.promoteChatMember(languages[id].edit, translator, {
      can_edit_messages: true,
      can_delete_messages: true,
      can_post_messages: true,
    });
    log.info(`Promoted ${translator} in ${id}.`);
  } catch (err) {
    log.warning(`Could not promote ${translator} in ${id}: ${err}`);
  }

  await ctx.reply(`Added to ${id}.`);
});

su.command("rm", async (ctx) => {
  const id = ctx.message.reply_to_message?.text?.match(
    /target language: (..)/i,
  )![1];

  const translatorsToRemove = ctx.message.text
    .split(/\s/)
    .map(Number)
    .filter((t) => t);

  if (!id || translatorsToRemove.length == 0) {
    await ctx.reply(
      "Reply to the stats message and pass the IDs of the translators.",
    );
    return;
  }

  const language = languages[id];

  if (typeof language === "undefined") {
    await ctx.reply(`Language ${id} not found.`);
    return;
  }

  const newTranslators = language.translators.filter(
    (t) => !translatorsToRemove.includes(t),
  );

  const diff = language.translators.length - newTranslators.length;

  const diffText = (diff == 1 ? "a" : diff) + " " + "translator" +
    (diff == 1 ? "" : "s");

  if (diff == 0) {
    await ctx.reply("No changes were made.");
    return;
  }

  await update((languages) => {
    languages[id].translators = newTranslators;
  });

  log.info(`Removed ${diffText} from ${id}.`);
  await ctx.reply(`Removed ${diffText} from ${id}.`);
});

su.command("stats", async (ctx) => {
  const id = ctx.message.text.split(/\s/)[1];

  if (id) {
    const language = languages[id];

    if (language) {
      await ctx.reply(
        `From: ${language.from}\n` +
          `Target language: ${language.targetLang ?? id}\n` +
          `Edit: ${language.edit}\n` +
          (language.group ? `Group: ${language.group}\n` : "") +
          `Main: ${language.main}\n` +
          `Beta: ${language.beta}\n` +
          `Translators: ${
            language.translators.length == 0
              ? "None"
              : language.translators.map(getUserLink).join(", ")
          }`,
        { parse_mode: "HTML" },
      );
    } else {
      await ctx.reply(`Language ${id} not found.`);
    }

    return;
  }

  await ctx.reply(
    `Sudoers: ${
      sudoers.map(getUserLink).join(", ")
    } (${sudoers.length})\n\nLanguages: ${Object.keys(languages).join(", ")} (${
      Object.keys(languages).length
    })`,
    { parse_mode: "HTML" },
  );
});

su.command("broadcast", async (ctx) => {
  const message = ctx.message.reply_to_message;

  if (!message) {
    await ctx.reply("Reply a message to broadcast.");
    return;
  }

  const messageId = `message ${message.message_id} of chat ${ctx.chat.id}`;

  log.info(`Broadcasting ${messageId}...`);

  const t1 = Date.now();
  let s = 0;
  let f = 0;

  for (const id in languages) {
    const language = languages[id];

    try {
      await ctx.api.forwardMessage(
        language.edit,
        ctx.chat.id,
        message.message_id,
      );

      log.info(`Forwarded ${messageId} to ${id} middle.`);

      s++;
    } catch (err) {
      log.error(`Failed to forward ${messageId} to ${id} middle: ${err}`);

      f++;
    }
  }

  const dt = (Date.now() - t1) / 1000;

  log.info(
    `Finished broadcasting ${messageId} to the middle channels in ${dt}s: ${s} succeeded and ${f} failed.`,
  );

  await ctx.reply(
    `Broadcast complete.\nFailed forwards: ${f}\nSucceeded forwards: ${s}\nTime elapsed: ${dt}s`,
  );
});

su.inlineQuery(
  /^invite ([a-z]{2,3}) ([1-9]+) ([0-9]+) (welcome|links)$/,
  async (ctx) => {
    const args = ctx.match!;
    const id = args[1];
    const memberLimit = Number(args[2]);
    const minutes = Number(args[3]);
    const responseType = args[4] as "welcome" | "links";

    const language = languages[id];

    if (language) {
      const inviteLinks = new Array<string>();
      const chatIds = [
        language.edit,
        ...(language.group ? [language.group] : []),
        support,
      ];

      for (const chatId of chatIds) {
        const { invite_link } = await ctx.api.createChatInviteLink(
          chatId,
          {
            member_limit: memberLimit,
            expire_date: minutes == 0
              ? undefined
              : ((Date.now() + minutes * MINUTE) / 1000),
          },
        );
        inviteLinks.push(invite_link);
      }

      const { text, entities } = responseType == "links"
        ? p.fmt`${inviteLinks.join("\n")}`
        : p
          .fmt`Great! You can get started right away by joining the following chats:

${p.bold("Middle channel")}
${inviteLinks[0]}
Here the bot sends the posts to be translated, you edit the messages there and press a button to get them posted.

${
          inviteLinks.length == 3
            ? p.fmt`${p.bold("Local translators discussion group")}
${inviteLinks[1]}
This is your language-specific chat where you interact with other translators of your language. As soon as you will join the chat, we will grant you permissions to translate the posts.`
            : ""
        }

${p.bold("All translators chat")}
${inviteLinks[inviteLinks.length - 1]}
In this chat you can ask for help, get answers to your questions from the tginfo crew and other volunteers. We may also make announcements there and post additional materials.`;

      await ctx.answerInlineQuery([{
        id: crypto.randomUUID(),
        type: "article",
        title: "Links",
        input_message_content: { message_text: text, entities },
      }], { cache_time: 15 });
    }
  },
);
