/**
 * HTML Parser
 *
 * Specialized parser for extracting data from Shopify checkout HTML:
 * - Session tokens from meta tags
 * - GraphQL data (merchandise, queue tokens)
 * - Actions.js URLs
 * - Build IDs from environment metadata
 * - Error detection (out of stock, etc.)
 * - JSDOM-based HTML parsing
 *
 * @module parsers/html.parser
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import { getLogger } from '../../logger';
import { ShopifyError } from '$lib/types/error.types';

const logger = getLogger('html-parser');

/**
 * Parsed HTML data result
 */
export interface ParsedHtmlData {
	/** Session token */
	sessionToken: string | null;

	/** Queue token */
	queueToken: any;

	/** Cleaned merchandise data */
	merchandise: any;

	/** Actions.js URL */
	actionsJsUrl: string | null;

	/** Build ID (commit SHA) */
	buildId: string | null;
}

/**
 * Merchandise conversion result
 */
export interface ConvertedMerchandise {
	merchandise: {
		merchandiseLines: any[];
	};
}

/**
 * HTML Parser class
 *
 * Handles parsing of Shopify checkout HTML pages
 */
export class HtmlParser {
	private readonly defaultActionsJsFilename: string;

	constructor() {
		this.defaultActionsJsFilename = 'actions.B_hz6_NC.js'; // Hardcoded for archived code
	}

	/**
	 * Parse HTML and extract all checkout data
	 *
	 * @param htmlText - HTML content
	 * @param context - Optional context for logging
	 * @returns Parsed data or error code
	 *
	 * @example
	 * ```typescript
	 * const parser = getHtmlParser();
	 *
	 * const result = parser.parseCheckoutHtml(htmlContent, {
	 *   requestId: 'req-123'
	 * });
	 *
	 * if (result === 'MERCHANDISE_OUT_OF_STOCK') {
	 *   console.log('Product is out of stock');
	 * } else if (result) {
	 *   console.log(`Session Token: ${result.sessionToken}`);
	 *   console.log(`Actions.js: ${result.actionsJsUrl}`);
	 * }
	 * ```
	 */
	parseCheckoutHtml(
		htmlText: string,
		context: { requestId?: string; [key: string]: any } = {}
	): ParsedHtmlData | 'MERCHANDISE_OUT_OF_STOCK' | null {
		const requestId = context.requestId || 'unknown';

		try {
			const virtualConsole = new VirtualConsole();
			virtualConsole.sendTo(console, { omitJSDOMErrors: true });

			const dom = new JSDOM(htmlText, { virtualConsole });
			const doc = dom.window.document;

			logger.debug('Parsing checkout HTML', { requestId });

			// Extract session token
			const sessionToken = this.extractSessionToken(doc);
			if (!sessionToken) {
				logger.warn('No session token found in HTML', { requestId });
				return null;
			}

			// Extract GraphQL data
			const graphqlData = this.extractGraphqlData(doc);
			if (!graphqlData) {
				logger.warn('No GraphQL data found in HTML', { requestId });
				return null;
			}

			// Check for out-of-stock error
			if (graphqlData === 'MERCHANDISE_OUT_OF_STOCK') {
				logger.info('Merchandise out of stock detected', { requestId });
				return 'MERCHANDISE_OUT_OF_STOCK';
			}

			// Extract actions.js URL
			const actionsJsUrl = this.extractActionsJsUrl(doc);

			// Extract build ID
			const buildId = this.extractBuildId(doc);

			logger.debug('Successfully parsed checkout HTML', {
				requestId,
				hasSessionToken: !!sessionToken,
				hasMerchandise: !!graphqlData.merchandise,
				hasQueueToken: !!graphqlData.queueToken,
				hasActionsJsUrl: !!actionsJsUrl,
				hasBuildId: !!buildId
			});

			return {
				sessionToken,
				queueToken: graphqlData.queueToken,
				merchandise: graphqlData.merchandise,
				actionsJsUrl,
				buildId
			};
		} catch (error) {
			logger.error(
				'Error parsing checkout HTML',
				error instanceof Error ? error : new Error(String(error)),
				{ requestId }
			);
			return null;
		}
	}

	/**
	 * Extract session token from meta tag
	 *
	 * @param doc - JSDOM Document
	 * @returns Session token or null
	 *
	 * @example
	 * ```typescript
	 * const sessionToken = parser.extractSessionToken(doc);
	 * ```
	 */
	extractSessionToken(doc: Document): string | null {
		try {
			const serializedSessionToken = doc.querySelector('meta[name="serialized-session-token"]');

			if (!serializedSessionToken) {
				return null;
			}

			const metaElem = serializedSessionToken as unknown as { content: string };
			if (!metaElem.content) {
				return null;
			}

			// Remove surrounding quotes
			const sessionToken = metaElem.content.replace(/["]/g, '');

			return sessionToken || null;
		} catch (error) {
			logger.error(
				'Error extracting session token',
				error instanceof Error ? error : new Error(String(error))
			);
			return null;
		}
	}

	/**
	 * Extract GraphQL data from serialized-graphql meta tag
	 *
	 * @param doc - JSDOM Document
	 * @returns GraphQL data with merchandise and queue token, or error code
	 *
	 * @example
	 * ```typescript
	 * const graphqlData = parser.extractGraphqlData(doc);
	 * if (graphqlData !== 'MERCHANDISE_OUT_OF_STOCK') {
	 *   console.log(graphqlData.merchandise);
	 * }
	 * ```
	 */
	extractGraphqlData(
		doc: Document
	):
		| { merchandise: ConvertedMerchandise | null; queueToken: any }
		| 'MERCHANDISE_OUT_OF_STOCK'
		| null {
		try {
			const serializedGraphqlMeta = doc.querySelector('meta[name="serialized-graphql"]');

			if (!serializedGraphqlMeta) {
				return null;
			}

			const metaElem = serializedGraphqlMeta as unknown as { content: string };
			const graphqlContent = JSON.parse(metaElem.content);

			// Find the main key with session.negotiate data
			let mainKey: string | null = null;
			for (const key in graphqlContent) {
				if (graphqlContent.hasOwnProperty(key) && graphqlContent[key]?.session?.negotiate) {
					mainKey = key;
					break;
				}
			}

			if (!mainKey) {
				return null;
			}

			// Check for MERCHANDISE_OUT_OF_STOCK error
			const errors = graphqlContent[mainKey]?.session?.negotiate?.errors;
			if (
				Array.isArray(errors) &&
				errors.some((error) => error?.code === 'MERCHANDISE_OUT_OF_STOCK')
			) {
				return 'MERCHANDISE_OUT_OF_STOCK';
			}

			// Extract merchandise
			const rawMerchandise =
				graphqlContent[mainKey]?.session?.negotiate?.result?.buyerProposal?.merchandise;

			const merchandise = rawMerchandise ? this.convertMerchandise(rawMerchandise) : null;

			// Find queue token
			const queueToken = this.findQueueToken(graphqlContent);

			return {
				merchandise,
				queueToken
			};
		} catch (error) {
			logger.error(
				'Error extracting GraphQL data',
				error instanceof Error ? error : new Error(String(error))
			);
			return null;
		}
	}

	/**
	 * Convert raw merchandise data to expected format
	 *
	 * @param input - Raw merchandise data
	 * @returns Converted merchandise
	 * @throws {ShopifyError} If input is invalid
	 *
	 * @example
	 * ```typescript
	 * const converted = parser.convertMerchandise(rawMerchandise);
	 * ```
	 */
	convertMerchandise(input: any): ConvertedMerchandise {
		if (!input || !Array.isArray(input.merchandiseLines)) {
			throw new ShopifyError(
				'Invalid merchandise input',
				'INVALID_MERCHANDISE',
				400,
				{ merchandiseLines: input?.merchandiseLines }
			);
		}

		const convertedLines = input.merchandiseLines.map((line: any) => {
			const stableId = line.stableId;
			const merch = line.merchandise || {};

			const productVariantReference = {
				id: merch.id,
				variantId: merch.variantId,
				properties: merch.properties || [],
				sellingPlanId: merch.sellingPlan || null,
				sellingPlanDigest: null
			};

			const quantityValue = line.quantity?.items?.value;
			const totalAmount = line.totalAmount?.value;

			let formattedAmount = '0.00';
			if (totalAmount && totalAmount.amount) {
				formattedAmount = parseFloat(totalAmount.amount).toFixed(2);
			}

			return {
				stableId,
				merchandise: { productVariantReference },
				quantity: { items: { value: quantityValue } },
				expectedTotalPrice: {
					value: {
						amount: formattedAmount,
						currencyCode: totalAmount ? totalAmount.currencyCode : 'INR'
					}
				},
				lineComponentsSource: line.lineComponentsSource,
				lineComponents: line.lineComponents || []
			};
		});

		return { merchandise: { merchandiseLines: convertedLines } };
	}

	/**
	 * Recursively find queue token in object
	 *
	 * @param obj - Object to search
	 * @returns Queue token or null
	 *
	 * @example
	 * ```typescript
	 * const queueToken = parser.findQueueToken(graphqlContent);
	 * ```
	 */
	findQueueToken(obj: any): any {
		if (typeof obj !== 'object' || obj === null) {
			return null;
		}

		if (obj.hasOwnProperty('queueToken') && obj.queueToken != null) {
			return obj.queueToken;
		}

		for (const key in obj) {
			if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
				const result = this.findQueueToken(obj[key]);
				if (result != null) {
					return result;
				}
			}
		}

		return null;
	}

	/**
	 * Extract actions.js URL from script tags
	 *
	 * Looks for script tags with /cdn/shopifycloud/checkout-web/assets/ path
	 *
	 * @param doc - JSDOM Document
	 * @returns Actions.js URL or default filename
	 *
	 * @example
	 * ```typescript
	 * const actionsJsUrl = parser.extractActionsJsUrl(doc);
	 * // Returns: '/cdn/shopifycloud/checkout-web/assets/c1/actions.B_hz6_NC.js'
	 * ```
	 */
	extractActionsJsUrl(doc: Document): string {
		try {
			const scriptTags = doc.querySelectorAll('script[src]');

			for (const script of scriptTags) {
				const src = script.getAttribute('src');
				if (
					src &&
					src.includes('/cdn/shopifycloud/checkout-web/assets/') &&
					src.includes('/actions.')
				) {
					logger.debug('Found actions.js URL in HTML', { url: src });
					return src;
				}
			}

			// Use default filename if not found
			const defaultUrl = `/cdn/shopifycloud/checkout-web/assets/c1/${this.defaultActionsJsFilename}`;
			logger.debug('Using default actions.js URL', { url: defaultUrl });
			return defaultUrl;
		} catch (error) {
			logger.error(
				'Error extracting actions.js URL',
				error instanceof Error ? error : new Error(String(error))
			);

			// Return default on error
			return `/cdn/shopifycloud/checkout-web/assets/c1/${this.defaultActionsJsFilename}`;
		}
	}

	/**
	 * Extract build ID (commit SHA) from serialized-environment meta tag
	 *
	 * @param doc - JSDOM Document
	 * @returns Build ID or null
	 *
	 * @example
	 * ```typescript
	 * const buildId = parser.extractBuildId(doc);
	 * // Returns: 'fc1a22c39f13aa1a9d0a664c53e21ef1787b9cca'
	 * ```
	 */
	extractBuildId(doc: Document): string | null {
		try {
			const serializedEnvironmentMeta = doc.querySelector('meta[name="serialized-environment"]');

			if (!serializedEnvironmentMeta) {
				return null;
			}

			const metaElem = serializedEnvironmentMeta as unknown as { content: string };
			const envContent = JSON.parse(metaElem.content);

			const buildId = envContent.commitSha || null;

			if (buildId) {
				logger.debug('Extracted build ID from HTML', { buildId });
			}

			return buildId;
		} catch (error) {
			logger.warn('Error extracting build ID', {
				error: error instanceof Error ? error.message : String(error)
			});
			return null;
		}
	}

	/**
	 * Validate that HTML contains required checkout data
	 *
	 * @param htmlText - HTML content
	 * @returns True if valid checkout HTML
	 *
	 * @example
	 * ```typescript
	 * if (parser.isValidCheckoutHtml(html)) {
	 *   // Proceed with parsing
	 * }
	 * ```
	 */
	isValidCheckoutHtml(htmlText: string): boolean {
		try {
			return (
				htmlText.includes('serialized-session-token') &&
				htmlText.includes('serialized-graphql')
			);
		} catch {
			return false;
		}
	}
}

/**
 * Singleton instance
 */
let htmlParserInstance: HtmlParser | null = null;

/**
 * Get the HTML parser singleton instance
 *
 * @returns HtmlParser instance
 *
 * @example
 * ```typescript
 * import { getHtmlParser } from '$lib/server/parsers';
 *
 * const parser = getHtmlParser();
 *
 * const result = parser.parseCheckoutHtml(htmlContent, {
 *   requestId: 'req-123'
 * });
 *
 * if (result && result !== 'MERCHANDISE_OUT_OF_STOCK') {
 *   console.log(`Session: ${result.sessionToken}`);
 *   console.log(`Merchandise: ${JSON.stringify(result.merchandise)}`);
 * }
 * ```
 */
export function getHtmlParser(): HtmlParser {
	if (!htmlParserInstance) {
		htmlParserInstance = new HtmlParser();
	}
	return htmlParserInstance;
}

/**
 * Reset the HTML parser instance (for testing)
 * @internal
 */
export function resetHtmlParser(): void {
	htmlParserInstance = null;
}
