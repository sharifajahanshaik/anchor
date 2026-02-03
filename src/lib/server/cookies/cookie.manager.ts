/**
 * Cookie Manager
 *
 * Centralized cookie management service that provides:
 * - Shop-specific cookie isolation
 * - Integration with tough-cookie CookieJar
 * - Integration with fetch-cookie for automatic cookie handling
 * - Cookie persistence and expiration
 * - Cookie debugging and inspection
 *
 * @module cookies/cookie.manager
 */

import { CookieJar } from 'tough-cookie';
import fetchCookie from 'fetch-cookie';
import type { RequestInfo, RequestInit } from 'node-fetch';
import { getLogger } from '../logger';

const logger = getLogger('cookie-manager');

/**
 * Cookie manager configuration
 */
export interface CookieManagerConfig {
	/**
	 * Enable cookie persistence across requests
	 * @default true
	 */
	enablePersistence?: boolean;

	/**
	 * Reject cookies from public suffixes (e.g., .com, .co.uk)
	 * @default true
	 */
	rejectPublicSuffixes?: boolean;

	/**
	 * Allow special use domains (e.g., localhost)
	 * @default true
	 */
	allowSpecialUseDomain?: boolean;
}

/**
 * Cookie information for debugging
 */
export interface CookieInfo {
	key: string;
	value: string;
	domain?: string;
	path?: string;
	expires?: Date | 'Infinity';
	httpOnly?: boolean;
	secure?: boolean;
}

/**
 * Cookie Manager class
 *
 * Manages cookies for HTTP requests with request-specific isolation.
 * Each abandonment request gets its own isolated cookie jar to prevent
 * session leakage between concurrent requests from the same shop.
 */
export class CookieManager {
	private config: Required<CookieManagerConfig>;
	private shopJars: Map<string, CookieJar>;

	constructor(config: CookieManagerConfig = {}) {
		this.config = {
			enablePersistence: config.enablePersistence ?? true,
			rejectPublicSuffixes: config.rejectPublicSuffixes ?? true,
			allowSpecialUseDomain: config.allowSpecialUseDomain ?? true
		};

		this.shopJars = new Map();

		logger.debug('Cookie manager initialized', {
			enablePersistence: this.config.enablePersistence,
			rejectPublicSuffixes: this.config.rejectPublicSuffixes,
			allowSpecialUseDomain: this.config.allowSpecialUseDomain
		});
	}

	/**
	 * Get or create a cookie jar for a specific key (request-specific or shop-specific)
	 *
	 * @param jarKey - Cookie jar key (e.g., 'myshop.myshopify.com:req123' or 'myshop.myshopify.com')
	 * @returns CookieJar instance for the key
	 *
	 * @example
	 * ```typescript
	 * // Request-specific jar (recommended for abandonments)
	 * const jar = cookieManager.getJar('myshop.myshopify.com:req_abc123');
	 *
	 * // Shop-specific jar (for persistent sessions)
	 * const jar = cookieManager.getJar('myshop.myshopify.com');
	 * ```
	 */
	getJar(jarKey: string): CookieJar {
		if (!this.config.enablePersistence) {
			// Create a new jar for each request if persistence is disabled
			return this.createJar();
		}

		// Normalize key to lowercase
		const normalizedKey = jarKey.toLowerCase();

		// Get or create jar for this key
		if (!this.shopJars.has(normalizedKey)) {
			logger.debug('Creating new cookie jar', { jarKey: normalizedKey });
			this.shopJars.set(normalizedKey, this.createJar());
		}

		return this.shopJars.get(normalizedKey)!;
	}

	/**
	 * Create a new cookie jar with configured options
	 *
	 * @returns New CookieJar instance
	 */
	private createJar(): CookieJar {
		return new CookieJar(undefined, {
			rejectPublicSuffixes: this.config.rejectPublicSuffixes,
			allowSpecialUseDomain: this.config.allowSpecialUseDomain
		});
	}

	/**
	 * Get fetch function with cookie handling for a specific jar key
	 *
	 * @param fetchImpl - Fetch implementation to wrap
	 * @param jarKey - Cookie jar key (e.g., 'myshop.myshopify.com:req123')
	 * @returns Fetch function with cookie handling
	 *
	 * @example
	 * ```typescript
	 * import fetch from 'node-fetch';
	 * const fetchWithCookies = cookieManager.getFetchWithCookies(fetch, 'myshop.myshopify.com:req_abc123');
	 * const response = await fetchWithCookies('https://myshop.myshopify.com/cart');
	 * ```
	 */
	getFetchWithCookies(
		fetchImpl: (url: RequestInfo, init?: RequestInit) => Promise<any>,
		jarKey: string
	): (url: RequestInfo, init?: RequestInit) => Promise<any> {
		const jar = this.getJar(jarKey);
		return fetchCookie(fetchImpl, jar);
	}

	/**
	 * Get all cookies for a specific jar key and URL
	 *
	 * @param jarKey - Cookie jar key
	 * @param url - URL to get cookies for
	 * @returns Array of cookie information
	 *
	 * @example
	 * ```typescript
	 * const cookies = await cookieManager.getCookies('myshop.myshopify.com:req123', 'https://myshop.myshopify.com/');
	 * ```
	 */
	async getCookies(jarKey: string, url: string): Promise<CookieInfo[]> {
		const jar = this.getJar(jarKey);

		try {
			const cookies = await jar.getCookies(url);
			return cookies.map((cookie) => ({
				key: cookie.key,
				value: cookie.value,
				domain: cookie.domain || undefined,
				path: cookie.path || undefined,
				expires: cookie.expires === 'Infinity' ? 'Infinity' : cookie.expires || undefined,
				httpOnly: cookie.httpOnly,
				secure: cookie.secure
			}));
		} catch (error) {
			logger.warn('Failed to get cookies', {
				jarKey,
				url,
				error: error instanceof Error ? error.message : String(error)
			});
			return [];
		}
	}

	/**
	 * Get cookie count for a specific jar key
	 *
	 * @param jarKey - Cookie jar key
	 * @param url - URL to check cookies for
	 * @returns Number of cookies
	 *
	 * @example
	 * ```typescript
	 * const count = await cookieManager.getCookieCount('myshop.myshopify.com:req123', 'https://myshop.myshopify.com/');
	 * ```
	 */
	async getCookieCount(jarKey: string, url: string): Promise<number> {
		const cookies = await this.getCookies(jarKey, url);
		return cookies.length;
	}

	/**
	 * Clear cookies for a specific jar key (request-specific or shop-specific)
	 *
	 * @param jarKey - Cookie jar key
	 *
	 * @example
	 * ```typescript
	 * // Clear request-specific jar
	 * cookieManager.clearCookies('myshop.myshopify.com:req_abc123');
	 *
	 * // Clear shop-specific jar
	 * cookieManager.clearCookies('myshop.myshopify.com');
	 * ```
	 */
	clearCookies(jarKey: string): void {
		const normalizedKey = jarKey.toLowerCase();
		if (this.shopJars.has(normalizedKey)) {
			logger.debug('Clearing cookies for jar', { jarKey: normalizedKey });
			this.shopJars.delete(normalizedKey);
		}
	}

	/**
	 * Clear all cookies for a specific shop (backwards compatibility)
	 *
	 * @param shop - Shop domain
	 * @deprecated Use clearCookies(jarKey) instead
	 *
	 * @example
	 * ```typescript
	 * cookieManager.clearShopCookies('myshop.myshopify.com');
	 * ```
	 */
	clearShopCookies(shop: string): void {
		this.clearCookies(shop);
	}

	/**
	 * Clear all cookies for all shops
	 *
	 * @example
	 * ```typescript
	 * cookieManager.clearAllCookies();
	 * ```
	 */
	clearAllCookies(): void {
		logger.debug('Clearing all cookies', { shopCount: this.shopJars.size });
		this.shopJars.clear();
	}

	/**
	 * Get statistics about cookie storage
	 *
	 * @returns Statistics object
	 *
	 * @example
	 * ```typescript
	 * const stats = cookieManager.getStats();
	 * console.log(`Managing cookies for ${stats.shopCount} shops`);
	 * ```
	 */
	getStats(): { shopCount: number; shops: string[] } {
		return {
			shopCount: this.shopJars.size,
			shops: Array.from(this.shopJars.keys())
		};
	}

	/**
	 * Log cookie information for debugging
	 *
	 * @param jarKey - Cookie jar key
	 * @param url - URL to get cookies for
	 *
	 * @example
	 * ```typescript
	 * await cookieManager.logCookies('myshop.myshopify.com:req123', 'https://myshop.myshopify.com/');
	 * ```
	 */
	async logCookies(jarKey: string, url: string): Promise<void> {
		const cookies = await this.getCookies(jarKey, url);

		if (cookies.length === 0) {
			logger.debug('No cookies found for jar', { jarKey, url });
			return;
		}

		logger.debug('Cookies for jar', {
			jarKey,
			url,
			cookieCount: cookies.length,
			cookieNames: cookies.map((c) => c.key).join(', ')
		});
	}
}

/**
 * Singleton instance
 */
let cookieManagerInstance: CookieManager | null = null;

/**
 * Get the cookie manager singleton instance
 *
 * @param config - Optional configuration (only used on first call)
 * @returns CookieManager instance
 *
 * @example
 * ```typescript
 * import { getCookieManager } from '$lib/server/cookies';
 *
 * const cookieManager = getCookieManager();
 *
 * // Get a fetch function with cookie handling
 * const fetchWithCookies = cookieManager.getFetchWithCookies(fetch, 'myshop.myshopify.com');
 *
 * // Make requests with automatic cookie handling
 * const response = await fetchWithCookies('https://myshop.myshopify.com/cart');
 * ```
 */
export function getCookieManager(config?: CookieManagerConfig): CookieManager {
	if (!cookieManagerInstance) {
		cookieManagerInstance = new CookieManager(config);
	}
	return cookieManagerInstance;
}

/**
 * Reset the cookie manager instance (for testing)
 * @internal
 */
export function resetCookieManager(): void {
	cookieManagerInstance = null;
}
