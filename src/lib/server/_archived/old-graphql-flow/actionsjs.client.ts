/**
 * Actions.js Client
 *
 * Specialized client for fetching and parsing Shopify actions.js files:
 * - Fetches actions.js from checkout pages
 * - Extracts persisted GraphQL query IDs
 * - Automatic user agent handling
 * - Error handling for failed fetches
 *
 * @module shopify/actionsjs.client
 */

import { getHttpClient } from '../../http';
import { getUserAgentProvider } from '../../useragent';
import { getLogger } from '../../logger';

const logger = getLogger('actionsjs-client');

/**
 * Actions.js fetch options
 */
export interface ActionsJsFetchOptions {
	/**
	 * Custom user agent to use
	 * If not provided, will be generated
	 */
	userAgent?: string;

	/**
	 * Request timeout in milliseconds
	 * @default 15000
	 */
	timeout?: number;

	/**
	 * Additional context for logging
	 */
	context?: {
		requestId?: string;
		[key: string]: any;
	};
}

/**
 * Actions.js Client class
 *
 * Handles fetching and parsing actions.js files from Shopify
 */
export class ActionsJsClient {
	private httpClient = getHttpClient();
	private userAgentProvider = getUserAgentProvider();

	/**
	 * Fetch actions.js and extract Proposal query ID
	 *
	 * @param shopUrl - Shop URL (e.g., 'https://myshop.myshopify.com')
	 * @param actionsJsPath - Path or full URL to actions.js
	 * @param options - Fetch options
	 * @returns Proposal query ID or null if not found
	 *
	 * @example
	 * ```typescript
	 * const queryId = await actionsJsClient.fetchProposalQueryId(
	 *   'https://myshop.myshopify.com',
	 *   '/checkouts/internal/preloads/shop/actions-e9c3b4a2.js',
	 *   { context: { requestId: 'req-123' } }
	 * );
	 *
	 * if (queryId) {
	 *   console.log(`Proposal Query ID: ${queryId}`);
	 * }
	 * ```
	 */
	async fetchProposalQueryId(
		shopUrl: string,
		actionsJsPath: string,
		options: ActionsJsFetchOptions = {}
	): Promise<string | null> {
		const { userAgent: customUserAgent, timeout = 15000, context = {} } = options;

		const requestId = context.requestId || 'unknown';

		try {
			// Construct full URL if path is relative
			const actionsJsUrl = actionsJsPath.startsWith('http')
				? actionsJsPath
				: `${shopUrl}${actionsJsPath}`;

			logger.info('Fetching actions.js', {
				requestId,
				url: actionsJsUrl
			});

			// Get or generate user agent
			const userAgent = customUserAgent || this.userAgentProvider.getUserAgent(shopUrl);
			const platformInfo = this.userAgentProvider.getPlatformInfo(userAgent);

			// Fetch actions.js
			const response = await this.httpClient.get(actionsJsUrl, {
				timeout,
				throwOnError: false,
				alertOnError: false,
				headers: {
					'User-Agent': userAgent,
					Referer: shopUrl,
					Origin: shopUrl,
					'sec-ch-ua-platform': platformInfo.secChUaPlatform,
					'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
					'sec-ch-ua-mobile': platformInfo.secChUaMobile
				},
				context: {
					shop: shopUrl,
					endpoint: '/actions.js',
					requestId
				}
			});

			if (response.status !== 200) {
				logger.error('Failed to fetch actions.js', undefined, {
					requestId,
					status: response.status,
					url: actionsJsUrl
				});
				return null;
			}

			const jsContent =
				typeof response.data === 'string' ? response.data : String(response.data);

			// Extract the Proposal query ID
			const proposalQueryId = this.extractProposalQueryId(jsContent);

			if (proposalQueryId) {
				logger.info('Extracted Proposal query ID', {
					requestId,
					queryId: proposalQueryId
				});
				return proposalQueryId;
			} else {
				logger.error('Could not find Proposal query ID in actions.js', undefined, {
					requestId,
					url: actionsJsUrl
				});
				return null;
			}
		} catch (error) {
			logger.error(
				'Error fetching actions.js',
				error instanceof Error ? error : new Error(String(error)),
				{
					requestId,
					url: actionsJsPath
				}
			);
			return null;
		}
	}

	/**
	 * Extract Proposal query ID from actions.js content
	 *
	 * Looks for pattern: id: "867b72fb...", type: "query", name: "Proposal"
	 *
	 * @param jsContent - JavaScript content
	 * @returns Query ID or null if not found
	 *
	 * @example
	 * ```typescript
	 * const content = 'id: "abc123", type: "query", name: "Proposal"';
	 * const queryId = actionsJsClient.extractProposalQueryId(content);
	 * // Returns: 'abc123'
	 * ```
	 */
	extractProposalQueryId(jsContent: string): string | null {
		// Looking for: id: "867b72fb...", type: "query", name: "Proposal"
		const proposalMatch = jsContent.match(
			/id:\s*"([^"]+)"[^}]*type:\s*"query"[^}]*name:\s*"Proposal"/
		);

		if (proposalMatch) {
			return proposalMatch[1];
		}

		return null;
	}

	/**
	 * Check if actions.js content contains a Proposal query
	 *
	 * @param jsContent - JavaScript content
	 * @returns True if Proposal query is found
	 *
	 * @example
	 * ```typescript
	 * const hasProposal = actionsJsClient.hasProposalQuery(content);
	 * ```
	 */
	hasProposalQuery(jsContent: string): boolean {
		return this.extractProposalQueryId(jsContent) !== null;
	}
}

/**
 * Singleton instance
 */
let actionsJsClientInstance: ActionsJsClient | null = null;

/**
 * Get the actions.js client singleton instance
 *
 * @returns ActionsJsClient instance
 *
 * @example
 * ```typescript
 * import { getActionsJsClient } from '$lib/server/shopify';
 *
 * const actionsJsClient = getActionsJsClient();
 *
 * const queryId = await actionsJsClient.fetchProposalQueryId(
 *   'https://myshop.myshopify.com',
 *   '/checkouts/internal/preloads/shop/actions.js'
 * );
 * ```
 */
export function getActionsJsClient(): ActionsJsClient {
	if (!actionsJsClientInstance) {
		actionsJsClientInstance = new ActionsJsClient();
	}
	return actionsJsClientInstance;
}

/**
 * Reset the actions.js client instance (for testing)
 * @internal
 */
export function resetActionsJsClient(): void {
	actionsJsClientInstance = null;
}
