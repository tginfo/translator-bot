import { Composer } from "https://deno.land/x/grammy/mod.ts";
import { sudoers, updateData } from "../data.ts";
import { log } from "../utils.ts";

const composer = new Composer();

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
