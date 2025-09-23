import { EventEmitter } from 'events';
import { ConnectionManager } from './ConnectionManager';
import { PerformanceMonitor } from './PerformanceMonitor';

interface LoadBalancerConfig {
  maxRequestsPerSecond: number;
  windowSizeMs: number;
  retryAttempts: number;
  retryDelayMs: number;
  healthCheckIntervalMs: number;
}

interface RequestQueue {
  id: string;
  operation: () => Promise<any>;
  priority: number;
  timestamp: number;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  retryCount: number;
}

interface LoadBalancerStats {
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  queuedRequests: number;
  averageResponseTime: number;
  requestsPerSecond: number;
  activeConnections: number;
}

export class LoadBalancer extends EventEmitter {
  private requestQueue: RequestQueue[] = [];
  private processing = false;
  private requestWindow: number[] = [];
  private requestCounts = new Map<string, number>();
  private connectionHealthScores = new Map<string, number>();
  private stats: LoadBalancerStats = {
    totalRequests: 0,
    completedRequests: 0,
    failedRequests: 0,
    queuedRequests: 0,
    averageResponseTime: 0,
    requestsPerSecond: 0,
    activeConnections: 0
  };
  private healthCheckInterval: NodeJS.Timeout;
  private responseTimes: number[] = [];

  constructor(
    private connectionManager: ConnectionManager,
    private performanceMonitor: PerformanceMonitor,
    private config: LoadBalancerConfig = {
      maxRequestsPerSecond: 1000,
      windowSizeMs: 1000,
      retryAttempts: 3,
      retryDelayMs: 100,
      healthCheckIntervalMs: 30000
    }
  ) {
    super();

    // Start health check monitoring
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);

    // Clean up request window periodically
    setInterval(() => {
      this.cleanupRequestWindow();
    }, this.config.windowSizeMs);

    // Start processing queue
    this.processQueue();
  }

  /**
   * Execute a load-balanced request
   */
  async execute<T>(
    operation: () => Promise<T>,
    priority: number = 0,
    operationName?: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestId = this.generateRequestId();
      const queueItem: RequestQueue = {
        id: requestId,
        operation,
        priority,
        timestamp: Date.now(),
        resolve,
        reject,
        retryCount: 0
      };

      this.requestQueue.push(queueItem);
      this.stats.totalRequests++;
      this.stats.queuedRequests++;

      // Sort queue by priority (higher priority first)
      this.requestQueue.sort((a, b) => b.priority - a.priority);

      // Emit queue size events for monitoring
      if (this.requestQueue.length > 100) {
        this.emit('queueOverflow', { queueSize: this.requestQueue.length });
      }

      if (operationName) {
        this.performanceMonitor.startOperation(requestId, operationName);
      }
    });
  }

  /**
   * Process the request queue with rate limiting
   */
  private async processQueue(): Promise<void> {
    while (true) {
      if (this.requestQueue.length === 0) {
        await this.sleep(10); // Small delay when queue is empty
        continue;
      }

      // Check rate limiting
      if (!this.canProcessRequest()) {
        await this.sleep(this.config.windowSizeMs / this.config.maxRequestsPerSecond);
        continue;
      }

      const request = this.requestQueue.shift();
      if (!request) continue;

      this.stats.queuedRequests--;

      // Process request asynchronously
      this.processRequest(request).catch(error => {
        console.error('Error processing request:', error);
      });
    }
  }

  /**
   * Process individual request
   */
  private async processRequest(request: RequestQueue): Promise<void> {
    const startTime = Date.now();

    try {
      // Get the best available connection
      const connection = await this.getBestConnection();

      if (!connection) {
        throw new Error('No healthy connections available');
      }

      // Execute the operation
      const result = await request.operation();

      // Record success metrics
      const responseTime = Date.now() - startTime;
      this.recordResponseTime(responseTime);
      this.stats.completedRequests++;

      // Update connection health score (positive feedback)
      this.updateConnectionHealth(connection.id, true, responseTime);

      request.resolve(result);

    } catch (error) {
      // Handle request failure
      await this.handleRequestFailure(request, error, startTime);
    }
  }

  /**
   * Handle request failure with retry logic
   */
  private async handleRequestFailure(
    request: RequestQueue,
    error: any,
    startTime: number
  ): Promise<void> {
    const responseTime = Date.now() - startTime;
    this.recordResponseTime(responseTime);

    // Update connection health score (negative feedback)
    const connection = await this.connectionManager.getConnection();
    if (connection) {
      this.updateConnectionHealth(connection.id, false, responseTime);
    }

    // Retry logic
    if (request.retryCount < this.config.retryAttempts) {
      request.retryCount++;

      // Add delay before retry
      setTimeout(() => {
        this.requestQueue.unshift(request); // Add to front of queue for retry
        this.stats.queuedRequests++;
      }, this.config.retryDelayMs * Math.pow(2, request.retryCount)); // Exponential backoff

      this.emit('requestRetry', {
        requestId: request.id,
        retryCount: request.retryCount,
        error
      });
    } else {
      // Max retries exceeded
      this.stats.failedRequests++;
      request.reject(error);

      this.emit('requestFailed', {
        requestId: request.id,
        error,
        retryCount: request.retryCount
      });
    }
  }

  /**
   * Get the best available connection based on health scores
   */
  private async getBestConnection(): Promise<any> {
    const availableConnections = await this.connectionManager.getAvailableConnections();

    if (availableConnections.length === 0) {
      throw new Error('No connections available');
    }

    // Sort connections by health score
    const sortedConnections = availableConnections.sort((a, b) => {
      const scoreA = this.connectionHealthScores.get(a.id) || 50;
      const scoreB = this.connectionHealthScores.get(b.id) || 50;
      return scoreB - scoreA;
    });

    return sortedConnections[0];
  }

  /**
   * Update connection health score
   */
  private updateConnectionHealth(
    connectionId: string,
    success: boolean,
    responseTime: number
  ): void {
    const currentScore = this.connectionHealthScores.get(connectionId) || 50;
    let adjustment = 0;

    if (success) {
      // Positive adjustment based on response time
      if (responseTime < 100) adjustment = 5;
      else if (responseTime < 500) adjustment = 2;
      else adjustment = 1;
    } else {
      // Negative adjustment for failures
      adjustment = -10;
    }

    const newScore = Math.max(0, Math.min(100, currentScore + adjustment));
    this.connectionHealthScores.set(connectionId, newScore);
  }

  /**
   * Perform health check on connections
   */
  private async performHealthCheck(): Promise<void> {
    try {
      const healthResults = await this.connectionManager.healthCheck();

      for (const [connectionId, isHealthy] of healthResults) {
        if (!isHealthy) {
          // Reduce health score for unhealthy connections
          const currentScore = this.connectionHealthScores.get(connectionId) || 50;
          this.connectionHealthScores.set(connectionId, Math.max(0, currentScore - 20));
        }
      }

      this.stats.activeConnections = healthResults.size;
      this.emit('healthCheckComplete', { results: healthResults });
    } catch (error) {
      this.emit('healthCheckError', { error });
    }
  }

  /**
   * Check if request can be processed based on rate limiting
   */
  private canProcessRequest(): boolean {
    const now = Date.now();
    const windowStart = now - this.config.windowSizeMs;

    // Remove old requests from window
    this.requestWindow = this.requestWindow.filter(time => time > windowStart);

    // Check if under rate limit
    return this.requestWindow.length < this.config.maxRequestsPerSecond;
  }

  /**
   * Record a request in the rate limiting window
   */
  private recordRequest(): void {
    this.requestWindow.push(Date.now());
  }

  /**
   * Clean up old entries from request window
   */
  private cleanupRequestWindow(): void {
    const cutoffTime = Date.now() - this.config.windowSizeMs;
    this.requestWindow = this.requestWindow.filter(time => time > cutoffTime);
  }

  /**
   * Record response time for statistics
   */
  private recordResponseTime(responseTime: number): void {
    this.responseTimes.push(responseTime);

    // Keep only last 1000 response times
    if (this.responseTimes.length > 1000) {
      this.responseTimes.shift();
    }

    // Update average response time
    if (this.responseTimes.length > 0) {
      this.stats.averageResponseTime =
        this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length;
    }

    // Update requests per second
    const now = Date.now();
    const recentRequests = this.requestWindow.filter(
      time => now - time < 1000
    ).length;
    this.stats.requestsPerSecond = recentRequests;

    this.recordRequest();
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current load balancer statistics
   */
  getStats(): LoadBalancerStats {
    return { ...this.stats };
  }

  /**
   * Get connection health scores
   */
  getConnectionHealthScores(): Map<string, number> {
    return new Map(this.connectionHealthScores);
  }

  /**
   * Update load balancer configuration
   */
  updateConfig(newConfig: Partial<LoadBalancerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Clear the request queue
   */
  clearQueue(): void {
    // Reject all pending requests
    for (const request of this.requestQueue) {
      request.reject(new Error('Queue cleared'));
    }

    this.requestQueue = [];
    this.stats.queuedRequests = 0;
  }

  /**
   * Shutdown the load balancer
   */
  async shutdown(): Promise<void> {
    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Clear pending requests
    this.clearQueue();

    // Reset stats
    this.stats = {
      totalRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      queuedRequests: 0,
      averageResponseTime: 0,
      requestsPerSecond: 0,
      activeConnections: 0
    };

    this.emit('shutdown');
  }
}