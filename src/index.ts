import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "./config.ts";
import { fetchOne } from "./fetch.ts";
import { searchOne, type FailedAttempt, type RoutedSearchResult } from "./search.ts";

function normalizeList(single: unknown, many: unknown): string[] {
	const raw = Array.isArray(many) ? many : (typeof single === "string" ? [single] : []);
	const values: string[] = [];
	for (const item of raw) {
		if (typeof item !== "string") continue;
		const value = item.trim();
		if (value) values.push(value);
	}
	return values;
}

function formatSearchBatch(results: Array<(RoutedSearchResult & { attempts: FailedAttempt[] }) | { query: string; error: string }>): string {
	return results.map((result) => {
		if ("error" in result) {
			return `## Search results for: "${result.query}"\n\nError: ${result.error}`;
		}
		return result.markdown;
	}).join("\n\n---\n\n").trim();
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search Lite",
		description: "Lightweight web search using only Exa, Tavily, and Brave Search. Provider routing is controlled by ~/.pi/web-search.json: provider can be auto, balanced, exa, tavily, or brave. auto follows the configured providers priority order. balanced randomly samples flattened provider+apiKey targets with equal weight.",
		promptSnippet: "Search the web with the lightweight Exa/Tavily/Brave pool. Use queries for 2-4 distinct angles in research tasks.",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Single search query. Prefer queries for multi-angle research." })),
			queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple search queries, executed independently." })),
			numResults: Type.Optional(Type.Number({ description: "Results per query. Defaults to ~/.pi/web-search.json search.numResults, max 20." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			const queries = normalizeList(params.query, params.queries);
			if (queries.length === 0) {
				throw new Error("No query provided. Use query or queries.");
			}

			const config = loadConfig();
			const results: Array<(RoutedSearchResult & { attempts: FailedAttempt[] }) | { query: string; error: string }> = [];
			const numResults = typeof params.numResults === "number"
				? Math.min(Math.max(1, Math.floor(params.numResults)), 20)
				: config.search.numResults;

			for (let i = 0; i < queries.length; i++) {
				const query = queries[i];
				onUpdate?.({
					content: [{ type: "text", text: `Searching ${i + 1}/${queries.length}: ${query}` }],
					details: { phase: "search", current: i + 1, total: queries.length, query },
				});
				try {
					results.push(await searchOne(query, config, { numResults, signal }));
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					results.push({ query, error: message });
				}
			}

			const successful = results.filter((result) => !("error" in result)).length;
			return {
				content: [{ type: "text", text: formatSearchBatch(results) }],
				details: {
					queries,
					queryCount: queries.length,
					successful,
					providerMode: config.provider,
					providers: config.providers,
					results: results.map((result) => "error" in result
						? { query: result.query, error: result.error }
						: {
							query: result.query,
							provider: result.provider,
							keyId: result.keyId,
							answer: result.answer,
							sources: result.results,
							failedAttempts: result.attempts,
						}),
				},
			};
		},
	});

	pi.registerTool({
		name: "fetch",
		label: "Fetch",
		description: "Fetch URL(s) and return their content. This is a plain fetch tool: no prompt, no video analysis, no AI summarization. GitHub URLs use the GitHub API for stable organization, repository, README, and file extraction. Output is truncated according to ~/.pi/web-search.json fetch.maxChars.",
		promptSnippet: "Fetch URL content directly. For GitHub orgs/repos/files, this returns structured GitHub API content.",
		parameters: Type.Object({
			url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
			urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple URLs to fetch" })),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			const urls = normalizeList(params.url, params.urls);
			if (urls.length === 0) {
				throw new Error("No URL provided. Use url or urls.");
			}

			const config = loadConfig();
			const fetched = [];
			for (let i = 0; i < urls.length; i++) {
				const url = urls[i];
				onUpdate?.({
					content: [{ type: "text", text: `Fetching ${i + 1}/${urls.length}: ${url}` }],
					details: { phase: "fetch", current: i + 1, total: urls.length, url },
				});
				try {
					fetched.push(await fetchOne(url, { ...config.fetch, signal }));
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					fetched.push({ url, title: url, content: `Error: ${message}`, truncated: false, originalLength: 0, error: message });
				}
			}

			const output = fetched.map((result) => {
				const header = `# ${result.title}\n${result.url}`;
				return `${header}\n\n${result.content}`;
			}).join("\n\n---\n\n");

			return {
				content: [{ type: "text", text: output.trim() }],
				details: {
					urls,
					urlCount: urls.length,
					successful: fetched.filter((result) => !("error" in result)).length,
					results: fetched.map((result) => ({
						url: result.url,
						title: result.title,
						truncated: result.truncated,
						originalLength: result.originalLength,
						error: "error" in result ? result.error : undefined,
					})),
				},
			};
		},
	});
}
