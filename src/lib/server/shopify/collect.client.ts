/**
 * Collect Client
 *
 * Handles /api/collect calls to Shopify to simulate browser user interaction.
 * Makes 5 progressive calls with feature flags to avoid bot detection.
 *
 * Based on archived implementation but updated for new architecture.
 */

import { getHttpClient } from '../http';
import { logger } from '../logger';

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
	 * @default 5000
	 */
	maxDelay?: number;

	/**
	 * Whether to continue making calls if one fails
	 * @default true
	 */
	continueOnError?: boolean;

	/**
	 * Request ID for logging
	 */
	requestId: string;

	/**
	 * Cookie jar key for request-specific cookie isolation
	 */
	cookieJarKey?: string;

	/**
	 * User agent to use
	 */
	userAgent?: string;

	/**
	 * Checkout URL to use as referer
	 */
	checkoutUrl: string;
}

/**
 * Progressive collect sequence
 * Matches browser behavior with 5 calls
 */
const COLLECT_SEQUENCE: CollectFlags[] = [
	// #1: Initial (page load)
	{
		wd: false,
		ua: false,
		cf: true,
		be: true,
		nm: false,
		nc: false,
		ka: false,
		sa: true,
		ta: true,
		pt: false,
		mp: true,
		sd: true
	},
	// #2: Pointer detected
	{
		wd: false,
		ua: false,
		cf: true,
		be: true,
		nm: false,
		nc: false,
		ka: false,
		sa: true,
		ta: true,
		pt: true,
		mp: true,
		sd: true
	},
	// #3: Keyboard detected
	{
		wd: false,
		ua: false,
		cf: true,
		be: true,
		nm: false,
		nc: false,
		ka: true,
		sa: true,
		ta: true,
		pt: true,
		mp: true,
		sd: true
	},
	// #4: Network detected
	{
		wd: false,
		ua: false,
		cf: true,
		be: true,
		nm: false,
		nc: true,
		ka: true,
		sa: true,
		ta: true,
		pt: true,
		mp: true,
		sd: true
	},
	// #5: Final (all enabled)
	{
		wd: false,
		ua: false,
		cf: true,
		be: true,
		nm: true,
		nc: true,
		ka: true,
		sa: true,
		ta: true,
		pt: true,
		mp: true,
		sd: true
	}
];

/**
 * Collect Client class
 *
 * Handles progressive /api/collect calls to simulate browser behavior
 */
export class CollectClient {
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
	 * @param flags - Feature flags for this call
	 * @param callNumber - Call number in sequence
	 * @param options - Request options
	 * @returns Response status or null if failed
	 */
	private async makeSingleCollectCall(
		shopUrl: string,
		flags: CollectFlags,
		callNumber: number,
		options: CollectCallOptions
	): Promise<number | null> {
		const { requestId, cookieJarKey, userAgent, checkoutUrl } = options;

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

			// Get HTTP client
			const httpClient = getHttpClient();

			// Make request using HTTP client with cookie jar enabled to reuse session cookies
			const response = await httpClient.post(collectUrl, collectBody, {
				timeout: 10000,
				userAgent,
				headers: {
					accept: '*/*',
					'accept-language': 'en-GB,en;q=0.9',
					'content-type': 'application/json',
					origin: new URL(shopUrl).origin,
					priority: 'u=1, i',
					referer: checkoutUrl,
					'sec-fetch-dest': 'empty',
					'sec-fetch-mode': 'cors',
					'sec-fetch-site': 'same-origin'
				},
				throwOnError: false, // Handle errors manually
				alertOnError: false, // Don't alert on collect failures
				useCookieJar: true, // Enable cookie jar to reuse cookies
				context: {
					shop: shopUrl,
					cookieJarKey, // Request-specific cookie jar for isolation
					endpoint: 'api-collect',
					callNumber,
					requestId
				}
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
	 * @param options - Call options
	 *
	 * @example
	 * ```typescript
	 * await collectClient.makeProgressiveCalls(
	 *   'https://myshop.myshopify.com',
	 *   {
	 *     checkoutUrl: 'https://myshop.myshopify.com/checkouts/cn/Z2lk...',
	 *     requestId: 'req-123',
	 *     cookieJarKey: 'shop:req-123',
	 *     userAgent: 'Mozilla/5.0 ...'
	 *   }
	 * );
	 * ```
	 */
	async makeProgressiveCalls(shopUrl: string, options: CollectCallOptions): Promise<void> {
		const { minDelay = 1000, maxDelay = 5000, continueOnError = true, requestId } = options;

		logger.info('Starting progressive /api/collect sequence', { requestId });

		for (let i = 0; i < COLLECT_SEQUENCE.length; i++) {
			const flags = COLLECT_SEQUENCE[i];
			const callNumber = i + 1;

			const status = await this.makeSingleCollectCall(shopUrl, flags, callNumber, options);

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
	 * @param flags - Feature flags for this call
	 * @param options - Request options
	 * @returns Response status or null if failed
	 *
	 * @example
	 * ```typescript
	 * const status = await collectClient.makeCustomCall(
	 *   'https://myshop.myshopify.com',
	 *   { wd: true, ua: true, cf: true, be: true, ... },
	 *   { requestId: 'req-123', checkoutUrl: '...', cookieJarKey: '...' }
	 * );
	 * ```
	 */
	async makeCustomCall(
		shopUrl: string,
		flags: CollectFlags,
		options: CollectCallOptions
	): Promise<number | null> {
		return this.makeSingleCollectCall(shopUrl, flags, 1, options);
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
 *   {
 *     checkoutUrl,
 *     requestId: 'req-123',
 *     userAgent,
 *     cookieJarKey
 *   }
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
