/**
 * Monitoring Summary Reporter
 *
 * Sends periodic system health summaries to Slack.
 * Provides hourly and daily reports with aggregated statistics.
 */

import type { ApiResponseMonitor } from './api-response.monitor';
import { getAlertService } from '../alerts/alert.service';
import { logger } from '../logger/index';
import { AlertType, AlertSeverity, type Alert } from '../alerts/alert.types';
import type { ApiResponseData } from './monitoring.types';

/**
 * Summary statistics
 */
export interface SummaryStats {
	totalResponses: number;
	successResponses: number;
	errorResponses: number;
	averageDurationMs: number;
	endpointBreakdown: Record<string, number>;
}

/**
 * Shop failure statistics
 */
export interface ShopFailureStats {
	shop: string;
	count: number;
	statusCodes: Map<number, number>;
}

/**
 * Reporter configuration
 */
export interface SummaryReporterConfig {
	/** Enable hourly reports */
	enableHourly: boolean;
	/** Enable daily reports */
	enableDaily: boolean;
	/** Business hours start (24h format, e.g., 9 for 9 AM) */
	businessHoursStart: number;
	/** Business hours end (24h format, e.g., 18 for 6 PM) */
	businessHoursEnd: number;
	/** Timezone offset from UTC (e.g., +5.5 for IST) */
	timezoneOffset: number;
	/** Daily report time (24h format, e.g., 23 for 11 PM) */
	dailyReportHour: number;
	/** Number of top failing shops to include */
	topFailingShopsLimit: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: SummaryReporterConfig = {
	enableHourly: true,
	enableDaily: true,
	businessHoursStart: 9, // 9 AM
	businessHoursEnd: 18, // 6 PM
	timezoneOffset: 5.5, // IST (UTC+5:30)
	dailyReportHour: 23, // 11 PM
	topFailingShopsLimit: 5
};

/**
 * Monitoring Summary Reporter
 */
export class MonitoringSummaryReporter {
	private config: SummaryReporterConfig;
	private hourlyIntervalId: NodeJS.Timeout | null = null;
	private dailyCheckIntervalId: NodeJS.Timeout | null = null;
	private lastDailyReportDate: string | null = null;

	constructor(
		private monitor: ApiResponseMonitor,
		config?: Partial<SummaryReporterConfig>
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };

		logger.info('Monitoring summary reporter initialized', {
			enableHourly: this.config.enableHourly,
			enableDaily: this.config.enableDaily,
			businessHours: `${this.config.businessHoursStart}:00-${this.config.businessHoursEnd}:00`,
			dailyReportHour: this.config.dailyReportHour,
			timezoneOffset: this.config.timezoneOffset
		});
	}

	/**
	 * Start the reporter
	 */
	start(): void {
		// Hourly reports during business hours
		if (this.config.enableHourly) {
			this.hourlyIntervalId = setInterval(() => {
				if (this.isBusinessHours()) {
					this.sendHourlySummary().catch((error) => {
						logger.error('Failed to send hourly summary', error as Error);
					});
				}
			}, 60 * 60 * 1000); // Every hour

			logger.info('Hourly summary reporter started');
		}

		// Daily reports - check every 15 minutes
		if (this.config.enableDaily) {
			this.dailyCheckIntervalId = setInterval(() => {
				this.checkAndSendDailyReport().catch((error) => {
					logger.error('Failed to send daily summary', error as Error);
				});
			}, 15 * 60 * 1000); // Every 15 minutes

			logger.info('Daily summary reporter started');
		}
	}

	/**
	 * Stop the reporter
	 */
	stop(): void {
		if (this.hourlyIntervalId) {
			clearInterval(this.hourlyIntervalId);
			this.hourlyIntervalId = null;
			logger.info('Hourly summary reporter stopped');
		}

		if (this.dailyCheckIntervalId) {
			clearInterval(this.dailyCheckIntervalId);
			this.dailyCheckIntervalId = null;
			logger.info('Daily summary reporter stopped');
		}
	}

	/**
	 * Send hourly summary
	 */
	private async sendHourlySummary(): Promise<void> {
		const hourMs = 60 * 60 * 1000;
		const summary = this.monitor.getSummary(hourMs);
		const failures = this.monitor.getNon200Responses(hourMs);

		// Skip if no requests in the last hour
		if (summary.totalResponses === 0) {
			logger.debug('No requests in last hour, skipping hourly summary');
			return;
		}

		const successRate =
			summary.totalResponses > 0
				? ((summary.successResponses / summary.totalResponses) * 100).toFixed(2)
				: '0';

		const failuresByShop = this.groupFailuresByShop(failures);
		const topFailingShops = this.getTopFailingShops(
			failuresByShop,
			this.config.topFailingShopsLimit
		);
		const failuresByStatus = this.groupFailuresByStatus(failures);

		const alert: Alert = {
			type: AlertType.SYSTEM_HEALTH,
			severity: this.getSeverityFromSuccessRate(Number(successRate)),
			title: '📊 Hourly System Health Report',
			message: this.formatHourlySummaryMessage(
				summary,
				successRate,
				topFailingShops,
				failuresByStatus
			),
			timestamp: new Date()
		};

		await getAlertService().sendAlert(alert);

		logger.info('Hourly summary sent', {
			totalRequests: summary.totalResponses,
			successRate: `${successRate}%`,
			failures: failures.length
		});

		// Cleanup old data (keep last 2 hours)
		this.monitor.cleanup(hourMs * 2);
	}

	/**
	 * Check and send daily report if needed
	 */
	private async checkAndSendDailyReport(): Promise<void> {
		const now = this.getCurrentLocalTime();
		const currentHour = now.getHours();
		const currentDate = now.toISOString().split('T')[0];

		// Check if it's time for daily report and we haven't sent it today
		if (
			currentHour === this.config.dailyReportHour &&
			this.lastDailyReportDate !== currentDate
		) {
			await this.sendDailySummary();
			this.lastDailyReportDate = currentDate;
		}
	}

	/**
	 * Send daily summary
	 */
	private async sendDailySummary(): Promise<void> {
		const dayMs = 24 * 60 * 60 * 1000;
		const summary = this.monitor.getSummary(dayMs);
		const failures = this.monitor.getNon200Responses(dayMs);

		// Skip if no requests in the last day
		if (summary.totalResponses === 0) {
			logger.debug('No requests in last 24 hours, skipping daily summary');
			return;
		}

		const successRate =
			summary.totalResponses > 0
				? ((summary.successResponses / summary.totalResponses) * 100).toFixed(2)
				: '0';

		const failuresByShop = this.groupFailuresByShop(failures);
		const topFailingShops = this.getTopFailingShops(
			failuresByShop,
			this.config.topFailingShopsLimit
		);
		const failuresByStatus = this.groupFailuresByStatus(failures);

		const alert: Alert = {
			type: AlertType.SYSTEM_HEALTH,
			severity: this.getSeverityFromSuccessRate(Number(successRate)),
			title: '📅 Daily System Health Report',
			message: this.formatDailySummaryMessage(
				summary,
				successRate,
				topFailingShops,
				failuresByStatus,
				failures
			),
			timestamp: new Date(),
			// Mention users for daily summary if there are significant issues
			mentionUsers:
				Number(successRate) < 95 ? ['U06BPLC172N', 'U0403DP9FJ6'] : undefined
		};

		await getAlertService().sendAlert(alert);

		logger.info('Daily summary sent', {
			totalRequests: summary.totalResponses,
			successRate: `${successRate}%`,
			failures: failures.length
		});

		// Cleanup old data (keep last 48 hours)
		this.monitor.cleanup(dayMs * 2);
	}

	/**
	 * Format hourly summary message
	 */
	private formatHourlySummaryMessage(
		summary: SummaryStats,
		successRate: string,
		topFailingShops: ShopFailureStats[],
		failuresByStatus: Map<number, number>
	): string {
		const lines = [
			`*Period:* Last 1 hour`,
			`*Total Requests:* ${summary.totalResponses.toLocaleString()}`,
			`*Success Rate:* ${successRate}% (${summary.successResponses.toLocaleString()}/${summary.totalResponses.toLocaleString()})`,
			`*Failed Requests:* ${summary.errorResponses.toLocaleString()}`,
			`*Avg Response Time:* ${summary.averageDurationMs.toFixed(0)}ms`
		];

		// Add endpoint breakdown if multiple endpoints
		if (Object.keys(summary.endpointBreakdown).length > 1) {
			lines.push('', '*Endpoint Breakdown:*');
			Object.entries(summary.endpointBreakdown)
				.sort((a, b) => b[1] - a[1])
				.forEach(([endpoint, count]) => {
					lines.push(`  • ${endpoint}: ${count.toLocaleString()} requests`);
				});
		}

		// Add top failing shops if any
		if (topFailingShops.length > 0) {
			lines.push('', '*Top Failing Shops:*');
			topFailingShops.forEach(({ shop, count, statusCodes }) => {
				const statusBreakdown = Array.from(statusCodes.entries())
					.map(([code, cnt]) => `${code}:${cnt}`)
					.join(', ');
				lines.push(`  • ${shop}: ${count} failures (${statusBreakdown})`);
			});
		}

		// Add failure breakdown by status code
		if (failuresByStatus.size > 0) {
			lines.push('', '*Failures by Status Code:*');
			Array.from(failuresByStatus.entries())
				.sort((a, b) => b[1] - a[1])
				.forEach(([status, count]) => {
					lines.push(`  • ${status}: ${count} occurrences`);
				});
		}

		return lines.join('\n');
	}

	/**
	 * Format daily summary message
	 */
	private formatDailySummaryMessage(
		summary: SummaryStats,
		successRate: string,
		topFailingShops: ShopFailureStats[],
		failuresByStatus: Map<number, number>,
		failures: ApiResponseData[]
	): string {
		const lines = [
			`*Period:* Last 24 hours`,
			`*Total Requests:* ${summary.totalResponses.toLocaleString()}`,
			`*Success Rate:* ${successRate}% (${summary.successResponses.toLocaleString()}/${summary.totalResponses.toLocaleString()})`,
			`*Failed Requests:* ${summary.errorResponses.toLocaleString()}`,
			`*Avg Response Time:* ${summary.averageDurationMs.toFixed(0)}ms`
		];

		// Add endpoint breakdown
		lines.push('', '*Endpoint Breakdown:*');
		Object.entries(summary.endpointBreakdown)
			.sort((a, b) => b[1] - a[1])
			.forEach(([endpoint, count]) => {
				const percentage = ((count / summary.totalResponses) * 100).toFixed(1);
				lines.push(
					`  • ${endpoint}: ${count.toLocaleString()} requests (${percentage}%)`
				);
			});

		// Add top failing shops if any
		if (topFailingShops.length > 0) {
			lines.push('', '*Top Failing Shops:*');
			topFailingShops.forEach(({ shop, count, statusCodes }) => {
				const statusBreakdown = Array.from(statusCodes.entries())
					.sort((a, b) => b[1] - a[1])
					.slice(0, 3) // Top 3 status codes per shop
					.map(([code, cnt]) => `${code}:${cnt}`)
					.join(', ');
				lines.push(`  • ${shop}: ${count} failures (${statusBreakdown})`);
			});
		}

		// Add failure breakdown by status code
		if (failuresByStatus.size > 0) {
			lines.push('', '*Failures by Status Code:*');
			Array.from(failuresByStatus.entries())
				.sort((a, b) => b[1] - a[1])
				.forEach(([status, count]) => {
					const percentage = ((count / failures.length) * 100).toFixed(1);
					lines.push(`  • ${status}: ${count} occurrences (${percentage}%)`);
				});
		}

		// Add performance insight
		const performanceEmoji =
			summary.averageDurationMs < 500 ? '🚀' : summary.averageDurationMs < 1000 ? '✅' : '⚠️';
		lines.push('', `*Performance:* ${performanceEmoji} Avg ${summary.averageDurationMs.toFixed(0)}ms`);

		return lines.join('\n');
	}

	/**
	 * Group failures by shop
	 */
	private groupFailuresByShop(failures: ApiResponseData[]): Map<string, ShopFailureStats> {
		const grouped = new Map<string, ShopFailureStats>();

		failures.forEach((failure) => {
			if (!grouped.has(failure.shop)) {
				grouped.set(failure.shop, {
					shop: failure.shop,
					count: 0,
					statusCodes: new Map()
				});
			}

			const stats = grouped.get(failure.shop)!;
			stats.count++;

			const statusCount = stats.statusCodes.get(failure.statusCode) || 0;
			stats.statusCodes.set(failure.statusCode, statusCount + 1);
		});

		return grouped;
	}

	/**
	 * Get top failing shops
	 */
	private getTopFailingShops(
		failuresByShop: Map<string, ShopFailureStats>,
		limit: number
	): ShopFailureStats[] {
		return Array.from(failuresByShop.values())
			.sort((a, b) => b.count - a.count)
			.slice(0, limit);
	}

	/**
	 * Group failures by status code
	 */
	private groupFailuresByStatus(failures: ApiResponseData[]): Map<number, number> {
		const grouped = new Map<number, number>();

		failures.forEach((failure) => {
			const count = grouped.get(failure.statusCode) || 0;
			grouped.set(failure.statusCode, count + 1);
		});

		return grouped;
	}

	/**
	 * Get severity from success rate
	 */
	private getSeverityFromSuccessRate(successRate: number): AlertSeverity {
		if (successRate >= 99) return AlertSeverity.INFO;
		if (successRate >= 95) return AlertSeverity.WARN;
		if (successRate >= 90) return AlertSeverity.ERROR;
		return AlertSeverity.CRITICAL;
	}

	/**
	 * Check if current time is within business hours
	 */
	private isBusinessHours(): boolean {
		const now = this.getCurrentLocalTime();
		const hour = now.getHours();

		return hour >= this.config.businessHoursStart && hour < this.config.businessHoursEnd;
	}

	/**
	 * Get current time in local timezone
	 */
	private getCurrentLocalTime(): Date {
		const now = new Date();
		const utc = now.getTime() + now.getTimezoneOffset() * 60000;
		return new Date(utc + this.config.timezoneOffset * 3600000);
	}
}

/**
 * Create and configure summary reporter
 */
export function createSummaryReporter(
	monitor: ApiResponseMonitor,
	config?: Partial<SummaryReporterConfig>
): MonitoringSummaryReporter {
	return new MonitoringSummaryReporter(monitor, config);
}
