/**
 * User Agent Provider
 *
 * Centralized user agent generation and management service that provides:
 * - Realistic browser user agent strings
 * - Platform detection (Windows, macOS, Linux, mobile)
 * - Mobile vs desktop detection
 * - Consistent user agent per shop (optional)
 * - Custom user agent support
 *
 * @module useragent/useragent.provider
 */

import randomUseragent from 'random-useragent';
import { getLogger } from '../logger';

const logger = getLogger('useragent-provider');

/**
 * User agent provider configuration
 */
export interface UserAgentProviderConfig {
	/**
	 * Use consistent user agent per shop
	 * When enabled, the same user agent will be used for all requests to a shop
	 * @default false
	 */
	consistentPerShop?: boolean;

	/**
	 * Default user agent to use (overrides random generation)
	 */
	defaultUserAgent?: string;
}

/**
 * Platform information extracted from user agent
 */
export interface PlatformInfo {
	/**
	 * Platform name (Windows, macOS, Linux, Android, iOS)
	 */
	platform: string;

	/**
	 * Whether the user agent is mobile
	 */
	isMobile: boolean;

	/**
	 * sec-ch-ua-mobile header value
	 */
	secChUaMobile: '?0' | '?1';

	/**
	 * sec-ch-ua-platform header value
	 */
	secChUaPlatform: string;
}

/**
 * Default desktop user agent (realistic Chrome on macOS)
 */
const DEFAULT_USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * User Agent Provider class
 *
 * Manages user agent generation and provides platform detection
 */
export class UserAgentProvider {
	private config: Required<UserAgentProviderConfig>;
	private shopUserAgents: Map<string, string>;

	constructor(config: UserAgentProviderConfig = {}) {
		this.config = {
			consistentPerShop: config.consistentPerShop ?? false,
			defaultUserAgent: config.defaultUserAgent ?? DEFAULT_USER_AGENT
		};

		this.shopUserAgents = new Map();

		logger.debug('User agent provider initialized', {
			consistentPerShop: this.config.consistentPerShop,
			hasDefaultUserAgent: !!this.config.defaultUserAgent
		});
	}

	/**
	 * Get a user agent string
	 *
	 * @param shop - Optional shop domain for consistent user agents
	 * @returns User agent string
	 *
	 * @example
	 * ```typescript
	 * const ua = userAgentProvider.getUserAgent('myshop.myshopify.com');
	 * ```
	 */
	getUserAgent(shop?: string): string {
		// If shop is provided and consistent mode is enabled
		if (shop && this.config.consistentPerShop) {
			const normalizedShop = shop.toLowerCase();

			// Get or create user agent for this shop
			if (!this.shopUserAgents.has(normalizedShop)) {
				const ua = this.generateUserAgent();
				logger.debug('Generated consistent user agent for shop', {
					shop: normalizedShop,
					userAgent: ua.substring(0, 50) + '...'
				});
				this.shopUserAgents.set(normalizedShop, ua);
			}

			return this.shopUserAgents.get(normalizedShop)!;
		}

		// Generate a new user agent for each request
		return this.generateUserAgent();
	}

	/**
	 * Generate a new user agent string
	 *
	 * @returns User agent string
	 */
	private generateUserAgent(): string {
		// Use default if configured
		if (this.config.defaultUserAgent) {
			return this.config.defaultUserAgent;
		}

		// Generate random user agent
		try {
			const ua = randomUseragent.getRandom();
			return ua || DEFAULT_USER_AGENT;
		} catch (error) {
			logger.warn('Failed to generate random user agent, using default', {
				error: error instanceof Error ? error.message : String(error)
			});
			return DEFAULT_USER_AGENT;
		}
	}

	/**
	 * Extract platform information from user agent
	 *
	 * @param userAgent - User agent string
	 * @returns Platform information
	 *
	 * @example
	 * ```typescript
	 * const ua = userAgentProvider.getUserAgent();
	 * const platform = userAgentProvider.getPlatformInfo(ua);
	 * console.log(`Platform: ${platform.platform}, Mobile: ${platform.isMobile}`);
	 * ```
	 */
	getPlatformInfo(userAgent: string): PlatformInfo {
		// Detect if mobile
		const isMobile = /iPhone|iPad|iPod|Android/i.test(userAgent);

		// Detect platform
		let platform = 'macOS'; // Default

		if (userAgent.includes('Windows')) {
			platform = 'Windows';
		} else if (userAgent.includes('Mac')) {
			platform = 'macOS';
		} else if (userAgent.includes('Linux')) {
			platform = 'Linux';
		} else if (userAgent.includes('Android')) {
			platform = 'Android';
		} else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
			platform = 'iOS';
		}

		return {
			platform,
			isMobile,
			secChUaMobile: isMobile ? '?1' : '?0',
			secChUaPlatform: `"${platform}"`
		};
	}

	/**
	 * Get user agent with platform information
	 *
	 * @param shop - Optional shop domain for consistent user agents
	 * @returns User agent string and platform information
	 *
	 * @example
	 * ```typescript
	 * const { userAgent, platform } = userAgentProvider.getUserAgentWithPlatform('myshop.myshopify.com');
	 * ```
	 */
	getUserAgentWithPlatform(shop?: string): { userAgent: string; platform: PlatformInfo } {
		const userAgent = this.getUserAgent(shop);
		const platform = this.getPlatformInfo(userAgent);
		return { userAgent, platform };
	}

	/**
	 * Clear user agent for a specific shop
	 *
	 * @param shop - Shop domain
	 *
	 * @example
	 * ```typescript
	 * userAgentProvider.clearShopUserAgent('myshop.myshopify.com');
	 * ```
	 */
	clearShopUserAgent(shop: string): void {
		const normalizedShop = shop.toLowerCase();
		if (this.shopUserAgents.has(normalizedShop)) {
			logger.debug('Clearing user agent for shop', { shop: normalizedShop });
			this.shopUserAgents.delete(normalizedShop);
		}
	}

	/**
	 * Clear all shop user agents
	 *
	 * @example
	 * ```typescript
	 * userAgentProvider.clearAllShopUserAgents();
	 * ```
	 */
	clearAllShopUserAgents(): void {
		logger.debug('Clearing all shop user agents', { shopCount: this.shopUserAgents.size });
		this.shopUserAgents.clear();
	}

	/**
	 * Get statistics about user agent storage
	 *
	 * @returns Statistics object
	 *
	 * @example
	 * ```typescript
	 * const stats = userAgentProvider.getStats();
	 * console.log(`Managing user agents for ${stats.shopCount} shops`);
	 * ```
	 */
	getStats(): { shopCount: number; shops: string[] } {
		return {
			shopCount: this.shopUserAgents.size,
			shops: Array.from(this.shopUserAgents.keys())
		};
	}

	/**
	 * Set a custom user agent for a specific shop
	 *
	 * @param shop - Shop domain
	 * @param userAgent - User agent string
	 *
	 * @example
	 * ```typescript
	 * userAgentProvider.setShopUserAgent('myshop.myshopify.com', 'CustomBot/1.0');
	 * ```
	 */
	setShopUserAgent(shop: string, userAgent: string): void {
		const normalizedShop = shop.toLowerCase();
		logger.debug('Setting custom user agent for shop', {
			shop: normalizedShop,
			userAgent: userAgent.substring(0, 50) + '...'
		});
		this.shopUserAgents.set(normalizedShop, userAgent);
	}
}

/**
 * Singleton instance
 */
let userAgentProviderInstance: UserAgentProvider | null = null;

/**
 * Get the user agent provider singleton instance
 *
 * @param config - Optional configuration (only used on first call)
 * @returns UserAgentProvider instance
 *
 * @example
 * ```typescript
 * import { getUserAgentProvider } from '$lib/server/useragent';
 *
 * const userAgentProvider = getUserAgentProvider();
 *
 * // Get a user agent
 * const ua = userAgentProvider.getUserAgent('myshop.myshopify.com');
 *
 * // Get platform info
 * const platform = userAgentProvider.getPlatformInfo(ua);
 * ```
 */
export function getUserAgentProvider(config?: UserAgentProviderConfig): UserAgentProvider {
	if (!userAgentProviderInstance) {
		userAgentProviderInstance = new UserAgentProvider(config);
	}
	return userAgentProviderInstance;
}

/**
 * Reset the user agent provider instance (for testing)
 * @internal
 */
export function resetUserAgentProvider(): void {
	userAgentProviderInstance = null;
}
