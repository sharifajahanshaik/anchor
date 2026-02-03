<script lang="ts">
	interface ComponentCheck {
		status: string;
		message: string;
		responseTime?: number;
		error?: string;
	}

	interface HealthResponse {
		status: string;
		timestamp: string;
		checks?: Record<string, ComponentCheck>;
		error?: string;
	}

	let checking = false;
	let healthStatus: HealthResponse | null = null;

	async function checkHealth() {
		checking = true;
		try {
			const response = await fetch('/api/health');
			healthStatus = await response.json();
		} catch (error) {
			healthStatus = { status: 'error', timestamp: new Date().toISOString(), error: 'Failed to fetch health status' };
		} finally {
			checking = false;
		}
	}
</script>

<div style="font-family: system-ui; padding: 2rem; max-width: 800px;">
	<h1>Anchor - Cart Abandonment Automation</h1>
	<p style="color: #666;">Application is running</p>

	<div style="margin-top: 2rem;">
		<button
			on:click={checkHealth}
			disabled={checking}
			style="padding: 0.5rem 1rem; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 4px;"
		>
			{checking ? 'Checking...' : 'Check Health'}
		</button>

		{#if healthStatus}
			<div style="margin-top: 1rem; padding: 1rem; background: #f5f5f5; border-radius: 4px;">
				<strong>Status:</strong>
				<span style="color: {healthStatus.status === 'healthy' ? 'green' : healthStatus.status === 'degraded' ? 'orange' : 'red'}">
					{healthStatus.status?.toUpperCase()}
				</span>
				{#if healthStatus.checks}
					<div style="margin-top: 1rem;">
						<strong>Components:</strong>
						<ul style="margin-top: 0.5rem;">
							{#each Object.entries(healthStatus.checks) as [name, check]}
								<li>
									<strong>{name}:</strong>
									<span style="color: {check.status === 'healthy' ? 'green' : check.status === 'degraded' ? 'orange' : 'red'}">
										{check.status}
									</span>
									- {check.message}
									{#if check.responseTime}
										<em>({check.responseTime}ms)</em>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<div style="margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #ddd; color: #666; font-size: 0.875rem;">
		<p>API Endpoints:</p>
		<ul>
			<li><code>POST /api/abandon</code> - Process cart abandonments</li>
			<li><code>GET /api/health</code> - System health check</li>
		</ul>
	</div>
</div>
