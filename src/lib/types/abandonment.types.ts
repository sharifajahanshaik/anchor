/**
 * Abandonment-related type definitions
 *
 * This module contains all types related to cart abandonment functionality.
 */

/**
 * User information for checkout
 */
export interface UserInfo {
	firstName: string | null;
	lastName: string | null;
	phone: string;
	countryCode: string | null;
	address: string | null;
	city: string | null;
	postalCode: string | null;
	zoneCode: string | null;
	email: string | null;
	state: string | null;
}

/**
 * Abandonment information
 */
export type AbandonmentInfo = {
	id?: string;
	shopUrl: string;
	items: {
		variantId: string;
		quantity: string;
	}[];
	userInfo: UserInfo;
	customAttributes?: {
		abandonedRecoveryUrl: string | null;
		cartToken: string | null;
		fbclid: string | null;
		utmMedium: string | null;
		utmCampaign: string | null;
		utmContent: string | null;
		utmSource: string | null;
		breeze_checkout_url: string | null;
		breeze_abandoned_checkout_url: string | null;
		// Allow any additional custom attributes
		[key: string]: string | null;
	} | null;
	retryCount: number;
};

/**
 * Abandonment request payload
 */
export type AbandonmentRequest = {
	abandonments: AbandonmentInfo[];
};
