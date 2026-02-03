/**
 * Proposal Data Extractor
 *
 * Extracts all required data from Shopify checkout.html to construct Proposal API payload.
 * This is a TypeScript conversion of extract-full-payload-data.sh with improved error handling.
 */

import { logger } from '$lib/server/logger';

/**
 * Extracted checkout data from HTML
 */
export interface CheckoutExtractedData {
	// Session & Authentication
	checkoutToken: string;
	sessionToken: string;
	sourceToken: string;
	sourceType: string;
	queueToken: string | null;
	sessionIdentifier: string | null;

	// Customer/Buyer Data
	customer: {
		firstName: string | null;
		lastName: string | null;
		phone: string;
		countryCode: string;
		email: string | null;
	};

	// Address Data
	address: {
		address1: string | null;
		address2: string | null;
		city: string | null;
		postalCode: string | null;
		zoneCode: string | null;
	};

	// Product/Merchandise Data
	merchandise: Array<{
		variantId: string;
		variantIdNumber: string;
		quantity: number;
		price: string | null;
		currencyCode: string;
		stableId: string;
	}>;

	// Payment Data
	payment: {
		paymentMethodIdentifier: string | null;
		paymentMethodName: string | null;
	};

	// Tax Data
	tax: {
		totalTaxAmount: string | null;
		currencyCode: string;
		taxesIncluded: boolean;
	};

	// Shop Data
	shop: {
		domain: string;
		shopId: string | null;
	};

	// Build/Environment Data
	buildId: string | null;
}

/**
 * Extraction error with context
 */
export class ExtractionError extends Error {
	constructor(
		message: string,
		public readonly field: string,
		public readonly context?: any
	) {
		super(message);
		this.name = 'ExtractionError';
	}
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\\&quot;/g, '"');
}

/**
 * Extract meta tag content by name
 * Supports both kebab-case (e.g., "serialized-session-token") and camelCase (e.g., "serialized-sessionToken")
 */
function extractMeta(html: string, metaName: string): string | null {
	// Try exact name first
	const regex = new RegExp(`name="${metaName}"[^>]*content="([^"]*)"`, 'i');
	const match = html.match(regex);
	if (match) {
		return decodeHtmlEntities(match[1]);
	}

	// Try reverse order (content before name)
	const reverseRegex = new RegExp(`content="([^"]*)"[^>]*name="${metaName}"`, 'i');
	const reverseMatch = html.match(reverseRegex);
	if (reverseMatch) {
		return decodeHtmlEntities(reverseMatch[1]);
	}

	// Try hybrid camelCase version (e.g., "serialized-sessionToken" instead of "serialized-session-token")
	// Shopify uses a hybrid format: "serialized-" prefix stays kebab-case, but the suffix becomes camelCase
	if (metaName.startsWith('serialized-') && metaName.includes('-', 11)) {
		// Only convert the part AFTER "serialized-" to camelCase
		const suffix = metaName.substring(11); // Remove "serialized-" prefix
		const camelCaseSuffix = suffix.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
		const hybridName = `serialized-${camelCaseSuffix}`;

		const hybridRegex = new RegExp(`name="${hybridName}"[^>]*content="([^"]*)"`, 'i');
		const hybridMatch = html.match(hybridRegex);
		if (hybridMatch) {
			return decodeHtmlEntities(hybridMatch[1]);
		}

		// Try hybrid reverse order
		const hybridReverseRegex = new RegExp(`content="([^"]*)"[^>]*name="${hybridName}"`, 'i');
		const hybridReverseMatch = html.match(hybridReverseRegex);
		if (hybridReverseMatch) {
			return decodeHtmlEntities(hybridReverseMatch[1]);
		}
	}

	return null;
}

/**
 * Extract serialized meta tag content (without decoding quotes)
 * Supports both kebab-case (e.g., "serialized-session-token") and hybrid format (e.g., "serialized-sessionToken")
 */
function extractSerializedMeta(html: string, metaName: string): string | null {
	// Try exact name first
	const regex = new RegExp(`name="${metaName}"[^>]*content="([^"]*)"`, 'i');
	const match = html.match(regex);
	if (match) {
		return match[1].replace(/&quot;/g, '');
	}

	// Try reverse order
	const reverseRegex = new RegExp(`content="([^"]*)"[^>]*name="${metaName}"`, 'i');
	const reverseMatch = html.match(reverseRegex);
	if (reverseMatch) {
		return reverseMatch[1].replace(/&quot;/g, '');
	}

	// Try hybrid camelCase version (e.g., "serialized-sessionToken" instead of "serialized-session-token")
	// Shopify uses a hybrid format: "serialized-" prefix stays kebab-case, but the suffix becomes camelCase
	if (metaName.startsWith('serialized-') && metaName.includes('-', 11)) {
		// Only convert the part AFTER "serialized-" to camelCase
		const suffix = metaName.substring(11); // Remove "serialized-" prefix
		const camelCaseSuffix = suffix.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
		const hybridName = `serialized-${camelCaseSuffix}`;

		const hybridRegex = new RegExp(`name="${hybridName}"[^>]*content="([^"]*)"`, 'i');
		const hybridMatch = html.match(hybridRegex);
		if (hybridMatch) {
			return hybridMatch[1].replace(/&quot;/g, '');
		}

		// Try hybrid reverse order
		const hybridReverseRegex = new RegExp(`content="([^"]*)"[^>]*name="${hybridName}"`, 'i');
		const hybridReverseMatch = html.match(hybridReverseRegex);
		if (hybridReverseMatch) {
			return hybridReverseMatch[1].replace(/&quot;/g, '');
		}
	}

	return null;
}

/**
 * Extract input field value by name (excluding hidden autofill fields)
 */
function extractInputValue(html: string, fieldName: string): string | null {
	// Match input with name attribute, exclude aria-hidden ones
	const regex = new RegExp(
		`<input[^>]*name="${fieldName}"[^>]*value="([^"]*)"[^>]*>`,
		'gi'
	);
	const matches = html.matchAll(regex);

	for (const match of matches) {
		const fullTag = match[0];
		// Skip aria-hidden fields
		if (!fullTag.includes('aria-hidden="true"')) {
			return match[1];
		}
	}

	return null;
}

/**
 * Extract autofill input value by id
 */
function extractAutofillValue(html: string, fieldId: string): string | null {
	const regex = new RegExp(
		`id="autofill_${fieldId}"[^>]*value="([^"]*)"`,
		'i'
	);
	const match = html.match(regex);
	return match ? match[1] : null;
}

/**
 * Extract queue token with multiple fallback strategies
 */
function extractQueueToken(html: string): string | null {
	// Strategy 1: With HTML entities
	let match = html.match(/queueToken&quot;:&quot;([^&]*)/);
	if (match) return match[1].replace(/&quot;$/, '');

	// Strategy 2: Without HTML entities
	match = html.match(/"queueToken":"([^"]*)"/);
	if (match) return match[1];

	return null;
}

/**
 * Extract serialized-graphql meta tag content and parse as JSON
 * This contains the sellerProposal with merchandise data
 */
function extractSerializedGraphql(html: string): any | null {
	// Extract serialized-graphql meta tag content
	const match = html.match(
		/name="serialized-graphql"[^>]*content="([^"]*?)"/i
	);

	if (!match) {
		// Try reverse order
		const reverseMatch = html.match(
			/content="([^"]*?)"[^>]*name="serialized-graphql"/i
		);
		if (!reverseMatch) return null;

		try {
			return JSON.parse(reverseMatch[1]);
		} catch {
			return null;
		}
	}

	try {
		return JSON.parse(match[1]);
	} catch {
		return null;
	}
}

/**
 * Extract all product variant IDs with their stableIds and quantities from merchandiseLines
 * Parses the sellerProposal.merchandise.merchandiseLines array in the HTML
 */
function extractAllMerchandise(
	html: string,
	taxesIncluded: boolean
): Array<{
	variantId: string;
	variantIdNumber: string;
	quantity: number;
	price: string | null;
	currencyCode: string;
	stableId: string;
}> {
	const merchandiseItems: Array<{
		variantId: string;
		variantIdNumber: string;
		quantity: number;
		price: string | null;
		currencyCode: string;
		stableId: string;
	}> = [];

	// Strategy 1: Extract from serialized-graphql meta tag (most reliable)
	const graphqlData = extractSerializedGraphql(html);

	if (graphqlData) {
		// Find the key containing sellerProposal data
		let sellerProposal: any = null;

		for (const key in graphqlData) {
			if (graphqlData[key]?.sellerProposal?.merchandise?.merchandiseLines) {
				sellerProposal = graphqlData[key].sellerProposal;
				break;
			}
		}

		if (sellerProposal?.merchandise?.merchandiseLines) {
			const lines = sellerProposal.merchandise.merchandiseLines;

			for (const line of lines) {
				if (!line.stableId || !line.merchandise) continue;

				const merchandise = line.merchandise;
				const variantId = merchandise.variantId || '';
				const variantIdNumber = variantId.match(/\/(\d+)$/)?.[1] || '';

				if (!variantIdNumber) continue;

				const quantity = line.quantity?.items?.value || 1;
				const price = merchandise.price?.amount || null;
				const currencyCode = merchandise.price?.currencyCode || 'INR';

				merchandiseItems.push({
					variantId,
					variantIdNumber,
					quantity,
					price,
					currencyCode,
					stableId: line.stableId
				});
			}
		}
	}

	// Strategy 2: Fallback to regex-based extraction if JSON parsing failed
	if (merchandiseItems.length === 0) {
		// Use simpler regex pattern with dotall matching
		const pattern = /stableId&quot;:&quot;([a-f0-9-]+)&quot;.*?variantId&quot;:&quot;gid:\/\/shopify\/ProductVariant\/(\d+).*?&quot;price&quot;:\{&quot;amount&quot;:&quot;([\d.]+)&quot;.*?&quot;quantity&quot;:\{&quot;items&quot;:\{&quot;value&quot;:(\d+)/gs;

		let match;
		const seen = new Set<string>();

		while ((match = pattern.exec(html)) !== null) {
			const [, stableId, variantIdNumber, price, quantityStr] = match;

			// Avoid duplicates (use stableId as key)
			if (seen.has(stableId)) continue;
			seen.add(stableId);

			const currencyCode = extractCurrency(html);

			merchandiseItems.push({
				variantId: `gid://shopify/ProductVariant/${variantIdNumber}`,
				variantIdNumber,
				quantity: parseInt(quantityStr, 10),
				price,
				currencyCode,
				stableId
			});
		}
	}

	// Strategy 3: Last resort - extract single item using old method
	if (merchandiseItems.length === 0) {
		const variantMatch = html.match(/gid:\/\/shopify\/ProductVariant\/(\d+)/);
		const stableIdMatch = html.match(/stableId&quot;:&quot;([a-f0-9-]{36})&quot;/i);

		if (variantMatch && stableIdMatch) {
			const variantIdNumber = variantMatch[1];
			const stableId = stableIdMatch[1];
			const price = extractPrice(html, taxesIncluded);
			const currencyCode = extractCurrency(html);

			merchandiseItems.push({
				variantId: `gid://shopify/ProductVariant/${variantIdNumber}`,
				variantIdNumber,
				quantity: 1, // Default to 1 if we can't extract quantity
				price,
				currencyCode,
				stableId
			});
		}
	}

	return merchandiseItems;
}

/**
 * Extract product variant ID (GID format) - DEPRECATED, use extractAllMerchandise instead
 * @deprecated Use extractAllMerchandise for multi-item support
 */
function extractVariantId(html: string): { fullId: string; numberId: string } | null {
	const match = html.match(/gid:\/\/shopify\/ProductVariant\/(\d+)/);
	if (!match) return null;

	return {
		fullId: match[0],
		numberId: match[1]
	};
}

/**
 * Extract price with multiple fallback strategies
 * Handles both tax-inclusive and tax-exclusive scenarios
 */
function extractPrice(html: string, taxesIncluded: boolean): string | null {
	// For tax-inclusive shops, we need the tax-exclusive price from sellerProposal
	// Look for ContextualizedProductVariantMerchandise.price field
	if (taxesIncluded) {
		// Strategy 1: ContextualizedProductVariantMerchandise with price field (HTML entities)
		let match = html.match(
			/ContextualizedProductVariantMerchandise&quot;[^}]*&quot;price&quot;:{&quot;amount&quot;:&quot;([\d.]+)&quot;/
		);
		if (match) return match[1];

		// Strategy 2: Look in sellerProposal.merchandise (HTML entities)
		match = html.match(
			/sellerProposal&quot;[^}]*&quot;merchandise&quot;[^}]*&quot;merchandiseLines&quot;[^}]*&quot;merchandise&quot;[^}]*&quot;price&quot;:{&quot;amount&quot;:&quot;([\d.]+)&quot;/
		);
		if (match) return match[1];

		// Strategy 3: Without HTML entities
		match = html.match(
			/"__typename":"ContextualizedProductVariantMerchandise"[^}]*"price":{"amount":"([\d.]+)"/
		);
		if (match) return match[1];
	}

	// For tax-exclusive shops OR fallback, use totalAmount (tax-inclusive price)
	// Strategy 4: totalAmount with HTML entity encoding (most common in checkout HTML)
	let match = html.match(/totalAmount&quot;:{&quot;value&quot;:{&quot;amount&quot;:&quot;([\d.]+)&quot;/);
	if (match) return match[1];

	// Strategy 5: totalPrice with amount (regular encoding)
	match = html.match(/totalPrice.*amount.*(\d+\.\d+)/);
	if (match) return match[1];

	// Strategy 6: Direct amount field with regular quotes
	match = html.match(/"amount":"([\d.]+)"/);
	if (match) return match[1];

	// Strategy 7: Direct amount field with HTML entities
	match = html.match(/amount&quot;:&quot;([\d.]+)&quot;/);
	if (match) return match[1];

	return null;
}

/**
 * Extract currency code
 */
function extractCurrency(html: string): string {
	const match = html.match(/cart_currency=([A-Z]+)/);
	return match ? match[1] : 'INR'; // Default to INR
}

/**
 * Extract shop domain
 */
function extractShopDomain(html: string): string | null {
	// Strategy 1: From serialized-initial-url meta tag
	const initialUrl = extractMeta(html, 'serialized-initial-url');
	if (initialUrl) {
		const match = initialUrl.match(/https?:\/\/([^/]+)/);
		if (match) return match[1];
	}

	// Strategy 2: From origin attribute
	const match = html.match(/origin.*https?:\/\/([^"]+)/);
	return match ? match[1].replace(/".*$/, '') : null;
}

/**
 * Extract shop ID
 */
function extractShopId(html: string): string | null {
	const match = html.match(/gid:\/\/shopify\/Shop\/(\d+)/);
	return match ? match[1] : null;
}

/**
 * Extract payment method data
 */
function extractPaymentData(html: string): {
	identifier: string | null;
	name: string | null;
} {
	// Strategy 1: With HTML entities
	let match = html.match(
		/paymentMethodIdentifier&quot;:&quot;([^&]*)&quot;,&quot;name&quot;:&quot;([^&]*)/
	);
	if (match) {
		return {
			identifier: match[1],
			name: match[2]
		};
	}

	// Strategy 2: Without HTML entities
	match = html.match(/"paymentMethodIdentifier":"([^"]*)","name":"([^"]*)"/);
	if (match) {
		return {
			identifier: match[1],
			name: match[2]
		};
	}

	return {
		identifier: null,
		name: null
	};
}

/**
 * Extract tax amount
 */
function extractTaxAmount(html: string): string | null {
	// Strategy 1: With HTML entities
	let match = html.match(
		/totalTaxAmount&quot;:{&quot;value&quot;:{&quot;amount&quot;:&quot;([^&]*)/
	);
	if (match) return match[1];

	// Strategy 2: Without HTML entities
	match = html.match(/"totalTaxAmount":{"value":{"amount":"([^"]*)"/);
	if (match) return match[1];

	return null;
}

/**
 * Extract whether taxes are included in prices
 */
function extractTaxesIncluded(html: string): boolean {
	// Strategy 1: With HTML entities (most common)
	let match = html.match(/taxesIncluded&quot;:(true|false)/);
	if (match) return match[1] === 'true';

	// Strategy 2: Without HTML entities
	match = html.match(/"taxesIncluded":(true|false)/);
	if (match) return match[1] === 'true';

	// Default to false (tax-exclusive) if not found
	return false;
}

/**
 * Extract stable ID for merchandise line item
 * The stableId is a UUID that should persist across related requests
 */
function extractStableId(html: string): string | null {
	// Strategy 1: With HTML entities (most common in checkout HTML)
	let match = html.match(/stableId&quot;:&quot;([a-f0-9-]{36})&quot;/i);
	if (match) return match[1];

	// Strategy 2: Without HTML entities
	match = html.match(/"stableId":"([a-f0-9-]{36})"/i);
	if (match) return match[1];

	return null;
}

/**
 * Extract build ID from serialized-environment meta tag
 * The build ID is Shopify's commit SHA used for x-checkout-web-build-id header
 */
function extractBuildId(html: string): string | null {
	const serializedEnv = extractSerializedMeta(html, 'serialized-environment');
	if (!serializedEnv) return null;

	try {
		// The serialized-environment contains JSON data with commitSha
		const envData = JSON.parse(serializedEnv);
		return envData.commitSha || null;
	} catch (error) {
		logger.debug('Failed to parse serialized-environment for build ID', {
			error: error instanceof Error ? error.message : String(error)
		});
		return null;
	}
}

/**
 * Extraction result with metadata about fallback usage
 */
export interface ExtractionResult {
	data: CheckoutExtractedData;
	usedFallbackPhone: boolean;
	usedFallbackEmail: boolean;
}

/**
 * Main extraction function
 * Extracts all data from checkout.html needed for Proposal API
 */
export function extractCheckoutData(
	htmlBody: string,
	requestId: string,
	userEmail?: string | null,
	fallbackPhone?: string | null
): ExtractionResult {
	logger.debug('Starting checkout data extraction', {
		requestId,
		htmlSize: htmlBody.length
	});

	try {
		// Extract session tokens (CRITICAL - must exist)
		const sessionToken = extractSerializedMeta(htmlBody, 'serialized-session-token');
		if (!sessionToken) {
			throw new ExtractionError('Session token not found', 'sessionToken');
		}

		const sourceToken = extractSerializedMeta(htmlBody, 'serialized-source-token');
		if (!sourceToken) {
			throw new ExtractionError('Source token not found', 'sourceToken');
		}

		const sourceType = extractSerializedMeta(htmlBody, 'serialized-source-type');
		if (!sourceType) {
			throw new ExtractionError('Source type not found', 'sourceType');
		}

		// Extract optional session data
		const sessionIdentifier = extractSerializedMeta(
			htmlBody,
			'serialized-checkout-session-identifier'
		);
		const queueToken = extractQueueToken(htmlBody);

		// Extract customer data
		const extractedPhone = extractInputValue(htmlBody, 'phone');
		const phone = extractedPhone || fallbackPhone || '';
		const firstName = extractAutofillValue(htmlBody, 'firstName');
		const lastName = extractAutofillValue(htmlBody, 'lastName');
		const countryCode = extractAutofillValue(htmlBody, 'country') || 'IN';

		// Extract address data
		const address1 = extractAutofillValue(htmlBody, 'address1');
		const address2 = extractAutofillValue(htmlBody, 'address2');
		const city = extractAutofillValue(htmlBody, 'city');
		const postalCode = extractAutofillValue(htmlBody, 'postalCode');
		const zoneCode = extractAutofillValue(htmlBody, 'zone');

		// Extract tax settings FIRST (needed for price extraction)
		const taxesIncluded = extractTaxesIncluded(htmlBody);
		const taxAmount = extractTaxAmount(htmlBody);

		// Extract ALL merchandise items (supports multi-item carts)
		const merchandiseItems = extractAllMerchandise(htmlBody, taxesIncluded);
		if (merchandiseItems.length === 0) {
			throw new ExtractionError('No merchandise items found', 'merchandise');
		}

		// Extract shop data
		const shopDomain = extractShopDomain(htmlBody);
		if (!shopDomain) {
			throw new ExtractionError('Shop domain not found', 'shopDomain');
		}
		const shopId = extractShopId(htmlBody);

		// Extract payment data (optional)
		const paymentData = extractPaymentData(htmlBody);

		// Extract build ID (optional - used for x-checkout-web-build-id header)
		const buildId = extractBuildId(htmlBody);

		const extractedData: CheckoutExtractedData = {
			checkoutToken: sourceToken, // sourceToken IS the checkout token
			sessionToken,
			sourceToken,
			sourceType,
			queueToken,
			sessionIdentifier,
			customer: {
				firstName,
				lastName,
				phone,
				countryCode,
				email: userEmail ?? null
			},
			address: {
				address1,
				address2,
				city,
				postalCode,
				zoneCode
			},
			merchandise: merchandiseItems,
			payment: {
				paymentMethodIdentifier: paymentData.identifier,
				paymentMethodName: paymentData.name
			},
			tax: {
				totalTaxAmount: taxAmount,
				currencyCode: merchandiseItems[0]?.currencyCode || 'INR',
				taxesIncluded
			},
			shop: {
				domain: shopDomain,
				shopId
			},
			buildId
		};

		// Check if we had to use fallback phone or email
		const usedFallbackPhone = !extractedPhone && !!fallbackPhone;
		const usedFallbackEmail = !userEmail;

		// Log if fallback was used
		if (usedFallbackPhone || usedFallbackEmail) {
			logger.warn('Used fallback contact data - HTML extraction did not find contact info', {
				requestId,
				usedFallbackPhone,
				usedFallbackEmail,
				extractedPhone: extractedPhone || 'none',
				fallbackPhone: fallbackPhone || 'none',
				userEmail: userEmail || 'none'
			});
		}

		logger.debug('Checkout data extraction completed', {
			requestId,
			extractedFields: {
				hasSessionToken: !!extractedData.sessionToken,
				hasSourceToken: !!extractedData.sourceToken,
				hasQueueToken: !!extractedData.queueToken,
				customerDataComplete: !!(firstName && phone),
				addressDataComplete: !!(address1 && city),
				merchandiseCount: extractedData.merchandise.length,
				hasPaymentMethod: !!paymentData.identifier,
				hasTaxData: !!taxAmount,
				usedFallbackPhone,
				usedFallbackEmail
			}
		});

		return {
			data: extractedData,
			usedFallbackPhone,
			usedFallbackEmail
		};
	} catch (error) {
		if (error instanceof ExtractionError) {
			logger.error('Checkout data extraction failed', error, {
				requestId,
				field: error.field,
				context: error.context
			});
			throw error;
		}

		logger.error(
			'Unexpected error during checkout data extraction',
			error instanceof Error ? error : new Error(String(error)),
			{
				requestId
			}
		);
		throw new Error(
			`Failed to extract checkout data: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Validate extracted data completeness
 * Returns array of missing critical fields
 */
export function validateExtractedData(data: CheckoutExtractedData): string[] {
	const missingFields: string[] = [];

	// Critical fields that MUST exist
	if (!data.sessionToken) missingFields.push('sessionToken');
	if (!data.sourceToken) missingFields.push('sourceToken');
	if (!data.sourceType) missingFields.push('sourceType');
	if (!data.merchandise.length) missingFields.push('merchandise');
	if (!data.shop.domain) missingFields.push('shop.domain');

	// Validate each merchandise item has required fields
	data.merchandise.forEach((item, index) => {
		if (!item.stableId) missingFields.push(`merchandise[${index}].stableId`);
		if (!item.variantId) missingFields.push(`merchandise[${index}].variantId`);
	});

	// Note: Phone is NOT required - email-only abandonments are supported
	// The Proposal API will work with just email (phone can be empty string)

	return missingFields;
}
