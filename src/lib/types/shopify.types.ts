/**
 * Shopify-specific type definitions
 *
 * This module contains all type definitions related to Shopify integration,
 * including checkout, cart, and API response types.
 */

/**
 * Represents a Shopify cart item
 */
export interface CartItem {
	variantId: string;
	quantity: string;
}

/**
 * Extracted checkout data from HTML for Proposal API
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

	// Build ID (from serialized-environment meta tag)
	buildId: string | null;
}
