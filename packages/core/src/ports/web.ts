export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchPage {
  query: string;
  provider: string;
  results: WebSearchResult[];
}

export interface WebSearchPort {
  search(input: { query: string; limit: number; signal: AbortSignal }): Promise<WebSearchPage>;
}
