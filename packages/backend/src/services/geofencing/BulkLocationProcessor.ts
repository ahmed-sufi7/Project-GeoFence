import { EventEmitter } from 'events';
import { LocationPoint, BulkLocationUpdate, ProcessingStats } from '../../types/geofencing';
import { Tile38Service } from './Tile38Service';
import { ConnectionManager } from './ConnectionManager';
import { GeofenceWebhookService } from './GeofenceWebhookService';

interface QueueItem {
  location: LocationPoint;
  timestamp: number;
  retryCount: number;
}

interface BatchConfig {
  batchSize: number;
  maxWaitTime: number;
  maxRetries: number;
  concurrency: number;
}

export class BulkLocationProcessor extends EventEmitter {
  private queue: QueueItem[] = [];
  private processing = false;
  private stats: ProcessingStats = {
    totalProcessed: 0,
    successCount: 0,
    errorCount: 0,
    averageProcessingTime: 0,
    queueSize: 0,
    throughputPerSecond: 0
  };
  private batchTimer: NodeJS.Timeout | null = null;
  private processingTimes: number[] = [];
  private lastThroughputCheck = Date.now();
  private processedSinceLastCheck = 0;

  constructor(
    private tile38Service: Tile38Service,
    private connectionManager: ConnectionManager,
    private webhookService: GeofenceWebhookService,
    private config: BatchConfig = {
      batchSize: 100,
      maxWaitTime: 1000,
      maxRetries: 3,
      concurrency: 5
    }
  ) {
    super();
    this.startThroughputMonitoring();
  }

  /**
   * Add location update to processing queue
   */
  async queueLocationUpdate(location: LocationPoint): Promise<void> {
    const queueItem: QueueItem = {
      location,
      timestamp: Date.now(),
      retryCount: 0
    };

    this.queue.push(queueItem);
    this.stats.queueSize = this.queue.length;

    // Start processing if not already running
    if (!this.processing) {
      this.scheduleProcessing();
    }

    // Emit queue size warning if needed
    if (this.queue.length > 1000) {
      this.emit('queueOverflow', { queueSize: this.queue.length });
    }
  }

  /**
   * Process bulk location updates
   */
  async processBulkUpdates(updates: BulkLocationUpdate[]): Promise<void> {
    const startTime = Date.now();

    try {
      // Add all updates to queue
      for (const update of updates) {
        for (const location of update.locations) {
          await this.queueLocationUpdate(location);
        }
      }

      // Wait for processing to complete
      await this.waitForQueueEmpty();

      const processingTime = Date.now() - startTime;
      this.updateProcessingStats(processingTime);

      this.emit('bulkProcessingComplete', {
        updatesCount: updates.length,
        processingTime,
        stats: this.getStats()
      });
    } catch (error) {
      this.emit('bulkProcessingError', { error, updates });
      throw error;
    }
  }

  /**
   * Schedule batch processing
   */
  private scheduleProcessing(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.processBatch();
    }, this.config.maxWaitTime);

    // Process immediately if batch size reached
    if (this.queue.length >= this.config.batchSize) {
      this.processBatch();
    }
  }

  /**
   * Process a batch of locations
   */
  private async processBatch(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    const batch = this.queue.splice(0, this.config.batchSize);
    this.stats.queueSize = this.queue.length;

    try {
      await this.processLocationBatch(batch);
    } catch (error) {
      console.error('Batch processing error:', error);
      this.emit('batchError', { error, batchSize: batch.length });
    } finally {
      this.processing = false;

      // Schedule next batch if queue not empty
      if (this.queue.length > 0) {
        this.scheduleProcessing();
      }
    }
  }

  /**
   * Process a batch of location updates with concurrency control
   */
  private async processLocationBatch(batch: QueueItem[]): Promise<void> {
    const chunks = this.chunkArray(batch, Math.ceil(batch.length / this.config.concurrency));
    const processingPromises = chunks.map(chunk => this.processChunk(chunk));

    await Promise.allSettled(processingPromises);
  }

  /**
   * Process a chunk of locations
   */
  private async processChunk(chunk: QueueItem[]): Promise<void> {
    const connection = await this.connectionManager.getConnection();

    try {
      for (const item of chunk) {
        try {
          await this.processLocationItem(item);
          this.stats.successCount++;
          this.processedSinceLastCheck++;
        } catch (error) {
          await this.handleProcessingError(item, error);
        }

        this.stats.totalProcessed++;
      }
    } finally {
      this.connectionManager.releaseConnection(connection);
    }
  }

  /**
   * Process individual location item
   */
  private async processLocationItem(item: QueueItem): Promise<void> {
    const startTime = Date.now();

    // Set location in Tile38
    await this.tile38Service.setLocation(item.location);

    // Check for geofence events
    const events = await this.tile38Service.checkGeofenceEvents(
      item.location.userId,
      item.location.coordinates
    );

    // Process webhook events
    for (const event of events) {
      await this.webhookService.processEvent(event);
    }

    const processingTime = Date.now() - startTime;
    this.processingTimes.push(processingTime);

    // Keep only last 1000 processing times for average calculation
    if (this.processingTimes.length > 1000) {
      this.processingTimes.shift();
    }
  }

  /**
   * Handle processing errors with retry logic
   */
  private async handleProcessingError(item: QueueItem, error: any): Promise<void> {
    this.stats.errorCount++;

    if (item.retryCount < this.config.maxRetries) {
      item.retryCount++;
      this.queue.unshift(item); // Add back to front of queue for retry
      this.stats.queueSize = this.queue.length;

      this.emit('locationRetry', {
        userId: item.location.userId,
        retryCount: item.retryCount,
        error
      });
    } else {
      this.emit('locationFailed', {
        userId: item.location.userId,
        location: item.location,
        error,
        maxRetriesReached: true
      });
    }
  }

  /**
   * Update processing statistics
   */
  private updateProcessingStats(processingTime: number): void {
    this.processingTimes.push(processingTime);

    if (this.processingTimes.length > 100) {
      this.processingTimes.shift();
    }

    this.stats.averageProcessingTime =
      this.processingTimes.reduce((sum, time) => sum + time, 0) / this.processingTimes.length;
  }

  /**
   * Start throughput monitoring
   */
  private startThroughputMonitoring(): void {
    setInterval(() => {
      const now = Date.now();
      const timeDiff = (now - this.lastThroughputCheck) / 1000;
      this.stats.throughputPerSecond = this.processedSinceLastCheck / timeDiff;

      this.lastThroughputCheck = now;
      this.processedSinceLastCheck = 0;
    }, 5000); // Update every 5 seconds
  }

  /**
   * Wait for queue to be empty
   */
  private async waitForQueueEmpty(): Promise<void> {
    return new Promise((resolve) => {
      const checkQueue = () => {
        if (this.queue.length === 0 && !this.processing) {
          resolve();
        } else {
          setTimeout(checkQueue, 100);
        }
      };
      checkQueue();
    });
  }

  /**
   * Utility function to chunk array
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Get current processing statistics
   */
  getStats(): ProcessingStats {
    return { ...this.stats };
  }

  /**
   * Clear the processing queue
   */
  clearQueue(): void {
    this.queue = [];
    this.stats.queueSize = 0;
  }

  /**
   * Update batch configuration
   */
  updateConfig(config: Partial<BatchConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Shutdown the processor
   */
  async shutdown(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // Wait for current processing to complete
    await this.waitForQueueEmpty();

    this.emit('shutdown');
  }
}