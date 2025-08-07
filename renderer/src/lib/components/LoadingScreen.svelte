<div class="loading-screen">
	<div class="loading-content">
		<img src="./loading.gif" alt="Loading..." class="loading-gif" />
		<div class="progress-container">
			<div class="progress-bar"></div>
		</div>
		<div class="progress-text">Ready!</div>
	</div>
</div>

<style>
	.loading-screen {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 250px;
		height: 250px;
		background: #0f0f23;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
		box-shadow: 0 8px 16px rgba(0, 0, 0, 0.24);
	}

	.loading-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding-bottom: 20px;
	}

	.loading-gif {
		width: 200px;
		height: 200px;
		object-fit: contain;
	}

	.progress-container {
		width: 200px;
		height: 4px;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 2px;
		overflow: hidden;
		margin-top: 8px;
		opacity: 1 !important;
		visibility: visible !important;
		position: relative;
		z-index: 1000;
	}

	.progress-bar {
		height: 100%;
		background: linear-gradient(90deg, #4f46e5, #7c3aed);
		border-radius: 2px;
		width: 100%;
		transition: width 0.3s ease;
		animation: progress-pulse 2s ease-in-out infinite;
		opacity: 1 !important;
		visibility: visible !important;
		position: relative;
		z-index: 1001;
	}

	.progress-text {
		color: #e2e8f0;
		font-size: 12px;
		font-weight: 500;
		text-align: center;
		opacity: 0.8 !important;
		visibility: visible !important;
		position: relative;
		z-index: 1000;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	@keyframes progress-pulse {
		0%, 100% {
			opacity: 0.8;
		}
		50% {
			opacity: 1;
		}
	}
</style>
