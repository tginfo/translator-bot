import type { TrackedPost } from "./middle_posts.ts";

type Sudoer = number;

export interface Language {
  from: "en" | "ru";
  targetLang?: string;
  edit: number;
  group?: number;
  translators: number[];
  main: number;
  beta: number;
  supervisorsEnabled?: boolean;
  shouldBetaApkSkipMiddleChannel?: boolean;
}

export type Supervisors = Record<string, number[] | undefined>;
export type UserSettings = { cloudTranslateQuota?: number, cloudTranslateQuotaDuration?: number };

export interface UploadedImageRecord {
  url: string;
  ref: string;
  filename: string;
  mimeType: string;
  size: number;
  telegramFileId: string;
  telegramFileUniqueId?: string;
  uploadedAt: string;
  post: {
    id: string;
    chatId: number;
    channelName: string;
    messageId: number;
    url: string;
  };
  forwardedMessages: Record<string, { chatId: number; messageId: number }>;
}

let paths = new Array<string>();

for await (const entry of Deno.readDir("./")) {
  if (
    !entry.isFile ||
    !entry.name.startsWith("data") ||
    !entry.name.endsWith(".json") ||
    entry.name == "data.json"
  ) {
    continue;
  }

  paths.push(entry.name);
}

paths = paths.filter((p) => p != "data.json");

paths.sort(
  (a, b) =>
    Number(a.replace(".json", "").split("-")[1]) -
    Number(b.replace(".json", "").split("-")[1]),
);

const path = paths.slice(-1)[0] || "data.json";

const data = JSON.parse(await Deno.readTextFile(path));

export const languages: Record<string, Language> = data.languages;

export const sudoers: Sudoer[] = data.sudoers;

export const supervisors: Supervisors = data.supervisors ?? [];

export const userSettings: Record<string, UserSettings> = data.userSettings ?? {};

export const uploadedImages: UploadedImageRecord[] = data.uploadedImages ?? [];

export const trackedPosts: Record<string, TrackedPost> = data.trackedPosts ?? {};

export const support = -1001266712138;

export const channels: Record<
  string,
  Record<string, { name: string; flags?: string[] }>
> = {
  ru: {
    "-1001003307527": { name: "@tginfo" },
    "-1001313913616": { name: "@betainfo", flags: ["beta"] },
    "-1001719500532": { name: "rualt", flags: ["alt"] },
  },
  en: {
    "-1001263222189": { name: "@tginfoen" },
    "-1001335406586": { name: "@betainfoen", flags: ["beta"] },
    "-1001253459535": { name: "enalt", flags: ["alt"] },
  },
};

export async function update(
  func: (
    languages: Record<string, Language>,
    sudoers: Sudoer[],
    supervisors: Supervisors,
    userSettings: Record<string, UserSettings>,
    uploadedImages: UploadedImageRecord[],
    trackedPosts: Record<string, TrackedPost>,
  ) => Promise<void> | void,
) {
  const result = func(
    languages,
    sudoers,
    supervisors,
    userSettings,
    uploadedImages,
    trackedPosts,
  );

  result instanceof Promise && (await result);

  await Deno.writeTextFile(
    `data-${Date.now()}.json`,
    JSON.stringify({
      languages,
      sudoers,
      supervisors,
      userSettings,
      uploadedImages,
      trackedPosts,
    }),
  );
}

// deno-lint-ignore no-explicit-any
export async function updateWithFileData(data: any) {
  if (typeof data.languages === "object" && Array.isArray(data.sudoers)) {
    await update(
      (
        languages,
        sudoers,
        _supervisors,
        _userSettings,
        uploadedImages,
        trackedPosts,
      ) => {
        for (const k in data.languages) {
          languages[k] = data.languages[k];
        }

        sudoers.splice(0, sudoers.length);

        for (const sudoer of data.sudoers) {
          sudoers.push(sudoer);
        }

        if (Array.isArray(data.uploadedImages)) {
          uploadedImages.splice(
            0,
            uploadedImages.length,
            ...data.uploadedImages,
          );
        }

        if (
          data.trackedPosts &&
          typeof data.trackedPosts === "object" &&
          !Array.isArray(data.trackedPosts)
        ) {
          for (const key of Object.keys(trackedPosts)) {
            delete trackedPosts[key];
          }
          for (const [key, value] of Object.entries(data.trackedPosts)) {
            trackedPosts[key] = value as TrackedPost;
          }
        }
      },
    );

    return true;
  }

  return false;
}

export function dump() {
  return new TextEncoder().encode(
    JSON.stringify({
      languages,
      sudoers,
      supervisors,
      userSettings,
      uploadedImages,
      trackedPosts,
    }),
  );
}

export const INLINE_INVITE_LINK_NAME = "tgnftrnsltrbtnln";

export const pilotChats = { ru: -1001037196849, en: -1001192070541 } as const;
export const copilotsChat = -1001266712138;
