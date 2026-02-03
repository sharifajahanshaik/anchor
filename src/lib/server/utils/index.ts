/**
 * Common utility functions
 *
 * Note: Slack alerts migrated to src/lib/server/alerts/
 * Note: Logging migrated to src/lib/server/logger/
 */

import type { AbandonmentInfo } from "$lib/types";

/**
 * Sleep utility - delays execution for specified milliseconds
 */
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Splits an array into chunks of specified size
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

/**
 * Masks sensitive data in an abandonment object for security purposes
 * @param abandonment - The abandonment info object containing sensitive data
 * @returns A deep copy of the abandonment object with sensitive data masked
 */
export function maskSensitiveData(abandonment: AbandonmentInfo): AbandonmentInfo {
    // Create a deep copy to avoid modifying the original object
    const maskedAbandonment = JSON.parse(JSON.stringify(abandonment)) as AbandonmentInfo;
    const userInfo = maskedAbandonment.userInfo;

    // Mask phone number (leave first two and last two digits)
    if (userInfo.phone && userInfo.phone.length > 4) {
        const firstTwo = userInfo.phone.substring(0, 2);
        const lastTwo = userInfo.phone.substring(userInfo.phone.length - 2);
        const maskedPart = '*'.repeat(userInfo.phone.length - 4);
        userInfo.phone = `${firstTwo}${maskedPart}${lastTwo}`;
    }

    // Mask email (leave first 2 chars and last 5 chars)
    if (userInfo.email && userInfo.email.length > 7) {
        const firstTwo = userInfo.email.substring(0, 2);
        const lastFive = userInfo.email.substring(userInfo.email.length - 5);
        const maskedPart = '*'.repeat(Math.max(1, userInfo.email.length - 7));
        userInfo.email = `${firstTwo}${maskedPart}${lastFive}`;
    }

    // Mask address (leave first 2 and last 3 chars)
    if (userInfo.address && userInfo.address.length > 5) {
        const firstTwo = userInfo.address.substring(0, 2);
        const lastThree = userInfo.address.substring(userInfo.address.length - 3);
        const maskedPart = '*'.repeat(userInfo.address.length - 5);
        userInfo.address = `${firstTwo}${maskedPart}${lastThree}`;
    }

    // We don't mask abandonedRecoveryUrl as per requirements

    return maskedAbandonment;
}
