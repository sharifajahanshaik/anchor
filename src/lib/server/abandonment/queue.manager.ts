/**
 * Queue Manager
 * Handles queue data structures and queue operations for abandonment processing
 */

import type { AbandonmentInfo } from '$lib/types';
import { getLogger } from '../logger';

const logger = getLogger('queue-manager');

/**
 * Queue to store abandonment items to be processed
 */
const abandonmentQueue: AbandonmentInfo[] = [];

/**
 * Queue to store items that need to be retried
 */
const retryQueue: AbandonmentInfo[] = [];

/**
 * Add items to the abandonment queue
 * @param items - Array of abandonment items to add to the queue
 */
export function addToQueue(items: AbandonmentInfo[]): void {
	logger.info('Adding items to abandonment queue', {
		count: items.length,
		currentQueueSize: abandonmentQueue.length
	});

	abandonmentQueue.push(...items);

	logger.info('Items added to abandonment queue', {
		newQueueSize: abandonmentQueue.length
	});
}

/**
 * Add items to the retry queue
 * @param items - Array of abandonment items to add to the retry queue
 */
export function addToRetryQueue(items: AbandonmentInfo[]): void {
	logger.info('Adding items to retry queue', {
		count: items.length,
		currentRetryQueueSize: retryQueue.length
	});

	retryQueue.push(...items);

	logger.info('Items added to retry queue', {
		newRetryQueueSize: retryQueue.length
	});
}

/**
 * Get the current size of both queues
 * @returns Object with abandonment and retry queue sizes
 */
export function getQueueSizes(): { abandonmentQueue: number; retryQueue: number } {
	return {
		abandonmentQueue: abandonmentQueue.length,
		retryQueue: retryQueue.length
	};
}

/**
 * Get the abandonment queue
 * @returns Reference to the abandonment queue
 */
export function getAbandonmentQueue(): AbandonmentInfo[] {
	return abandonmentQueue;
}

/**
 * Get the retry queue
 * @returns Reference to the retry queue
 */
export function getRetryQueue(): AbandonmentInfo[] {
	return retryQueue;
}

/**
 * Clear all queues (useful for testing or manual reset)
 */
export function clearQueues(): void {
	logger.warn('Clearing all queues', {
		abandonmentQueueSize: abandonmentQueue.length,
		retryQueueSize: retryQueue.length
	});

	abandonmentQueue.length = 0;
	retryQueue.length = 0;

	logger.info('All queues cleared');
}

/**
 * Get the total number of items across all queues
 * @returns Total count of items in both queues
 */
export function getTotalQueueSize(): number {
	return abandonmentQueue.length + retryQueue.length;
}
