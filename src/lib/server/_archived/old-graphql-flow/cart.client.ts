/**
 * Cart Client
 *
 * Specialized client for fetching Shopify cart pages with:
 * - Automatic cookie handling
 * - User agent management
 * - Redirect following
 * - HTML response parsing
 * - Error handling for non-200 responses
 *
 * @module shopify/cart.client
 */

import type { CartItem } from '$lib/types/shopify.types';
import { getHttpClient } from '../../http';
import { getCookieManager } from '../../cookies';
import { getUserAgentProvider } from '../../useragent';
import { getLogger } from '../../logger/logger.service';
import { NetworkError } from '$lib/types/error.types';
import { HTTP_CONFIG } from '../../config/constants';

const logger = getLogger('cart-client');

/**
 * Cart fetch options
 */
export interface CartFetchOptions {
	/**
	 * Custom user agent to use
	 * If not provided, a random user agent will be generated
	 */
	userAgent?: string;

	/**
	 * Request timeout in milliseconds
	 * @default HTTP_CONFIG.CART_FETCH_TIMEOUT_MS
	 */
	timeout?: number;

	/**
	 * Whether to throw on non-200 status codes
	 * @default false (returns null instead)
	 */
	throwOnError?: boolean;

	/**
	 * Additional context for logging and metrics
	 */
	context?: {
		requestId?: string;
		[key: string]: any;
	};
}

/**
 * Cart fetch result
 */
export interface CartFetchResult {
	/**
	 * HTML content of the cart/checkout page
	 */
	html: string;

	/**
	 * Final URL after redirects (to use as referer)
	 */
	checkoutUrl: string;

	/**
	 * User agent used for the request
	 */
	userAgent: string;

	/**
	 * Request duration in milliseconds
	 */
	duration: number;

	/**
	 * Number of cookies received
	 */
	cookieCount: number;
}

/**
 * Cart Client class
 *
 * Handles fetching cart pages from Shopify stores
 */
export class CartClient {
	private httpClient = getHttpClient();
	private cookieManager = getCookieManager();
	private userAgentProvider = getUserAgentProvider();

	/**
	 * Fetch cart page with items
	 *
	 * @param shopUrl - Shop URL (e.g., 'https://myshop.myshopify.com')
	 * @param items - Cart items to add
	 * @param options - Fetch options
	 * @returns Cart fetch result or null if failed
	 *
	 * @example
	 * ```typescript
	 * const result = await cartClient.fetchCart(
	 *   'https://myshop.myshopify.com',
	 *   [{ variantId: '123', quantity: 1 }],
	 *   { context: { requestId: 'req-123' } }
	 * );
	 *
	 * if (result) {
	 *   console.log(`Fetched cart HTML: ${result.html.length} bytes`);
	 *   console.log(`Checkout URL: ${result.checkoutUrl}`);
	 * }
	 * ```
	 */
	async fetchCart(
		shopUrl: string,
		items: CartItem[],
		options: CartFetchOptions = {}
	): Promise<CartFetchResult | null> {
		const { userAgent: customUserAgent, timeout, throwOnError = false, context = {} } = options;

		const requestId = context.requestId || 'unknown';

		// Format cart items for URL
		const formattedCartItems = items.map((item) => `${item.variantId}:${item.quantity}`).join(',');
		const url = `${shopUrl}/cart/${formattedCartItems}`;

		// Get or generate user agent
		const userAgent = customUserAgent || this.userAgentProvider.getUserAgent(shopUrl);

		logger.debug('Fetching cart page', {
			requestId,
			shop: shopUrl,
			itemCount: items.length,
			userAgent: userAgent.substring(0, 50) + '...'
		});

		try {
			// Get fetch function with cookie handling for this shop
			const fetchWithCookies = this.cookieManager.getFetchWithCookies(
				// Use fetch directly (not httpClient) for cookie integration
				async (url: any, init: any) => {
					const response = await fetch(url, init);
					return response;
				},
				shopUrl
			);

			// Perform request
			const response = await fetchWithCookies(url, {
				method: 'GET',
				headers: {
					'User-Agent': userAgent
				},
				redirect: 'follow',
				signal: AbortSignal.timeout(timeout || HTTP_CONFIG.CART_FETCH_TIMEOUT_MS)
			});

			// Check status
			if (response.status !== 200) {
				logger.warn('Non-200 response from cart fetch', {
					requestId,
					shop: shopUrl,
					status: response.status,
					statusText: response.statusText
				});

				if (throwOnError) {
					throw new NetworkError(
						`Cart fetch failed with status ${response.status}`,
						{ requestId, shop: shopUrl, items },
						url,
						'GET',
						response.status
					);
				}

				return null;
			}

			// Capture final URL after redirects
			const checkoutUrl = response.url || url;

			// Get cookie count
			const cookies = await this.cookieManager.getCookies(shopUrl, shopUrl);
			const cookieCount = cookies.length;

			logger.debug('Cart page fetched successfully', {
				requestId,
				shop: shopUrl,
				cookieCount,
				checkoutUrl
			});

			if (cookieCount > 0) {
				logger.debug('Cookie details', {
					requestId,
					cookieNames: cookies.map((c) => c.key).join(', ')
				});
			}

			// Read HTML content
			const html = await response.text();

			return {
				html,
				checkoutUrl,
				userAgent,
				duration: 0, // Response doesn't track duration in this flow
				cookieCount
			};
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				logger.warn('Cart fetch timeout', {
					requestId,
					shop: shopUrl,
					timeout: timeout || HTTP_CONFIG.CART_FETCH_TIMEOUT_MS
				});
			} else {
				logger.error(
					'Cart fetch failed',
					error instanceof Error ? error : new Error(String(error)),
					{
						requestId,
						shop: shopUrl
					}
				);
			}

			if (throwOnError) {
				if (error instanceof NetworkError) {
					throw error;
				}
				throw new NetworkError(
					`Cart fetch failed: ${error instanceof Error ? error.message : String(error)}`,
					{ requestId, shop: shopUrl, items },
					url,
					'GET'
				);
			}

			return null;
		}
	}

	/**
	 * Clear cookies for a specific shop
	 *
	 * @param shop - Shop domain
	 *
	 * @example
	 * ```typescript
	 * cartClient.clearShopCookies('https://myshop.myshopify.com');
	 * ```
	 */
	clearShopCookies(shop: string): void {
		this.cookieManager.clearShopCookies(shop);
	}

	/**
	 * Get cookie jar for debugging
	 *
	 * @param shop - Shop domain
	 * @param url - URL to get cookies for
	 * @returns Cookie information
	 *
	 * @example
	 * ```typescript
	 * const cookies = await cartClient.getCookies('https://myshop.myshopify.com', 'https://myshop.myshopify.com/');
	 * ```
	 */
	async getCookies(shop: string, url: string) {
		return this.cookieManager.getCookies(shop, url);
	}
}

/**
 * Singleton instance
 */
let cartClientInstance: CartClient | null = null;

/**
 * Get the cart client singleton instance
 *
 * @returns CartClient instance
 *
 * @example
 * ```typescript
 * import { getCartClient } from '$lib/server/shopify';
 *
 * const cartClient = getCartClient();
 *
 * const result = await cartClient.fetchCart(
 *   'https://myshop.myshopify.com',
 *   [{ variantId: '123', quantity: 1 }]
 * );
 * ```
 */
export function getCartClient(): CartClient {
	if (!cartClientInstance) {
		cartClientInstance = new CartClient();
	}
	return cartClientInstance;
}

/**
 * Reset the cart client instance (for testing)
 * @internal
 */
export function resetCartClient(): void {
	cartClientInstance = null;
}
