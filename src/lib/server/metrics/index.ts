/**
 * Metrics Module
 *
 * Centralized exports for metrics functionality.
 * Provides counters, gauges, and histograms with OpenTelemetry integration.
 *
 * @example
 * ```typescript
 * import { getMetricsService, MetricNames, LabelNames } from '$lib/server/metrics';
 *
 * const metrics = getMetricsService();
 *
 * // Create and use counter
 * const counter = metrics.counter({
 *   name: MetricNames.API_REQUESTS,
 *   description: 'Total API requests'
 * });
 * counter.inc({ [LabelNames.ENDPOINT]: '/api/abandon' });
 *
 * // Create and use gauge
 * const gauge = metrics.gauge({
 *   name: MetricNames.QUEUE_DEPTH,
 *   description: 'Current queue depth'
 * });
 * gauge.set(42, { [LabelNames.QUEUE_TYPE]: 'main' });
 *
 * // Create and use histogram
 * const histogram = metrics.histogram({
 *   name: MetricNames.API_REQUEST_DURATION,
 *   description: 'API request duration',
 *   unit: 'seconds'
 * });
 * histogram.record(0.25, { [LabelNames.ENDPOINT]: '/api/abandon' });
 * ```
 *
 * @module metrics
 */

// Service
export { getMetricsService, resetMetricsService } from './metrics.service';

// Types and interfaces
export type {
	Counter,
	CounterConfig,
	Gauge,
	GaugeConfig,
	Histogram,
	HistogramConfig,
	MetricLabels,
	MetricsService
} from './metrics.types';

// Constants
export { MetricNames, LabelNames } from './metrics.types';

// Aliases for backwards compatibility
export { MetricNames as StandardMetricName, LabelNames as StandardLabelName } from './metrics.types';
