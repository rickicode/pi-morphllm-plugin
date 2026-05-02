const GITHUB_REPO_API_URL = "https://api.github.com/repos";
const GITHUB_REPO_SEARCH_URL = "https://api.github.com/search/repositories";
const GITHUB_RESOLVER_TIMEOUT = 10000;
const GITHUB_REPO_SUGGESTION_LIMIT = 5;
const GITHUB_OWNER_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function githubHeaders() {
	return {
		Accept: "application/vnd.github+json",
		"User-Agent": "pi-morph-plugin",
	};
}

async function withGitHubTimeout(fn) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), GITHUB_RESOLVER_TIMEOUT);
	try {
		return await fn(ctrl.signal);
	} finally {
		clearTimeout(timer);
	}
}

function tokenizeSuggestionQuery(text) {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length >= 2);
}

function buildGitHubSuggestionQueries(repo, searchTerm) {
	const [owner, repoName] = repo.split("/");
	const searchTokens = tokenizeSuggestionQuery(searchTerm).slice(0, 3);
	const queries = new Set();

	if (owner) queries.add(`user:${owner}`);
	if (owner && repoName) queries.add(`${repoName} user:${owner}`);
	if (repoName) queries.add(repoName);
	if (searchTokens.length > 0 && repoName) {
		queries.add(`${repoName} ${searchTokens.join(" ")}`);
	}

	return Array.from(queries).slice(0, 4);
}

export function resolvePublicRepoLocator(args) {
	const ownerRepo = args.owner_repo?.trim();
	const githubUrl = args.github_url?.trim();

	if (ownerRepo && githubUrl) {
		return { error: "Provide either owner_repo or github_url, not both." };
	}

	if (!ownerRepo && !githubUrl) {
		return {
			error: "Missing repository target. Provide owner_repo or github_url.",
		};
	}

	if (ownerRepo) {
		if (!GITHUB_OWNER_REPO_PATTERN.test(ownerRepo)) {
			return {
				error: `owner_repo must be in owner/repo format, got: ${ownerRepo}`,
			};
		}
		return { repo: ownerRepo };
	}

	let parsed;
	try {
		parsed = new URL(githubUrl);
	} catch {
		return { error: `github_url is invalid: ${githubUrl}` };
	}

	if (!["github.com", "www.github.com"].includes(parsed.hostname)) {
		return {
			error: `github_url must point to github.com, got: ${parsed.hostname}`,
		};
	}

	const pathParts = parsed.pathname.split("/").filter(Boolean);
	if (pathParts.length < 2) {
		return { error: `github_url must include owner and repo: ${githubUrl}` };
	}

	const repo = `${pathParts[0]}/${pathParts[1].replace(/\.git$/, "")}`;
	if (!GITHUB_OWNER_REPO_PATTERN.test(repo)) {
		return {
			error: `github_url did not resolve to a valid owner/repo: ${githubUrl}`,
		};
	}

	return { repo };
}

export async function lookupGitHubRepository(repo) {
	return withGitHubTimeout(async (signal) => {
		try {
			const response = await fetch(`${GITHUB_REPO_API_URL}/${repo}`, {
				headers: githubHeaders(),
				signal,
			});

			if (response.status === 404) {
				return { status: "not_found", detail: "GitHub repository not found" };
			}

			if (!response.ok) {
				return {
					status: "unavailable",
					detail: `GitHub lookup failed with status ${response.status}`,
				};
			}

			const body = await response.json();
			return {
				status: "found",
				fullName: body.full_name || repo,
				defaultBranch: body.default_branch,
				htmlUrl: body.html_url,
			};
		} catch (error) {
			return {
				status: "unavailable",
				detail:
					error instanceof Error
						? error.message
						: "Unknown GitHub repo lookup error",
			};
		}
	});
}

export async function fetchGitHubRepoSuggestions(repo, searchTerm) {
	return withGitHubTimeout(async (signal) => {
		const queries = buildGitHubSuggestionQueries(repo, searchTerm);
		const results = await Promise.all(
			queries.map(async (query) => {
				const url = new URL(GITHUB_REPO_SEARCH_URL);
				url.searchParams.set("q", query);
				url.searchParams.set("sort", "stars");
				url.searchParams.set("order", "desc");
				url.searchParams.set("per_page", String(GITHUB_REPO_SUGGESTION_LIMIT));

				const response = await fetch(url.toString(), {
					headers: githubHeaders(),
					signal,
				});
				if (!response.ok) return [];

				const body = await response.json();
				return (body.items || []).filter(
					(item) =>
						item.full_name && item.html_url && item.name && item.owner?.login,
				);
			}),
		);

		const candidates = new Map();
		for (const items of results) {
			for (const item of items) {
				if (!candidates.has(item.full_name)) {
					candidates.set(item.full_name, {
						fullName: item.full_name,
						htmlUrl: item.html_url,
						description: item.description || undefined,
						stars: item.stargazers_count || 0,
					});
				}
			}
		}

		return Array.from(candidates.values()).slice(
			0,
			GITHUB_REPO_SUGGESTION_LIMIT,
		);
	});
}

export function formatPublicRepoResolutionFailure(
	repo,
	detail,
	suggestions = [],
) {
	const parts = [
		`Repository not found: ${repo}`,
		detail || "This repository does not exist or is private.",
	];

	if (suggestions.length > 0) {
		parts.push(
			"Suggestions:\n" +
				suggestions
					.map(
						(item) =>
							`- ${item.fullName}${item.description ? ` - ${item.description}` : ""}`,
					)
					.join("\n"),
		);
	}

	parts.push(
		"If this package is private, stop guessing repo names and confirm the canonical source repository first.",
	);
	return parts.join("\n\n");
}
