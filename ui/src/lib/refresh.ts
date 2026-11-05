export type RefreshView = "chart" | "alerts" | "technicals" | "analysts" | "earnings" | "stats" | "financials" | "options" | "market" | "events" | "news" | "watchlist";

export const REFRESH_LABELS: Record<RefreshView, string> = {
  chart: "Chart",
  alerts: "Alerts",
  technicals: "Technicals",
  analysts: "Analysts",
  earnings: "Earnings",
  stats: "Stats",
  financials: "Financials",
  options: "Options",
  market: "Market",
  events: "Events",
  news: "News",
  watchlist: "Watchlist",
};

export function refreshOutcome(view: RefreshView, error?: string | null): { text: string; error: boolean } {
  const label = REFRESH_LABELS[view];
  return error ? { text: `Could not refresh ${label}: ${error}`, error: true } : { text: `${label} refreshed`, error: false };
}
