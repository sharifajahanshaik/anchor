/**
 * SvelteKit Server Hooks
 *
 * This file runs on server startup and handles server-side lifecycle events.
 * Used to initialize background services like monitoring summary reporter.
 */

import type { Handle } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { createSummaryReporter } from '$lib/server/monitoring';
import { getApiResponseMonitor } from '$lib/server/http/http.client';
import { initializeCircuitBreakerAlerting } from '$lib/server/resilience';

/**
 * Initialize monitoring summary reporter
 * Sends hourly and daily health reports to Slack
 */
function initializeMonitoring() {
	try {
		const monitor = getApiResponseMonitor();
		const reporter = createSummaryReporter(monitor, {
			enableHourly: true,
			enableDaily: true,
			businessHoursStart: 9, // 9 AM IST
			businessHoursEnd: 18, // 6 PM IST
			timezoneOffset: 5.5, // IST (UTC+5:30)
			dailyReportHour: 23, // 11 PM IST
			topFailingShopsLimit: 5
		});

		reporter.start();

		logger.info('Monitoring summary reporter initialized', {
			hourlyReports: true,
			dailyReports: true,
			businessHours: '9:00-18:00 IST',
			dailyReportTime: '23:00 IST'
		});
	} catch (error) {
		logger.error('Failed to initialize monitoring summary reporter', error as Error);
	}
}

// Initialize monitoring on server startup
initializeMonitoring();

// Initialize circuit breaker alerting on server startup
initializeCircuitBreakerAlerting();

/**
 * SvelteKit handle hook
 * This runs for every server-side request
 */
export const handle: Handle = async ({ event, resolve }) => {
	// You can add request-level processing here if needed
	// For now, just pass through to SvelteKit's default handling
	return resolve(event);
};
