import { Composer, InputFile } from "https://deno.land/x/grammy/mod.ts";
import {
  dump,
  languages,
  sudoers,
  update,
  updateWithFileData,
} from "../data.ts";
import { getUserLink, log } from "../utils.ts";
import { Context } from "../context.ts";

const composer = new Composer<Context>();

export default composer;

const su = composer.filter(
  (ctx): ctx is typeof ctx & { from: NonNullable<typeof ctx["from"]> } =>
    !!ctx.from && sudoers.includes(ctx.from.id)
);

su.command("import", async (ctx) => {
  const document = ctx.message?.reply_to_message?.document;

  if (!document || document.mime_type != "application/json") {
    await ctx.reply("Reply a json file.");
    return;
  }

  const url = (await ctx.api.getFile(document.file_id)).getUrl();

  log(`Received a request to update data.`, "primary");

  let data;

  try {
    data = await (await fetch(url)).json();
  } catch (err) {
    await ctx.reply(`An error occurred.\n\n${err}`);
    log(`Failed to fetch the URL: ${err}`, "warning");
    return;
  }

  const result = await updateWithFileData(data);

  if (result) {
    await ctx.reply("Data updated.");
    log(`Data updated.`, "primary");
    return;
  }

  await ctx.reply("Data not updated.");
  log(`Data not updated.`, "primary");
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

  log(`Added ${translator} to ${id}.`, "primary");
  await ctx.reply(`Added to ${id}.`);
});

su.command("rm", async (ctx) => {
  const id = ctx.message.reply_to_message?.text?.match(
    /target language: (..)/i
  )![1];

  const translatorsToRemove = ctx.message.text
    .split(/\s/)
    .map(Number)
    .filter((t) => t);

  if (!id || translatorsToRemove.length == 0) {
    await ctx.reply(
      "Reply to the stats message and pass the IDs of the translators."
    );
    return;
  }

  const language = languages[id];

  if (typeof language === "undefined") {
    await ctx.reply(`Language ${id} not found.`);
    return;
  }

  const newTranslators = language.translators.filter(
    (t) => !translatorsToRemove.includes(t)
  );

  const diff = language.translators.length - newTranslators.length;

  const diffText =
    (diff == 1 ? "a" : diff) + " " + "translator" + (diff == 1 ? "" : "s");

  if (diff == 0) {
    await ctx.reply(`No changes were made.`);
    return;
  }

  await update((languages) => {
    languages[id].translators = newTranslators;
  });

  log(`Removed ${diffText} from ${id}.`, "primary");
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
          `Main: ${language.main}\n` +
          `Beta: ${language.beta}\n` +
          `Translators: ${
            language.translators.length == 0
              ? "None"
              : language.translators.map(getUserLink).join(", ")
          }`,
        { parse_mode: "HTML" }
      );
    } else {
      await ctx.reply(`Language ${id} not found.`);
    }

    return;
  }

  await ctx.reply(
    `Sudoers: ${sudoers.map(getUserLink).join(", ")} (${
      sudoers.length
    })\n\nLanguages: ${Object.keys(languages).join(", ")} (${
      Object.keys(languages).length
    })`,
    { parse_mode: "HTML" }
  );
});

su.command("broadcast", async (ctx) => {
  const message = ctx.message.reply_to_message;

  if (!message) {
    await ctx.reply("Reply a message to broadcast.");
    return;
  }

  const messageId = `message ${message.message_id} of chat ${ctx.chat.id}`;

  log(`Broadcasting ${messageId}...`, "primary");

  const t1 = Date.now();
  let s = 0;
  let f = 0;

  for (const id in languages) {
    const language = languages[id];

    try {
      await ctx.api.forwardMessage(
        language.edit,
        ctx.chat.id,
        message.message_id
      );

      log(`Forwarded ${messageId} to ${id} middle.`, "success");

      s++;
    } catch (err) {
      log(`Failed to forward ${messageId} to ${id} middle: ${err}`, "error");

      f++;
    }
  }

  const dt = (Date.now() - t1) / 1000;

  log(
    `Finished broadcasting ${messageId} to the middle channels in ${dt}s: ${s} succeeded and ${f} failed.`,
    "primary"
  );

  await ctx.reply(
    `Broadcast complete.\nFailed forwards: ${f}\nSucceeded forwards: ${s}\nTime elapsed: ${dt}s`
  );
});
