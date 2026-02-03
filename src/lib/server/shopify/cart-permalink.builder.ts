/**
 * Cart Permalink Builder
 *
 * This module builds Shopify cart permalink URLs from abandonment data.
 * Cart permalinks are the official Shopify method for creating abandoned checkouts.
 *
 * URL Structure:
 * https://{shop}.myshopify.com/cart/{variantId1}:{quantity1},{variantId2}:{quantity2}
 *   ?checkout[email]={email}
 *   &checkout[phone]=%2B{countryCode}{phone}
 *   &checkout[shipping_address][first_name]={firstName}
 *   &checkout[shipping_address][last_name]={lastName}
 *   &checkout[shipping_address][phone]={countryCode}{phone}
 *   &checkout[shipping_address][address1]={address}
 *   &checkout[shipping_address][city]={city}
 *   &checkout[shipping_address][province]={zoneCode}
 *   &checkout[shipping_address][country]={countryCode}
 *   &checkout[shipping_address][zip]={postalCode}
 *   &attributes[key1]=value1
 *   &attributes[key2]=value2
 *
 * @see https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks
 */

import type { AbandonmentInfo, UserInfo } from '$lib/types';
import { logger } from '$lib/server/logger';

/**
 * Cart item for permalink building
 */
export interface CartItem {
	variantId: string;
	quantity: string;
}

/**
 * Result of building a cart permalink
 */
export interface CartPermalinkResult {
	/** The complete cart permalink URL */
	url: string;
	/** The items portion of the path (/cart/{items}) */
	itemsPath: string;
	/** Whether all required fields were present */
	hasAllRequiredFields: boolean;
	/** Missing required fields (if any) */
	missingFields?: string[];
}

/**
 * Builds a Shopify cart permalink URL from abandonment data
 *
 * @param abandonment - The abandonment information containing items and user data
 * @returns CartPermalinkResult containing the complete URL and metadata
 *
 * @example
 * const result = buildCartPermalink(abandonment);
 * console.log(result.url);
 * // => "https://test-store.myshopify.com/cart/12345:2?checkout[email]=..."
 */
export function buildCartPermalink(abandonment: AbandonmentInfo): CartPermalinkResult {
	const { shopUrl, items, userInfo, customAttributes } = abandonment;

	// Validate required fields
	const missingFields: string[] = [];
	if (!shopUrl) missingFields.push('shopUrl');
	if (!items || items.length === 0) missingFields.push('items');
	// At least phone OR email must be present
	if (!userInfo || (!userInfo.phone && !userInfo.email)) {
		missingFields.push('userInfo.phone or userInfo.email');
	}

	// Build the base URL
	const baseUrl = normalizeShopUrl(shopUrl);

	// Build the items path (/cart/{variantId}:{quantity},...)
	const itemsPath = buildItemsPath(items);

	// Build query parameters
	const params = new URLSearchParams();

	// Add checkout parameters
	addCheckoutParams(params, userInfo);

	// Add tracking attributes
	addTrackingParams(params, customAttributes);

	// Combine into final URL
	const queryString = params.toString();
	const url = queryString ? `${baseUrl}/cart/${itemsPath}?${queryString}` : `${baseUrl}/cart/${itemsPath}`;

	// Log the built permalink
	logger.debug('Built cart permalink', {
		shop: shopUrl,
		itemCount: items.length,
		hasEmail: !!userInfo.email,
		hasAddress: !!userInfo.address,
		hasCustomAttributes: !!customAttributes && Object.keys(customAttributes).length > 0,
		urlLength: url.length
	});

	return {
		url,
		itemsPath,
		hasAllRequiredFields: missingFields.length === 0,
		missingFields: missingFields.length > 0 ? missingFields : undefined
	};
}

/**
 * Normalizes a shop URL to the standard format
 *
 * @param shopUrl - Raw shop URL (can be various formats)
 * @returns Normalized shop URL (https://shop.myshopify.com)
 *
 * @example
 * normalizeShopUrl("https://test-store.myshopify.com/")
 * // => "https://test-store.myshopify.com"
 *
 * normalizeShopUrl("test-store.myshopify.com")
 * // => "https://test-store.myshopify.com"
 */
export function normalizeShopUrl(shopUrl: string): string {
	// Remove trailing slash
	let normalized = shopUrl.replace(/\/$/, '');

	// Add https:// if missing
	if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
		normalized = `https://${normalized}`;
	}

	// Convert http:// to https://
	if (normalized.startsWith('http://')) {
		normalized = normalized.replace('http://', 'https://');
	}

	return normalized;
}

/**
 * Converts ISO country code to phone calling code
 *
 * @param countryCode - ISO 3166-1 alpha-2 country code (e.g., "IN", "US")
 * @returns Phone calling code (e.g., "91", "1")
 *
 * @example
 * getCallingCode("IN") // => "91"
 * getCallingCode("US") // => "1"
 */
export function getCallingCode(countryCode: string): string {
	const callingCodes: Record<string, string> = {
		IN: '91',
		US: '1',
		GB: '44',
		AU: '61',
		CA: '1',
		AE: '971',
		SG: '65',
		MY: '60',
		PK: '92',
		BD: '880',
		LK: '94',
		NP: '977'
	};

	return callingCodes[countryCode.toUpperCase()] || countryCode;
}

/**
 * Builds the items portion of the cart permalink path
 *
 * @param items - Array of cart items with variantId and quantity
 * @returns Items path string (e.g., "12345:2,67890:1")
 *
 * @example
 * buildItemsPath([
 *   { variantId: "12345", quantity: "2" },
 *   { variantId: "67890", quantity: "1" }
 * ])
 * // => "12345:2,67890:1"
 */
export function buildItemsPath(items: CartItem[]): string {
	return items.map((item) => `${item.variantId}:${item.quantity}`).join(',');
}

/**
 * Adds checkout parameters to the URL search params
 *
 * Parameters added:
 * - checkout[email]: Customer email
 * - checkout[phone]: Phone with + prefix (URL-encoded as %2B)
 * - checkout[shipping_address][first_name]: First name
 * - checkout[shipping_address][last_name]: Last name
 * - checkout[shipping_address][phone]: Phone without + prefix
 * - checkout[shipping_address][address1]: Street address
 * - checkout[shipping_address][city]: City
 * - checkout[shipping_address][province]: State/province code
 * - checkout[shipping_address][country]: Country code
 * - checkout[shipping_address][zip]: Postal code
 *
 * @param params - URLSearchParams to add parameters to
 * @param userInfo - User information containing checkout details
 */
export function addCheckoutParams(params: URLSearchParams, userInfo: UserInfo): void {
	// Default to India if country code not provided
	const countryCode = userInfo.countryCode || 'IN';

	// Add email if present
	if (userInfo.email) {
		params.append('checkout[email]', userInfo.email);
	}

	// Add phone (top-level with + prefix)
	// Note: URLSearchParams automatically encodes + as %2B
	if (userInfo.phone) {
		const callingCode = getCallingCode(countryCode);
		params.append('checkout[phone]', `+${callingCode}${userInfo.phone}`);
	}

	// Add shipping address fields if present
	if (userInfo.firstName) {
		params.append('checkout[shipping_address][first_name]', userInfo.firstName);
	}

	if (userInfo.lastName) {
		params.append('checkout[shipping_address][last_name]', userInfo.lastName);
	}

	// Add shipping address phone (without + prefix)
	if (userInfo.phone) {
		const callingCode = getCallingCode(countryCode);
		params.append('checkout[shipping_address][phone]', `${callingCode}${userInfo.phone}`);
	}

	if (userInfo.address) {
		params.append('checkout[shipping_address][address1]', userInfo.address);
	}

	if (userInfo.city) {
		params.append('checkout[shipping_address][city]', userInfo.city);
	}

	if (userInfo.zoneCode) {
		params.append('checkout[shipping_address][province]', userInfo.zoneCode);
	}

	// Always add country code (default to IN)
	params.append('checkout[shipping_address][country]', countryCode);

	if (userInfo.postalCode) {
		params.append('checkout[shipping_address][zip]', userInfo.postalCode);
	}
}

/**
 * Adds tracking parameters (custom attributes) to the URL search params
 *
 * Custom attributes are added as:
 * - attributes[key1]=value1
 * - attributes[key2]=value2
 *
 * These appear in Shopify order additional details for tracking purposes.
 *
 * @param params - URLSearchParams to add parameters to
 * @param customAttributes - Custom tracking attributes
 */
export function addTrackingParams(
	params: URLSearchParams,
	customAttributes: AbandonmentInfo['customAttributes']
): void {
	if (!customAttributes) return;

	// Add each custom attribute as attributes[key]=value
	for (const [key, value] of Object.entries(customAttributes)) {
		if (value !== null && value !== undefined) {
			params.append(`attributes[${key}]`, value);
		}
	}
}

/**
 * Validates that a cart permalink has all required components
 *
 * @param abandonment - The abandonment data to validate
 * @returns Object with validation result and any missing fields
 */
export function validateCartPermalinkData(abandonment: AbandonmentInfo): {
	isValid: boolean;
	missingFields: string[];
} {
	const missingFields: string[] = [];

	// Required fields for cart permalink
	if (!abandonment.shopUrl) {
		missingFields.push('shopUrl');
	}

	if (!abandonment.items || abandonment.items.length === 0) {
		missingFields.push('items');
	}

	if (!abandonment.userInfo) {
		missingFields.push('userInfo');
	} else {
		// At least phone OR email is required
		if (!abandonment.userInfo.phone && !abandonment.userInfo.email) {
			missingFields.push('userInfo.phone or userInfo.email');
		}

		// Country code is optional - defaults to IN if not provided
	}

	return {
		isValid: missingFields.length === 0,
		missingFields
	};
}
