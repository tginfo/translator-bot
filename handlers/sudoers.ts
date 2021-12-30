import { Composer, InputFile } from "https://deno.land/x/grammy/mod.ts";
import { dump, languages, sudoers, updateData } from "../data.ts";
import { getUserLink, log } from "../utils.ts";
import { Context } from "../context.ts";

const composer = new Composer<Context>();

export default composer;

const su = composer.filter((
  ctx,
): ctx is typeof ctx & { from: NonNullable<typeof ctx["from"]> } =>
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

  const result = await updateData(data);

  if (result) {
    await ctx.reply("Data updated.");
    log(`Data updated.`, "primary");
    return;
  }

  await ctx.reply("Data not updated.");
  log(`Data not updated.`, "primary");
});

su.command("export", (ctx) => {
  return ctx.replyWithDocument(
    new InputFile(
      dump(),
      "data.json",
    ),
  );
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
