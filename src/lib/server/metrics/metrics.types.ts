/**
 * Metrics Types
 *
 * Type definitions for metrics collection service.
 * Supports counters, gauges, and histograms with OpenTelemetry integration.
 */

/**
 * Metric labels for categorizing measurements
 */
export interface MetricLabels {
	[key: string]: string | number | boolean;
}

/**
 * Counter metric configuration
 * Counters are monotonically increasing values (e.g., total requests, errors)
 */
export interface CounterConfig {
	name: string;
	description: string;
	unit?: string;
}

/**
 * Gauge metric configuration
 * Gauges represent values that can go up or down (e.g., queue depth, active workers)
 */
export interface GaugeConfig {
	name: string;
	description: string;
	unit?: string;
}

/**
 * Histogram metric configuration
 * Histograms track distributions of values (e.g., request duration, processing time)
 */
export interface HistogramConfig {
	name: string;
	description: string;
	unit?: string;
	/**
	 * Bucket boundaries for histogram
	 * Default: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
	 */
	boundaries?: number[];
}

/**
 * Counter metric interface
 */
export interface Counter {
	/**
	 * Increment counter by 1
	 * @param labels - Optional labels to attach to the metric
	 */
	inc(labels?: MetricLabels): void;

	/**
	 * Add value to counter
	 * @param value - Value to add (must be positive)
	 * @param labels - Optional labels to attach to the metric
	 */
	add(value: number, labels?: MetricLabels): void;
}

/**
 * Gauge metric interface
 */
export interface Gauge {
	/**
	 * Set gauge to specific value
	 * @param value - Value to set
	 * @param labels - Optional labels to attach to the metric
	 */
	set(value: number, labels?: MetricLabels): void;

	/**
	 * Increment gauge by 1
	 * @param labels - Optional labels to attach to the metric
	 */
	inc(labels?: MetricLabels): void;

	/**
	 * Decrement gauge by 1
	 * @param labels - Optional labels to attach to the metric
	 */
	dec(labels?: MetricLabels): void;

	/**
	 * Add value to gauge
	 * @param value - Value to add (can be negative)
	 * @param labels - Optional labels to attach to the metric
	 */
	add(value: number, labels?: MetricLabels): void;
}

/**
 * Histogram metric interface
 */
export interface Histogram {
	/**
	 * Record a value in the histogram
	 * @param value - Value to record
	 * @param labels - Optional labels to attach to the metric
	 */
	record(value: number, labels?: MetricLabels): void;
}

/**
 * Metrics service interface
 */
export interface MetricsService {
	/**
	 * Create or get a counter metric
	 * @param config - Counter configuration
	 * @returns Counter instance
	 */
	counter(config: CounterConfig): Counter;

	/**
	 * Create or get a gauge metric
	 * @param config - Gauge configuration
	 * @returns Gauge instance
	 */
	gauge(config: GaugeConfig): Gauge;

	/**
	 * Create or get a histogram metric
	 * @param config - Histogram configuration
	 * @returns Histogram instance
	 */
	histogram(config: HistogramConfig): Histogram;

	/**
	 * Check if metrics collection is enabled
	 */
	isEnabled(): boolean;
}

/**
 * Standard metric names for the application
 */
export const MetricNames = {
	// Abandonment metrics
	ABANDONMENTS_RECEIVED: 'abandonments.received.total',
	ABANDONMENTS_PROCESSED: 'abandonments.processed.total',
	ABANDONMENTS_FAILED: 'abandonments.failed.total',
	ABANDONMENTS_RETRIED: 'abandonments.retried.total',
	ABANDONMENT_DURATION: 'abandonment.processing.duration.seconds',

	// Queue metrics
	QUEUE_DEPTH: 'queue.depth',
	QUEUE_WAIT_TIME: 'queue.wait.time.seconds',
	BATCH_DURATION: 'batch.processing.duration.seconds',

	// API metrics
	API_REQUESTS: 'api.requests.total',
	API_REQUESTS_NON_200: 'api.requests.non_200.total',
	API_REQUEST_DURATION: 'api.request.duration.seconds',

	// Proposal API metrics
	PROPOSAL_REQUESTS: 'proposal.requests.total',
	PROPOSAL_SUCCESS: 'proposal.success.total',
	PROPOSAL_FAILED: 'proposal.failed.total',
	PROPOSAL_DURATION: 'proposal.request.duration.seconds',
	PROPOSAL_EXTRACTION_SUCCESS: 'proposal.extraction.success.total',
	PROPOSAL_EXTRACTION_FAILED: 'proposal.extraction.failed.total',
	PROPOSAL_PAYLOAD_SIZE: 'proposal.payload.size.bytes',

	// System metrics
	ACTIVE_WORKERS: 'workers.active',
	ALERTS_SENT: 'alerts.sent.total'
} as const;

/**
 * Standard label names for metrics
 */
export const LabelNames = {
	// Abandonment labels
	SHOP: 'shop',
	MODE: 'mode',
	STATUS: 'status',
	ERROR_TYPE: 'error_type',
	RETRY_ATTEMPT: 'retry_attempt',

	// API labels
	ENDPOINT: 'endpoint',
	STATUS_CODE: 'status_code',
	METHOD: 'method',

	// Queue labels
	QUEUE_TYPE: 'queue_type',

	// Alert labels
	SEVERITY: 'severity',
	ALERT_TYPE: 'alert_type',

	// General labels
	SUCCESS: 'success'
} as const;
