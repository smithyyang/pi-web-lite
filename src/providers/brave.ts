import type { SearchOptions, SearchResponse, SearchResult } from "../utils.ts";
import { cleanText, requestSignal } from "../utils.ts";

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";

interface BraveResponse {
	web?: {
		results?: Array<{
			title?: string;
			url?: string;
			description?: string;
			extra_snippets?: string[];
		}>;
	};
}

function buildAnswer(results: SearchResult[]): string {
	return results
		.filter((result) => result.snippet.length > 0)
		.map((result) => `${result.snippet}\nSource: ${result.title} (${result.url})`)
		.join("\n\n");
}

export async function searchBrave(query: string, apiKey: string, options: SearchOptions): Promise<SearchResponse> {
	const url = new URL(BRAVE_API_URL);
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(options.numResults));
	url.searchParams.set("extra_snippets", "true");

	const response = await fetch(url, {
		headers: {
			"Accept": "application/json",
			"X-Subscription-Token": apiKey,
		},
		signal: requestSignal(options.timeoutMs, options.signal),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Brave API error ${response.status}: ${errorText.slice(0, 500)}`);
	}

	const data = await response.json() as BraveResponse;
	const results: SearchResult[] = [];
	for (const item of data.web?.results ?? []) {
		if (!item?.title || !item?.url) continue;
		const snippets = [item.description, ...(Array.isArray(item.extra_snippets) ? item.extra_snippets : [])]
			.map((value) => cleanText(value, 500))
			.filter(Boolean);
		results.push({
			title: item.title,
			url: item.url,
			snippet: snippets.join(" ").slice(0, 1000),
		});
		if (results.length >= options.numResults) break;
	}

	return { answer: buildAnswer(results), results };
}
