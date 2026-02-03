/**
 * Cart Permalink Visitor
 *
 * This module visits cart permalink URLs and extracts checkout tokens from the response.
 * It handles:
 * - Following redirects
 * - Extracting checkout tokens from HTML or cookies
 * - Timing response performance
 * - Classifying success/failure scenarios
 *
 * Success Criteria:
 * 1. HTTP Status = 200 (after redirects)
 * 2. Checkout token found in HTML or cookies
 */

import { logger } from '$lib/server/logger';
import { getUserAgentProvider } from '$lib/server/useragent';
import { getHttpClient } from '$lib/server/http';
import { getConfig } from '$lib/server/config';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

/**
 * Result of visiting a cart permalink
 */
export interface VisitResult {
	/** Whether the visit was successful (200 + token found) */
	success: boolean;
	/** Final HTTP status code after redirects */
	statusCode: number;
	/** Extracted checkout token (if found) */
	checkoutToken: string | null;
	/** Final checkout URL (after redirects) */
	checkoutUrl: string | null;
	/** HTML response body (needed for Proposal API data extraction) */
	htmlBody: string | null;
	/** Error reason if failed */
	errorReason?: string;
	/** Response time in milliseconds */
	responseTime: number;
	/** Number of redirects followed */
	redirectCount?: number;
}

/**
 * Options for visiting cart permalink
 */
export interface VisitOptions {
	/** Custom user agent (optional, defaults to random) */
	userAgent?: string;
	/** Request timeout in milliseconds (default: 15000) */
	timeout?: number;
	/** Maximum redirects to follow (default: 10) */
	maxRedirects?: number;
	/** Shop URL for context */
	shopUrl?: string;
	/** Cookie jar key for request-specific cookie isolation (e.g., 'shop.myshopify.com:req_abc123') */
	cookieJarKey?: string;
}

/**
 * Visits a cart permalink URL and extracts checkout token
 *
 * @param url - The cart permalink URL to visit
 * @param options - Visit options
 * @returns VisitResult with success status and checkout token
 *
 * @example
 * const result = await visitCartPermalink(
 *   "https://test-store.myshopify.com/cart/12345:2?checkout[phone]=...",
 *   { shopUrl: "test-store.myshopify.com" }
 * );
 *
 * if (result.success && result.checkoutToken) {
 *   console.log("Checkout created:", result.checkoutToken);
 * }
 */
export async function visitCartPermalink(
	url: string,
	options: VisitOptions = {}
): Promise<VisitResult> {
	const { userAgent, timeout = 15000, shopUrl, cookieJarKey } = options;

	const startTime = Date.now();
	const requestId = `visit_${Date.now()}_${Math.random().toString(36).substring(7)}`;

	logger.info('Visiting cart permalink', {
		requestId,
		shop: shopUrl,
		cookieJarKey,
		urlLength: url.length
	});

	try {
		// Get user agent
		const ua =
			userAgent || (shopUrl ? getUserAgentProvider().getUserAgent(shopUrl) : getDefaultUserAgent());

		// Get HTTP client
		const httpClient = getHttpClient();

		try {
			// Visit the permalink URL using HTTP client with cookie jar enabled
			const response = await httpClient.get(url, {
				timeout,
				userAgent: ua,
				throwOnError: false, // We handle errors manually
				alertOnError: false, // We send alerts manually in abandonment service
				useCookieJar: true, // Enable cookie jar for session persistence
				headers: {
					Accept:
						'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
					'Accept-Language': 'en-US,en;q=0.5',
					'Accept-Encoding': 'gzip, deflate, br',
					Connection: 'keep-alive',
					'Upgrade-Insecure-Requests': '1'
				},
				context: {
					shop: shopUrl,
					cookieJarKey, // Request-specific cookie jar for isolation
					endpoint: 'cart-permalink',
					operation: 'visit'
				}
			});

			const responseTime = response.duration;
			const finalUrl = response.raw?.url || url; // Fallback to original URL if raw is null

			// Check for non-200 status
			if (response.status !== 200) {
				logger.warn('Cart permalink visit returned non-200 status', {
					requestId,
					shop: shopUrl,
					status: response.status,
					statusText: response.statusText,
					finalUrl,
					responseTime
				});

				return {
					success: false,
					statusCode: response.status,
					checkoutToken: null,
					checkoutUrl: finalUrl,
					htmlBody: null,
					errorReason: `HTTP ${response.status}: ${response.statusText}`,
					responseTime
				};
			}

			// Get response body (already parsed as text by HTTP client)
			const html = typeof response.data === 'string' ? response.data : String(response.data);

			// Get cookies from response headers (headers is now a Record, not Headers object)
			const cookies = response.headers['set-cookie'] || null;

			// Extract checkout token
			const checkoutToken = extractCheckoutToken(html, cookies);

			// Save HTML to file for debugging (only in dev/test environments)
			const config = getConfig();
			if (config.debug.saveHtmlFiles) {
				try {
					// Ensure debug directory exists
					await mkdir(config.debug.outputDirectory, { recursive: true });

					const debugFilePath = join(
						config.debug.outputDirectory,
						`checkout-${requestId}.html`
					);

					await writeFile(debugFilePath, html, 'utf-8');

					logger.debug('Saved checkout HTML for debugging', {
						requestId,
						filePath: debugFilePath,
						htmlLength: html.length,
						environment: config.telemetry.environment
					});
				} catch (error) {
					logger.warn('Failed to save debug HTML file', {
						requestId,
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}

			if (checkoutToken) {
				logger.info('Cart permalink visit successful', {
					requestId,
					shop: shopUrl,
					checkoutToken: `${checkoutToken.substring(0, 8)}...`,
					finalUrl,
					responseTime
				});

				return {
					success: true,
					statusCode: response.status,
					checkoutToken,
					checkoutUrl: finalUrl,
					htmlBody: html,
					responseTime
				};
			} else {
				logger.warn('Cart permalink visit completed but no checkout token found', {
					requestId,
					shop: shopUrl,
					status: response.status,
					finalUrl,
					htmlLength: html.length,
					responseTime
				});

				return {
					success: false,
					statusCode: response.status,
					checkoutToken: null,
					checkoutUrl: finalUrl,
					htmlBody: html,
					errorReason: 'Checkout token not found in response',
					responseTime
				};
			}
		} catch (error) {
			// HTTP client already handles timeout, just handle the error
			const responseTime = Date.now() - startTime;

			logger.warn('Cart permalink request error', {
				requestId,
				shop: shopUrl,
				error: error instanceof Error ? error.message : String(error),
				responseTime
			});

			// Re-throw to outer catch block
			throw error;
		}
	} catch (error) {
		const responseTime = Date.now() - startTime;

		logger.error(
			'Cart permalink visit failed',
			error instanceof Error ? error : new Error(String(error)),
			{
				requestId,
				shop: shopUrl,
				responseTime
			}
		);

		return {
			success: false,
			statusCode: 0,
			checkoutToken: null,
			checkoutUrl: null,
			htmlBody: null,
			errorReason: error instanceof Error ? error.message : String(error),
			responseTime
		};
	}
}

/**
 * Extracts checkout token from HTML response or cookies
 *
 * Strategies:
 * 1. Search for Shopify.Checkout.token in JavaScript
 * 2. Search for data-checkout-token attribute
 * 3. Search for checkout token in meta tags
 * 4. Search for _shopify_checkout cookie
 *
 * @param html - HTML response body
 * @param cookies - Set-Cookie header value
 * @returns Checkout token if found, null otherwise
 */
export function extractCheckoutToken(html: string, cookies: string | null): string | null {
	// Try to extract from HTML first
	const tokenFromHtml = parseCheckoutTokenFromHTML(html);
	if (tokenFromHtml) return tokenFromHtml;

	// Fallback to cookies
	if (cookies) {
		const tokenFromCookies = parseCheckoutTokenFromCookies(cookies);
		if (tokenFromCookies) return tokenFromCookies;
	}

	return null;
}

/**
 * Parses checkout token from HTML response
 *
 * Looks for patterns like:
 * - Shopify.Checkout.token = "abc123"
 * - data-checkout-token="abc123"
 * - <meta name="shopify-checkout-token" content="abc123">
 *
 * @param html - HTML response body
 * @returns Checkout token if found, null otherwise
 */
export function parseCheckoutTokenFromHTML(html: string): string | null {
	// Strategy 1: Shopify.Checkout.token in JavaScript
	const jsTokenMatch = html.match(/Shopify\.Checkout\.token\s*=\s*["']([^"']+)["']/i);
	if (jsTokenMatch && jsTokenMatch[1]) {
		return jsTokenMatch[1];
	}

	// Strategy 2: data-checkout-token attribute
	const dataAttrMatch = html.match(/data-checkout-token=["']([^"']+)["']/i);
	if (dataAttrMatch && dataAttrMatch[1]) {
		return dataAttrMatch[1];
	}

	// Strategy 3: Meta tag
	const metaMatch = html.match(
		/<meta\s+name=["']shopify-checkout-token["']\s+content=["']([^"']+)["']/i
	);
	if (metaMatch && metaMatch[1]) {
		return metaMatch[1];
	}

	// Strategy 4: Look for checkout URL in HTML and extract token from it
	// Token format: base64-like string (alphanumeric + underscore/dash), typically 24-32 chars
	const checkoutUrlMatch = html.match(/\/checkouts\/[^\/]+\/([A-Za-z0-9_-]{20,40})/);
	if (checkoutUrlMatch && checkoutUrlMatch[1]) {
		return checkoutUrlMatch[1];
	}

	return null;
}

/**
 * Parses checkout token from Set-Cookie header
 *
 * Looks for cookies like:
 * - _shopify_checkout=abc123
 * - checkout_token=abc123
 *
 * @param cookies - Set-Cookie header value
 * @returns Checkout token if found, null otherwise
 */
export function parseCheckoutTokenFromCookies(cookies: string): string | null {
	// Parse Set-Cookie header
	const cookieLines = cookies.split(/,(?=\s*[^=]+=)/);

	for (const line of cookieLines) {
		// Look for _shopify_checkout cookie
		const shopifyCheckoutMatch = line.match(/_shopify_checkout=([^;]+)/);
		if (shopifyCheckoutMatch && shopifyCheckoutMatch[1]) {
			return shopifyCheckoutMatch[1];
		}

		// Look for checkout_token cookie
		const checkoutTokenMatch = line.match(/checkout_token=([^;]+)/);
		if (checkoutTokenMatch && checkoutTokenMatch[1]) {
			return checkoutTokenMatch[1];
		}
	}

	return null;
}

/**
 * Gets a default user agent string
 * @returns A default user agent
 */
function getDefaultUserAgent(): string {
	return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
}
