import { expect, it } from "vitest";
import { filterArticles, topics } from "./newsfeed";
import type { FeedArticle } from "./types";

it("derives all matching topics case insensitively", () => {
  const cases: [string, string][] = [
    ["earnings EPS revenue guidance quarterly results", "Earnings"],
    ["upgrade downgrade price target analyst rating", "Analyst"],
    ["merger acquisition acquire buyout takeover stake", "Deals"],
    ["lawsuit probe SEC antitrust investigation settlement", "Legal"],
    ["launch unveils product release", "Products"],
  ];
  for (const [title, topic] of cases) {
    expect(topics(title.toUpperCase())).toEqual([topic]);
  }
  expect(topics("Analyst raises price target after EPS results and product launch")).toEqual(["Earnings", "Analyst", "Products"]);
  expect(topics("Market moves today")).toEqual(["Other"]);
});

it("matches whole words and phrases only", () => {
  expect(topics("research prerelease releases insecure stakeholder products")).toEqual(["Other"]);
  expect(topics("SEC: release; price TARGET!")).toEqual(["Analyst", "Legal", "Products"]);
});

it("combines ticker, publisher and topic filters with AND", () => {
  const article = (title: string, publisher: string, symbols: string[]): FeedArticle => ({
    title, publisher, symbols, link: title, published: 1, sentiment: "neutral",
  });
  const articles = [
    article("Earnings product launch", "A", ["AAPL", "MSFT"]),
    article("Revenue results", "B", ["AAPL"]),
    article("Analyst upgrade", "A", ["MSFT"]),
  ];
  expect(filterArticles(articles, "", "", "")).toEqual(articles);
  expect(filterArticles(articles, "AAPL", "", "")).toEqual(articles.slice(0, 2));
  expect(filterArticles(articles, "", "A", "")).toEqual([articles[0], articles[2]]);
  expect(filterArticles(articles, "", "", "Earnings")).toEqual(articles.slice(0, 2));
  expect(filterArticles(articles, "MSFT", "A", "Products")).toEqual([articles[0]]);
  expect(filterArticles(articles, "AAPL", "A", "Analyst")).toEqual([]);
});
