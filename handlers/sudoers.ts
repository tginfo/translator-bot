import { Composer } from "https://deno.land/x/grammy/mod.ts";
import { languages, sudoers, updateData } from "../data.ts";
import { getUserLink, log } from "../utils.ts";

const composer = new Composer();

export default composer;

const su = composer.filter((
  ctx,
): ctx is typeof ctx & { from: NonNullable<typeof ctx["from"]> } =>
  !!ctx.from && sudoers.includes(ctx.from.id)
);

su.command("update", async (ctx) => {
  const url = ctx.message?.text.split(/\s/)[1];

  if (!url) {
    await ctx.reply("URL not provided.");
    return;
  }

  log(`Received a URL to update data.`, "primary");

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
    `Languages: ${Object.keys(languages).length}\nSudoers: ${
      sudoers.map(getUserLink).join(", ")
    }`,
  );
});
