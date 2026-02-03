/**
 * Proposal Client
 *
 * Specialized client for making GraphQL Proposal requests to Shopify:
 * - Persisted query execution
 * - Automatic cookie handling
 * - Platform detection from user agent
 * - Checkout source ID extraction
 * - Comprehensive header setup matching browser behavior
 *
 * @module shopify/proposal.client
 */

import type { CartItem } from '$lib/types/shopify.types';
import { getCookieManager } from '../../cookies';
import { getUserAgentProvider } from '../../useragent';
import { getLogger } from '../../logger/logger.service';
import { HTTP_CONFIG } from '../../config/constants';

const logger = getLogger('proposal-client');

/**
 * Proposal request options
 */
export interface ProposalRequestOptions {
	/**
	 * Custom user agent to use
	 * If not provided, will be generated
	 */
	userAgent?: string;

	/**
	 * Build ID from actions.js
	 * @default 'fc1a22c39f13aa1a9d0a664c53e21ef1787b9cca'
	 */
	buildId?: string | null;

	/**
	 * Checkout URL (for extracting checkout source ID and as referer)
	 */
	checkoutUrl?: string;

	/**
	 * Request timeout in milliseconds
	 * @default HTTP_CONFIG.PROPOSAL_REQUEST_TIMEOUT_MS
	 */
	timeout?: number;

	/**
	 * Additional context for logging
	 */
	context?: {
		requestId?: string;
		items?: CartItem[];
		[key: string]: any;
	};
}

/**
 * Checkout source information
 */
export interface CheckoutSource {
	/** Checkout source ID */
	id: string;
	/** Checkout type (cn or cs) */
	type: string;
}

/**
 * Proposal Client class
 *
 * Handles GraphQL Proposal requests to Shopify checkout
 */
export class ProposalClient {
	private cookieManager = getCookieManager();
	private userAgentProvider = getUserAgentProvider();

	/**
	 * Extract checkout source ID and type from checkout URL
	 *
	 * @param checkoutUrl - Checkout URL
	 * @returns Checkout source information or defaults
	 *
	 * @example
	 * ```typescript
	 * const source = proposalClient.extractCheckoutSource(
	 *   'https://shop.com/checkouts/cn/Z2lkOi8vc2hvcGlmeS9DaGVja291dC8xMjM0NTY/en-in'
	 * );
	 * // { id: 'Z2lkOi8vc2hvcGlmeS9DaGVja291dC8xMjM0NTY', type: 'cn' }
	 * ```
	 */
	extractCheckoutSource(checkoutUrl?: string): CheckoutSource {
		const defaultSource: CheckoutSource = {
			id: 'hWN7RSCPlrSvAz7GAb0tQX2X', // Hardcoded for archived code
			type: 'cn' // Hardcoded for archived code
		};

		if (!checkoutUrl) {
			return defaultSource;
		}

		try {
			const urlMatch = checkoutUrl.match(/\/checkouts\/(cn|cs)\/([^/]+)/);
			if (urlMatch) {
				return {
					type: urlMatch[1], // Extract type (cn or cs)
					id: urlMatch[2] // Extract checkout ID
				};
			}
		} catch (error) {
			logger.warn('Failed to extract checkout ID from URL, using default', {
				error: error instanceof Error ? error.message : String(error),
				checkoutUrl
			});
		}

		return defaultSource;
	}

	/**
	 * Make a proposal request
	 *
	 * @param shopUrl - Shop URL (e.g., 'https://myshop.myshopify.com')
	 * @param variables - GraphQL variables (payload from HTML parsing)
	 * @param proposalQueryId - Persisted query ID from actions.js
	 * @param options - Request options
	 * @returns Proposal response data
	 *
	 * @example
	 * ```typescript
	 * const response = await proposalClient.makeRequest(
	 *   'https://myshop.myshopify.com',
	 *   payloadVariables,
	 *   'abc123def456',
	 *   {
	 *     checkoutUrl: 'https://myshop.myshopify.com/checkouts/cn/Z2lk...',
	 *     buildId: 'xyz789',
	 *     context: { requestId: 'req-123' }
	 *   }
	 * );
	 * ```
	 */
	async makeRequest(
		shopUrl: string,
		variables: any,
		proposalQueryId: string,
		options: ProposalRequestOptions = {}
	): Promise<any> {
		const {
			userAgent: customUserAgent,
			buildId = null,
			checkoutUrl,
			timeout = HTTP_CONFIG.PROPOSAL_REQUEST_TIMEOUT_MS,
			context = {}
		} = options;

		const requestId = context.requestId || 'unknown';
		const requestUrl = `${shopUrl}/checkouts/internal/graphql/persisted?operationName=Proposal`;

		// Get or generate user agent
		const userAgent = customUserAgent || this.userAgentProvider.getUserAgent(shopUrl);
		const platformInfo = this.userAgentProvider.getPlatformInfo(userAgent);

		// Extract checkout source
		const checkoutSource = this.extractCheckoutSource(checkoutUrl);

		logger.debug('Extracted checkout source', {
			requestId,
			checkoutType: checkoutSource.type,
			checkoutSourceId: checkoutSource.id
		});

		// Log cookie jar status
		const cookies = await this.cookieManager.getCookies(shopUrl, shopUrl);
		logger.debug('Reusing cookie jar', {
			requestId,
			cookieCount: cookies.length,
			cookieNames: cookies.length > 0 ? cookies.map((c) => c.key).join(', ') : undefined
		});

		// Build headers
		const headers: Record<string, string> = {
			accept: 'application/json',
			'accept-encoding': 'gzip, deflate, br, zstd',
			'accept-language': 'en-IN',
			'content-type': 'application/json',
			dnt: '1',
			origin: new URL(shopUrl).origin,
			priority: 'u=1, i',
			referer: checkoutUrl || shopUrl,
			'sec-ch-ua': '"Not_A Brand";v="99", "Chromium";v="142"',
			'sec-ch-ua-mobile': platformInfo.secChUaMobile,
			'sec-ch-ua-platform': platformInfo.secChUaPlatform,
			'sec-fetch-dest': 'empty',
			'sec-fetch-mode': 'cors',
			'sec-fetch-site': 'same-origin',
			'user-agent': userAgent,
			'x-checkout-one-session-token': variables.sessionInput.sessionToken,
			'shopify-checkout-client': 'checkout-web/1.0',
			'shopify-checkout-source': `id="${checkoutSource.id}", type="${checkoutSource.type}"`,
			'x-checkout-web-build-id':
				buildId || 'fc1a22c39f13aa1a9d0a664c53e21ef1787b9cca',
			'x-checkout-web-deploy-stage': 'production',
			'x-checkout-web-server-handling': 'fast',
			'x-checkout-web-server-rendering': 'yes',
			'x-checkout-web-source-id': checkoutSource.id
		};

		// Build request body
		const requestBody = {
			variables,
			operationName: 'Proposal',
			id: proposalQueryId
		};

		try {
			logger.debug('Making proposal request', {
				requestId,
				shop: shopUrl,
				proposalQueryId
			});

			// Get fetch function with cookie handling
			const fetchWithCookies = this.cookieManager.getFetchWithCookies(
				async (url: any, init: any) => {
					const response = await fetch(url, init);
					return response;
				},
				shopUrl
			);

			const response = await fetchWithCookies(requestUrl, {
				method: 'POST',
				headers,
				body: JSON.stringify(requestBody),
				signal: AbortSignal.timeout(timeout)
			});

			if (!response.ok) {
				const text = await response.text();
				logger.warn('Proposal request failed with non-2xx status', {
					requestId,
					shop: shopUrl,
					status: response.status,
					statusText: response.statusText,
					responseText: text.substring(0, 500)
				});

				// Return empty response to prevent further processing
				return { data: null };
			}

			const responseData = await response.json();

			logger.debug('Proposal request successful', {
				requestId,
				shop: shopUrl,
				hasData: !!responseData.data
			});

			return responseData;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				logger.warn('Proposal request timeout', {
					requestId,
					shop: shopUrl,
					timeout
				});
			} else {
				logger.error(
					'Proposal request failed',
					error instanceof Error ? error : new Error(String(error)),
					{
						requestId,
						shop: shopUrl
					}
				);
			}

			// Return empty response
			return { data: null };
		}
	}

	/**
	 * Clear cookies for a specific shop
	 *
	 * @param shop - Shop domain
	 *
	 * @example
	 * ```typescript
	 * proposalClient.clearShopCookies('https://myshop.myshopify.com');
	 * ```
	 */
	clearShopCookies(shop: string): void {
		this.cookieManager.clearShopCookies(shop);
	}
}

/**
 * Singleton instance
 */
let proposalClientInstance: ProposalClient | null = null;

/**
 * Get the proposal client singleton instance
 *
 * @returns ProposalClient instance
 *
 * @example
 * ```typescript
 * import { getProposalClient } from '$lib/server/shopify';
 *
 * const proposalClient = getProposalClient();
 *
 * const response = await proposalClient.makeRequest(
 *   'https://myshop.myshopify.com',
 *   variables,
 *   proposalQueryId,
 *   { checkoutUrl, buildId }
 * );
 * ```
 */
export function getProposalClient(): ProposalClient {
	if (!proposalClientInstance) {
		proposalClientInstance = new ProposalClient();
	}
	return proposalClientInstance;
}

/**
 * Reset the proposal client instance (for testing)
 * @internal
 */
export function resetProposalClient(): void {
	proposalClientInstance = null;
}
