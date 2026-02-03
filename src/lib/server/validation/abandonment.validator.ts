import type { AbandonmentInfo, AbandonmentRequest } from "$lib/types";

export function decodeAbandonmentInfo(rawInput: any): AbandonmentInfo | null {
    if (
        typeof rawInput !== 'object' ||
        !rawInput ||
        typeof rawInput.shopUrl !== 'string' ||
        !Array.isArray(rawInput.items) ||
        typeof rawInput.userInfo !== 'object' ||
        !rawInput.userInfo
    ) {
        return null;
    }

    const { shopUrl, items, userInfo, customAttributes } = rawInput;

    // Validate items array
    if (
        items.some(
            (item: any) =>
                typeof item.variantId !== 'string' || typeof item.quantity !== 'string'
        )
    ) {
        return null;
    }

    // Validate userInfo fields
    const email =
        typeof userInfo.email === 'string' ? userInfo.email : null;
    const firstName =
        typeof userInfo.firstName === 'string' ? userInfo.firstName : null;
    const lastName =
        typeof userInfo.lastName === 'string' ? userInfo.lastName : ".";
    const countryCode =
        typeof userInfo.countryCode === 'string'
            ? userInfo.countryCode
            : "IN";
    const address =
        typeof userInfo.address === 'string' ? userInfo.address : null;
    const city = typeof userInfo.city === 'string' ? userInfo.city : null;
    const postalCode =
        typeof userInfo.postalCode === 'string'
            ? userInfo.postalCode
            : null;
    const zoneCode =
        typeof userInfo.zoneCode === 'string' ? userInfo.zoneCode : getZonalCodeFromState(userInfo.state);
    const state =
        typeof userInfo.state === 'string' ? userInfo.state : null;

    // Required fields validation - at least phone OR email must be present
    const hasPhone = typeof userInfo.phone === 'string';
    const hasEmail = typeof email === 'string' && email.length > 0;

    if (!hasPhone && !hasEmail) {
        return null;
    }

    // Return the parsed object
    return {
        shopUrl,
        items: items.map((item: any) => ({
            variantId: item.variantId,
            quantity: item.quantity,
        })),
        userInfo: {
            firstName,
            lastName,
            phone: hasPhone ? userInfo.phone : '',
            countryCode,
            address,
            city,
            postalCode,
            zoneCode,
            email,
            state
        },
        customAttributes: typeof customAttributes === 'object' && customAttributes !== null ? {
            abandonedRecoveryUrl: typeof customAttributes.abandonedRecoveryUrl === 'string' ? customAttributes.abandonedRecoveryUrl : null,
            cartToken: typeof customAttributes.cartToken === 'string' ? customAttributes.cartToken : null,
            fbclid: typeof customAttributes.fbclid === 'string' ? customAttributes.fbclid : null,
            utmMedium: typeof customAttributes.utmMedium === 'string' ? customAttributes.utmMedium : null,
            utmCampaign: typeof customAttributes.utmCampaign === 'string' ? customAttributes.utmCampaign : null,
            utmContent: typeof customAttributes.utmContent === 'string' ? customAttributes.utmContent : null,
            utmSource: typeof customAttributes.utmSource === 'string' ? customAttributes.utmSource : null,
            breeze_checkout_url: typeof customAttributes.breeze_checkout_url === 'string' ? customAttributes.breeze_checkout_url : null,
            breeze_abandoned_checkout_url: typeof customAttributes.breeze_abandoned_checkout_url === 'string' ? customAttributes.breeze_abandoned_checkout_url : null,
            // Pass through any additional custom attributes as-is
            ...Object.entries(customAttributes).reduce((acc, [key, value]) => {
                // Skip known fields that are already handled above
                const knownFields = ['abandonedRecoveryUrl', 'cartToken', 'fbclid', 'utmMedium', 'utmCampaign', 'utmContent', 'utmSource', 'breeze_checkout_url', 'breeze_abandoned_checkout_url'];
                if (!knownFields.includes(key) && typeof value === 'string') {
                    acc[key] = value;
                }
                return acc;
            }, {} as Record<string, string>)
        } : null,
        retryCount: 0
    };
}

export function decodeAbandonmentRequest(rawInput: any): AbandonmentRequest | null {
    if (
        typeof rawInput !== 'object' ||
        !rawInput ||
        !Array.isArray(rawInput.abandonments)
    ) {
        return null;
    }

    const abandonments: AbandonmentInfo[] = [];

    for (const rawAbandonment of rawInput.abandonments) {
        const decodedAbandonment = decodeAbandonmentInfo(rawAbandonment);
        if (!decodedAbandonment) {
            return null;
        }
        abandonments.push(decodedAbandonment);
    }

    return {
        abandonments
    };
}

/**
 * Maps a state name to its corresponding zonal code
 * @param state - The state name to look up
 * @returns The zonal code if found, null otherwise
 */
export function getZonalCodeFromState(state: string): string | null {
    if (!state) return null;

    const stateToZonalCode: Record<string, { code: string; alternates: string[] }> = {
        "andaman and nicobar islands": { code: "AN", alternates: ["andaman and nicobar"] },
        "andhra pradesh": { code: "AP", alternates: [] },
        "arunachal pradesh": { code: "AR", alternates: [] },
        "assam": { code: "AS", alternates: [] },
        "bihar": { code: "BR", alternates: [] },
        "chandigarh": { code: "CH", alternates: [] },
        "chhattisgarh": { code: "CG", alternates: ["chattisgarh", "ct"] },
        "dadra and nagar haveli": { code: "DN", alternates: [] },
        "daman and diu": { code: "DD", alternates: [] },
        "delhi": { code: "DL", alternates: [] },
        "goa": { code: "GA", alternates: [] },
        "gujarat": { code: "GJ", alternates: [] },
        "haryana": { code: "HR", alternates: [] },
        "himachal pradesh": { code: "HP", alternates: [] },
        "jammu and kashmir": { code: "JK", alternates: [] },
        "jharkhand": { code: "JH", alternates: [] },
        "karnataka": { code: "KA", alternates: [] },
        "kerala": { code: "KL", alternates: [] },
        "ladakh": { code: "LA", alternates: [] },
        "lakshadweep": { code: "LD", alternates: [] },
        "madhya pradesh": { code: "MP", alternates: [] },
        "maharashtra": { code: "MH", alternates: [] },
        "manipur": { code: "MN", alternates: [] },
        "meghalaya": { code: "ML", alternates: [] },
        "mizoram": { code: "MZ", alternates: [] },
        "nagaland": { code: "NL", alternates: [] },
        "odisha": { code: "OR", alternates: ["od", "orissa"] },
        "puducherry": { code: "PY", alternates: [] },
        "punjab": { code: "PB", alternates: [] },
        "rajasthan": { code: "RJ", alternates: [] },
        "sikkim": { code: "SK", alternates: [] },
        "tamil nadu": { code: "TN", alternates: [] },
        "telangana": { code: "TS", alternates: [] },
        "tripura": { code: "TR", alternates: [] },
        "uttar pradesh": { code: "UP", alternates: [] },
        "uttarakhand": { code: "UK", alternates: [] },
        "west bengal": { code: "WB", alternates: [] }
    };

    const normalizedState = state.toLowerCase();

    // Direct match
    if (stateToZonalCode[normalizedState]) {
        return stateToZonalCode[normalizedState].code;
    }

    // Check alternate values
    for (const [stateName, data] of Object.entries(stateToZonalCode)) {
        if (data.alternates.includes(normalizedState)) {
            return data.code;
        }
    }

    return null;
}
