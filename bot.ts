import {
  createBot,
  KvRepository,
  MemoryCachedRepository,
  text,
} from "@fedify/botkit";
import { DenoKvStore, DenoMessageQueue } from "@fedify/botkit/deno";
import {
  parseFeed,
  type FeedEntry,
} from "https://deno.land/x/rss@0.6.0/mod.ts";

const FEEDS = ["https://hackaday.com/tag/cyberdeck/feed/"];

const denoKv = await Deno.openKv();
const kv = new DenoKvStore(denoKv);

const bot = createBot<void>({
  username: "cyberdeck-news-bot",
  name: "Cyberdeck News Bot",
  summary: text`Cyberdeck News Bot is a bot gather cyberdeck news and projects from the internet`,
  kv: kv,
  queue: new DenoMessageQueue(denoKv),
  repository: new MemoryCachedRepository(new KvRepository(kv)),
});

async function gatherAllArticles(urls: string[]): Promise<FeedEntry[]> {
  let allEntries: FeedEntry[] = [];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      const xml = await response.text();
      const feed = await parseFeed(xml);

      if (feed.entries) {
        allEntries.push(...feed.entries);
      }
    } catch (error) {
      console.warn(`Could not fetch or parse ${url}:`, error.message);
    }
  }
  return allEntries;
}

function findNewCyberdeckPosts(entries: FeedEntry[]): FeedEntry[] {
  const todayString = new Date().toDateString();
  const newPosts: FeedEntry[] = [];
  const seenLinks = new Set<string>();

  for (const entry of entries) {
    const link = entry.links[0]?.href;
    const title = entry.title?.value;
    const publishedDate = entry.published;

    if (!publishedDate || !title || !link) continue;

    const entryDateString = new Date(publishedDate).toDateString();

    // Check if it's from today and we haven't already added this link
    // Post limits: 10
    if (
      newPosts.length < 10 &&
      entryDateString === todayString &&
      !seenLinks.has(link)
    ) {
      newPosts.push(entry);
      seenLinks.add(link);
    }
  }
  return newPosts;
}

Deno.cron("post news daily", "* * * * *", async () => {
  try {
    const allEntries = await gatherAllArticles(FEEDS);
    const newPosts = findNewCyberdeckPosts(allEntries);

    // Use the actual domain for your bot.
    const session = bot.getSession(
      "https://hackerspub-cyberdeck-news.deno.dev",
    );
    for (const post of newPosts) {
      await session.publish(post);
    }
    console.log("Cyberdeck news are posted successfully");
  } catch (error) {
    console.error("Publish failed: ", error);
  }
});

export default bot;
