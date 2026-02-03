/**
 * Shopify health check implementation
 */

import { HealthStatus, type ComponentHealth } from './health.types';
import { logger } from '$lib/server/logger';

/**
 * Check Shopify connectivity by attempting to fetch a cart page
 * Uses a lightweight request to verify Shopify is accessible
 */
export async function checkShopifyHealth(testShop?: string): Promise<ComponentHealth> {
	const startTime = Date.now();
	const shopDomain = testShop || 'example.myshopify.com'; // Fallback test shop

	try {
		// Attempt a simple HEAD request to Shopify to verify connectivity
		// Using a generic product path that should exist on most shops
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

		const response = await fetch(`https://${shopDomain}`, {
			method: 'HEAD',
			signal: controller.signal,
			headers: {
				'User-Agent': 'Anchor-Health-Check/1.0'
			}
		});

		clearTimeout(timeoutId);
		const responseTime = Date.now() - startTime;

		// Consider 2xx, 3xx, and even 4xx as "reachable"
		// We just want to know if Shopify is responding
		if (response.ok || response.status < 500) {
			logger.debug('Shopify health check passed', {
				shop: shopDomain,
				status: response.status,
				responseTime
			});

			return {
				name: 'shopify',
				status: HealthStatus.HEALTHY,
				message: 'Shopify is reachable',
				responseTime,
				lastCheck: new Date().toISOString(),
				metadata: {
					shop: shopDomain,
					httpStatus: response.status
				}
			};
		}

		// 5xx errors indicate Shopify is having issues
		logger.warn('Shopify health check returned server error', {
			shop: shopDomain,
			status: response.status,
			responseTime
		});

		return {
			name: 'shopify',
			status: HealthStatus.DEGRADED,
			message: `Shopify returned ${response.status} status`,
			responseTime,
			lastCheck: new Date().toISOString(),
			metadata: {
				shop: shopDomain,
				httpStatus: response.status
			},
			error: {
				message: `HTTP ${response.status}`,
				code: 'SHOPIFY_SERVER_ERROR'
			}
		};
	} catch (error) {
		const responseTime = Date.now() - startTime;

		// Determine if it's a timeout or network error
		const isTimeout = error instanceof Error && error.name === 'AbortError';
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';

		logger.error('Shopify health check failed', error as Error, {
			shop: shopDomain,
			responseTime,
			isTimeout
		});

		return {
			name: 'shopify',
			status: HealthStatus.UNHEALTHY,
			message: isTimeout
				? 'Shopify health check timed out'
				: 'Failed to reach Shopify',
			responseTime,
			lastCheck: new Date().toISOString(),
			metadata: {
				shop: shopDomain
			},
			error: {
				message: errorMessage,
				code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
				stack: error instanceof Error ? error.stack : undefined
			}
		};
	}
}

/**
 * Check Shopify API health with a specific shop
 * This is a more thorough check that attempts to access a cart page
 */
export async function checkShopifyAPIHealth(shop: string): Promise<ComponentHealth> {
	const startTime = Date.now();

	try {
		// Try to access the cart page with a dummy variant
		// Most shops will return a 404 or redirect, but we're just checking connectivity
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

		const response = await fetch(`https://${shop}/cart/1:1`, {
			method: 'GET',
			signal: controller.signal,
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; Anchor-Health-Check/1.0)'
			}
		});

		clearTimeout(timeoutId);
		const responseTime = Date.now() - startTime;

		// Any response (even 404) means Shopify is reachable and responding
		if (response.status < 500) {
			return {
				name: 'shopify_api',
				status: HealthStatus.HEALTHY,
				message: 'Shopify API is responsive',
				responseTime,
				lastCheck: new Date().toISOString(),
				metadata: {
					shop,
					httpStatus: response.status,
					contentType: response.headers.get('content-type')
				}
			};
		}

		return {
			name: 'shopify_api',
			status: HealthStatus.DEGRADED,
			message: `Shopify API returned ${response.status}`,
			responseTime,
			lastCheck: new Date().toISOString(),
			metadata: {
				shop,
				httpStatus: response.status
			},
			error: {
				message: `HTTP ${response.status}`,
				code: 'API_SERVER_ERROR'
			}
		};
	} catch (error) {
		const responseTime = Date.now() - startTime;
		const isTimeout = error instanceof Error && error.name === 'AbortError';
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';

		return {
			name: 'shopify_api',
			status: HealthStatus.UNHEALTHY,
			message: isTimeout
				? 'Shopify API check timed out'
				: 'Failed to reach Shopify API',
			responseTime,
			lastCheck: new Date().toISOString(),
			metadata: {
				shop
			},
			error: {
				message: errorMessage,
				code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
				stack: error instanceof Error ? error.stack : undefined
			}
		};
	}
}