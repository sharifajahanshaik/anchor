/**
 * Batch Processor
 * Handles batch processing logic and queue processing
 */

import type { AbandonmentInfo } from '$lib/types';
import { AbandonmentProcessingError } from '$lib/types/error.types';
import { sleep } from '../utils';
import { getLogger } from '../logger';
import {
	getRetryQueue,
	addToRetryQueue
} from './queue.manager';
import {
	MAX_RETRY_LIMIT,
	sendMaxRetriesAlert,
	sendNonRetryableAlert
} from './retry.manager';

const logger = getLogger('batch-processor');

/**
 * Batch size for processing abandonments
 */
export const BATCH_SIZE = 50;

/**
 * Type for the checkout creator function (injected from abandonment.service.ts)
 */
type CheckoutCreatorFn = (
	shopUrl: string,
	items: AbandonmentInfo['items'],
	userInfo: AbandonmentInfo['userInfo'],
	customAttributes: AbandonmentInfo['customAttributes'],
	requestId: string
) => Promise<number | null>;

/**
 * Reference to the checkout creator function (injected from abandonment.service.ts)
 */
let checkoutCreatorFn: CheckoutCreatorFn | null = null;

/**
 * Set the checkout creator function to use for processing
 * This is called by abandonment.service.ts to inject the dependency
 */
export function setCheckoutCreatorFn(fn: CheckoutCreatorFn): void {
	checkoutCreatorFn = fn;
}

/**
 * Process a single abandonment item
 * @param abandonment - The abandonment to process
 * @param index - Index in the batch (for logging)
 */
async function processAbandonmentItem(
	abandonment: AbandonmentInfo,
	index: number
): Promise<void> {
	if (!checkoutCreatorFn) {
		throw new Error('checkoutCreatorFn not set - call setCheckoutCreatorFn() first');
	}

	const { shopUrl, items, userInfo, customAttributes, retryCount } = abandonment;
	const requestId = abandonment.id || `fallback-${Date.now()}-${index}`;

	logger.debug('Processing abandonment', {
		index,
		requestId,
		retryCount
	});

	try {
		// Try to create checkout
		const result = await checkoutCreatorFn(shopUrl, items, userInfo, customAttributes, requestId);

		if (result === null) {
			// Legacy null return - treat as retryable failure
			const newRetryCount = retryCount + 1;

			if (newRetryCount < MAX_RETRY_LIMIT) {
				logger.info('Checkout creation failed, adding to retry queue', {
					index,
					requestId,
					currentRetryCount: retryCount,
					newRetryCount
				});

				addToRetryQueue([{
					...abandonment,
					retryCount: newRetryCount
				}]);
			} else {
				// Max retries reached - send alert
				logger.warn('Max retries reached, sending alert', {
					index,
					requestId,
					finalRetryCount: retryCount
				});

				await sendMaxRetriesAlert(abandonment);
			}
		} else {
			// Success
			logger.info('Checkout created successfully', {
				index,
				requestId,
				wasRetry: retryCount > 0,
				retryCount
			});
		}
	} catch (error) {
		// Handle AbandonmentProcessingError with retryable flag
		if (error instanceof AbandonmentProcessingError) {
			if (error.retryable) {
				// Retryable error - add to retry queue
				const newRetryCount = retryCount + 1;

				if (newRetryCount < MAX_RETRY_LIMIT) {
					logger.info('Retryable error occurred, adding to retry queue', {
						index,
						requestId,
						errorCode: error.code,
						errorMessage: error.message,
						currentRetryCount: retryCount,
						newRetryCount
					});

					addToRetryQueue([{
						...abandonment,
						retryCount: newRetryCount
					}]);
				} else {
					// Max retries reached - send alert
					logger.warn('Max retries reached after retryable error, sending alert', {
						index,
						requestId,
						errorCode: error.code,
						errorMessage: error.message,
						finalRetryCount: retryCount
					});

					await sendMaxRetriesAlert(abandonment);
				}
			} else {
				// Non-retryable error - do NOT retry, send immediate alert
				logger.warn('Non-retryable error occurred, sending immediate alert', {
					index,
					requestId,
					errorCode: error.code,
					errorMessage: error.message,
					retryCount
				});

				// Send immediate alert for non-retryable errors
				await sendNonRetryableAlert(abandonment, error);
			}
		} else {
			// Unknown error type - log and don't retry to be safe
			logger.error('Unexpected error during checkout creation', error instanceof Error ? error : new Error(String(error)), {
				index,
				requestId,
				retryCount
			});
		}
	}
}

/**
 * Process a queue in batches
 * @param queue - The queue to process (abandonment or retry)
 * @param queueType - Type of queue being processed (for logging)
 */
export async function processQueue(queue: AbandonmentInfo[], queueType: 'abandonment' | 'retry'): Promise<void> {
	logger.info('Starting to process queue', {
		queueSize: queue.length,
		queueType
	});

	while (queue.length > 0) {
		// Take next batch from queue
		const batch = queue.splice(0, BATCH_SIZE);
		logger.info('Processing batch', {
			batchSize: batch.length,
			queueType
		});

		// Process all items in parallel (Promise.allSettled never throws)
		await Promise.allSettled(
			batch.map((abandonment, index) =>
				processAbandonmentItem(abandonment, index)
			)
		);

		// Small delay between batches to avoid overwhelming the system
		await sleep(1000);
	}

	logger.info('Queue processing complete', { queueType });
}
