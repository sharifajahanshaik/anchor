export interface CheckoutInput {
    queueToken?: string;
    sessionToken?: string;
    merchandise?: {
        merchandise?: {
            merchandiseLines?: any[];
        };
    };
}
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

export interface CartItem {
    variantId: string;
    quantity: string;
}


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
    } | null;
    retryCount: number;
};

export type AbandonmentRequest = {
    abandonments: AbandonmentInfo[];
}

/**
 * Interface for the parameters of the sendSlackAbandonedCheckoutAlert function
 */
export interface SlackAbandonedCheckoutAlertParams {
    /**
     * The URL of the shop where the abandoned checkout occurred
     */
    shopUrl: string;

    /**
     * Error reason to include in the notification
     */

    errorReason: string;

    /**
     * Additional data to include in the notification
     */
    additionalData: string;

    /**
     * Whether this is a test notification
     * @default false
     */
    isTest?: boolean;

    /**
     * Array of Slack user IDs to mention in the notification
     */
    userIdsToMention?: string[];

    /**
     * Custom webhook URL (optional, defaults to the predefined webhook URL)
     */
    webhookUrl?: string;
}
