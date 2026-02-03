/**
 * Retry Manager
 * Handles retry logic for abandonment processing
 */

import type { AbandonmentInfo } from '$lib/types';
import { maskSensitiveData } from '../utils';
import { getAlertService } from '../alerts/alert.service';
import { AlertType, AlertSeverity } from '../alerts/alert.types';

const alertService = getAlertService();

/**
 * Maximum number of retry attempts before giving up
 */
export const MAX_RETRY_LIMIT = 3;

/**
 * Send max retries alert
 * @param abandonment - The abandonment info that reached max retries
 */
export async function sendMaxRetriesAlert(
	abandonment: AbandonmentInfo
): Promise<void> {
	await alertService.sendAlert({
		type: AlertType.ABANDONMENT_FAILED,
		severity: AlertSeverity.ERROR,
		title: 'Max Retries Reached',
		message: `Cannot retrieve checkout token after ${MAX_RETRY_LIMIT} retries`,
		context: {
			shop: abandonment.shopUrl,
			...maskSensitiveData(abandonment)
		}
	});
}

/**
 * Send non-retryable error alert (immediate)
 * @param abandonment - The abandonment info that failed
 * @param error - The error that occurred
 */
export async function sendNonRetryableAlert(
	abandonment: AbandonmentInfo,
	error: { code: string; message: string; errorDetails?: any }
): Promise<void> {
	await alertService.sendAlert({
		type: AlertType.ABANDONMENT_FAILED,
		severity: AlertSeverity.ERROR,
		title: 'Non-Retryable Abandonment Error',
		message: error.message,
		context: {
			shop: abandonment.shopUrl,
			errorCode: error.code,
			errorDetails: error.errorDetails,
			...maskSensitiveData(abandonment)
		}
	});
}
