/**
 * Collect Client
 *
 * Specialized client for making /api/collect calls to Shopify:
 * - Progressive feature flag sequences
 * - Simulates browser behavior with 5 progressive calls
 * - Automatic cookie handling
 * - Random delays between calls
 * - Error handling for individual calls
 *
 * @module shopify/collect.client
 */

import { getCookieManager } from '../../cookies';
import { getLogger } from '../../logger';

const logger = getLogger('collect-client');

/**
 * Collect feature flags
 * Represents user interaction detection flags
 */
export interface CollectFlags {
	/** Window detected */
	wd: boolean;
	/** User agent */
	ua: boolean;
	/** Config flag */
	cf: boolean;
	/** Browser engine */
	be: boolean;
	/** Network monitoring */
	nm: boolean;
	/** Network connection */
	nc: boolean;
	/** Keyboard activity */
	ka: boolean;
	/** Screen activity */
	sa: boolean;
	/** Touch activity */
	ta: boolean;
	/** Pointer */
	pt: boolean;
	/** Mouse pointer */
	mp: boolean;
	/** Screen data */
	sd: boolean;
}

/**
 * Collect request body
 */
export interface CollectRequest {
	/** Version */
	v: number;
	/** State flags */
	s: CollectFlags;
	/** Reason */
	r: string;
}

/**
 * Collect call options
 */
export interface CollectCallOptions {
	/**
	 * Minimum delay between calls in milliseconds
	 * @default 1000
	 */
	minDelay?: number;

	/**
	 * Maximum delay between calls in milliseconds
	 * @default 10000
	 */
	maxDelay?: number;

	/**
	 * Whether to continue making calls if one fails
	 * @default true
	 */
	continueOnError?: boolean;

	/**
	 * Additional context for logging
	 */
	context?: {
		requestId?: string;
		[key: string]: any;
	};
}

/**
 * Progressive collect sequence
 * Matches browser behavior with 5 calls
 */
const COLLECT_SEQUENCE: CollectFlags[] = [
	// #1: Initial (page load)
	{ wd: false, ua: false, cf: true, be: true, nm: false, nc: false, ka: false, sa: true, ta: true, pt: false, mp: true, sd: true },
	// #2: Pointer detected
	{ wd: false, ua: false, cf: true, be: true, nm: false, nc: false, ka: false, sa: true, ta: true, pt: true, mp: true, sd: true },
	// #3: Keyboard detected
	{ wd: false, ua: false, cf: true, be: true, nm: false, nc: false, ka: true, sa: true, ta: true, pt: true, mp: true, sd: true },
	// #4: Network detected
	{ wd: false, ua: false, cf: true, be: true, nm: false, nc: true, ka: true, sa: true, ta: true, pt: true, mp: true, sd: true },
	// #5: Final (all enabled)
	{ wd: false, ua: false, cf: true, be: true, nm: true, nc: true, ka: true, sa: true, ta: true, pt: true, mp: true, sd: true }
];

/**
 * Collect Client class
 *
 * Handles progressive /api/collect calls to simulate browser behavior
 */
export class CollectClient {
	private cookieManager = getCookieManager();

	/**
	 * Get random delay between min and max
	 *
	 * @param min - Minimum delay in milliseconds
	 * @param max - Maximum delay in milliseconds
	 * @returns Random delay
	 */
	private getRandomDelay(min: number, max: number): number {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	/**
	 * Make a single /api/collect call
	 *
	 * @param shopUrl - Shop URL (e.g., 'https://myshop.myshopify.com')
	 * @param checkoutUrl - Checkout URL to use as referer
	 * @param userAgent - User agent string
	 * @param flags - Feature flags for this call
	 * @param callNumber - Call number in sequence
	 * @param requestId - Request ID for logging
	 * @returns Response status or null if failed
	 */
	private async makeSingleCollectCall(
		shopUrl: string,
		checkoutUrl: string,
		userAgent: string,
		flags: CollectFlags,
		callNumber: number,
		requestId: string
	): Promise<number | null> {
		const collectUrl = `${shopUrl}/api/collect`;
		const collectBody: CollectRequest = {
			v: 1,
			s: flags,
			r: 'change'
		};

		try {
			logger.debug('Progressive collect call', {
				requestId,
				callNumber,
				totalCalls: COLLECT_SEQUENCE.length
			});

			// Get fetch function with cookie handling
			const fetchWithCookies = this.cookieManager.getFetchWithCookies(
				async (url: any, init: any) => {
					const response = await fetch(url, init);
					return response;
				},
				shopUrl
			);

			const response = await fetchWithCookies(collectUrl, {
				method: 'POST',
				headers: {
					accept: '*/*',
					'accept-language': 'en-GB,en;q=0.9',
					'content-type': 'application/json',
					origin: new URL(shopUrl).origin,
					priority: 'u=1, i',
					referer: checkoutUrl,
					'sec-fetch-dest': 'empty',
					'sec-fetch-mode': 'cors',
					'sec-fetch-site': 'same-origin',
					'user-agent': userAgent
				},
				body: JSON.stringify(collectBody)
			});

			logger.debug('Progressive collect call response', {
				requestId,
				callNumber,
				totalCalls: COLLECT_SEQUENCE.length,
				status: response.status
			});

			return response.status;
		} catch (error) {
			logger.error(
				'Progressive collect call failed',
				error instanceof Error ? error : new Error(String(error)),
				{
					requestId,
					callNumber,
					totalCalls: COLLECT_SEQUENCE.length
				}
			);
			return null;
		}
	}

	/**
	 * Make progressive /api/collect calls
	 *
	 * This simulates real user interaction by making 5 calls with progressive feature flags,
	 * matching browser behavior
	 *
	 * @param shopUrl - Shop URL (e.g., 'https://myshop.myshopify.com')
	 * @param checkoutUrl - Checkout URL to use as referer
	 * @param userAgent - User agent string
	 * @param options - Call options
	 *
	 * @example
	 * ```typescript
	 * await collectClient.makeProgressiveCalls(
	 *   'https://myshop.myshopify.com',
	 *   'https://myshop.myshopify.com/checkouts/cn/Z2lk...',
	 *   'Mozilla/5.0 ...',
	 *   { context: { requestId: 'req-123' } }
	 * );
	 * ```
	 */
	async makeProgressiveCalls(
		shopUrl: string,
		checkoutUrl: string,
		userAgent: string,
		options: CollectCallOptions = {}
	): Promise<void> {
		const {
			minDelay = 1000,
			maxDelay = 10000,
			continueOnError = true,
			context = {}
		} = options;

		const requestId = context.requestId || 'unknown';

		logger.info('Starting progressive /api/collect sequence', { requestId });

		for (let i = 0; i < COLLECT_SEQUENCE.length; i++) {
			const flags = COLLECT_SEQUENCE[i];
			const callNumber = i + 1;

			const status = await this.makeSingleCollectCall(
				shopUrl,
				checkoutUrl,
				userAgent,
				flags,
				callNumber,
				requestId
			);

			// Stop if call failed and continueOnError is false
			if (status === null && !continueOnError) {
				logger.warn('Stopping collect sequence due to error', {
					requestId,
					callNumber,
					totalCalls: COLLECT_SEQUENCE.length
				});
				break;
			}

			// Wait random delay before next call (except for last call)
			if (i < COLLECT_SEQUENCE.length - 1) {
				const delay = this.getRandomDelay(minDelay, maxDelay);
				logger.debug('Waiting before next collect call', {
					requestId,
					delayMs: delay
				});
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		logger.info('Completed progressive /api/collect sequence', { requestId });
	}

	/**
	 * Make a custom /api/collect call with specific flags
	 *
	 * @param shopUrl - Shop URL (e.g., 'https://myshop.myshopify.com')
	 * @param checkoutUrl - Checkout URL to use as referer
	 * @param userAgent - User agent string
	 * @param flags - Feature flags for this call
	 * @param requestId - Request ID for logging
	 * @returns Response status or null if failed
	 *
	 * @example
	 * ```typescript
	 * const status = await collectClient.makeCustomCall(
	 *   'https://myshop.myshopify.com',
	 *   'https://myshop.myshopify.com/checkouts/cn/Z2lk...',
	 *   'Mozilla/5.0 ...',
	 *   { wd: true, ua: true, cf: true, be: true, ... }
	 * );
	 * ```
	 */
	async makeCustomCall(
		shopUrl: string,
		checkoutUrl: string,
		userAgent: string,
		flags: CollectFlags,
		requestId: string = 'unknown'
	): Promise<number | null> {
		return this.makeSingleCollectCall(
			shopUrl,
			checkoutUrl,
			userAgent,
			flags,
			1,
			requestId
		);
	}
}

/**
 * Singleton instance
 */
let collectClientInstance: CollectClient | null = null;

/**
 * Get the collect client singleton instance
 *
 * @returns CollectClient instance
 *
 * @example
 * ```typescript
 * import { getCollectClient } from '$lib/server/shopify';
 *
 * const collectClient = getCollectClient();
 *
 * await collectClient.makeProgressiveCalls(
 *   'https://myshop.myshopify.com',
 *   checkoutUrl,
 *   userAgent,
 *   { context: { requestId: 'req-123' } }
 * );
 * ```
 */
export function getCollectClient(): CollectClient {
	if (!collectClientInstance) {
		collectClientInstance = new CollectClient();
	}
	return collectClientInstance;
}

/**
 * Reset the collect client instance (for testing)
 * @internal
 */
export function resetCollectClient(): void {
	collectClientInstance = null;
}
