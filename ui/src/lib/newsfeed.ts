import type { FeedArticle } from "./types";

const keywords = {
  Earnings: /\b(earnings|eps|revenue|guidance|quarterly|results)\b/i,
  Analyst: /\b(upgrade|downgrade|price\s+target|analyst|rating)\b/i,
  Deals: /\b(merger|acquisition|acquire|buyout|takeover|stake)\b/i,
  Legal: /\b(lawsuit|probe|sec|antitrust|investigation|settlement)\b/i,
  Products: /\b(launch|unveils|product|release)\b/i,
};

export function topics(title: string): string[] {
  const found = Object.entries(keywords).filter(([, pattern]) => pattern.test(title)).map(([topic]) => topic);
  return found.length ? found : ["Other"];
}

export function filterArticles(articles: FeedArticle[], ticker: string, publisher: string, topic: string): FeedArticle[] {
  return articles.filter((a) =>
    (!ticker || a.symbols.includes(ticker)) &&
    (!publisher || a.publisher === publisher) &&
    (!topic || topics(a.title).includes(topic)),
  );
}
