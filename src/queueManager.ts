import BaseService from "./baseService";
import { Redis } from "ioredis";
import { IAppConfiguration, Repository, MessageMetadata } from "./types";

export default class QueueManager extends BaseService {

    private redis: Redis;
    private repo: Repository;
    private visibilityTimeout: number;
    private maxReceiveCount: number;

    constructor(queueName: string, redis: Redis, repo: Repository, config?: IAppConfiguration) {
        super(queueName);

        this.redis = redis;

        if (typeof config === "undefined"
            || typeof config.visibilityTimeout === "undefined"
            || typeof config.maxReceiveCount === "undefined") {
            throw new Error("Configuration");
        }

        this.repo = repo;
        this.visibilityTimeout = config.visibilityTimeout;
        this.maxReceiveCount = config.maxReceiveCount;
    }

    start(): NodeJS.Timeout {
        const timeOut = setInterval(async () => {
            return new Promise<void>(async (res, rej) => {
                try {
                    console.debug(`Processing the "${this.queueName}" queue...`);

                    var messageIds = await this.redis.lrange(this.processingQueue, 0, -1);

                    messageIds.forEach(async messageIdAsStr => {
                        const messageKey = this.getMessageKey(parseInt(messageIdAsStr));
                        const messageMetadata = await this.repo.getMessageMetadata(messageKey);

                        if (!messageMetadata) {
                            throw new Error(`Message metadata cannot be found by the '${messageKey}' message key`);
                        }
                        const dateTimeAsStr = messageMetadata.receivedDt;

                        if (typeof dateTimeAsStr === "string") {
                            const unixEpochMilliseconds = new Date(dateTimeAsStr).getTime();
                            const subtractResult = new Date().getTime() - unixEpochMilliseconds;

                            if (subtractResult > this.visibilityTimeout  * 1000) {
                                if (messageMetadata.receiveCount === 0 || messageMetadata.receiveCount < this.maxReceiveCount) {
                                    await this.moveToPublishedQueue(messageKey, messageMetadata);
                                } else {
                                    await this.moveToDeadQueue(messageKey, messageMetadata);
                                }
                            }
                        }
                    });

                    res();
                } catch(e) {
                    rej(e);
                }

            });
        }, this.visibilityTimeout * 900); // at 10% less then the visibilityTimeout

        return timeOut;
    }

    private async moveToPublishedQueue(messageKey: string, messageMetadata: MessageMetadata) {
        console.debug(`Moving the "${messageKey}' message back to the ${this.publishedQueue} queue...`);
        const result = await this.repo.moveToPublishedQueue(messageKey, this.processingQueue, this.publishedQueue, this.metricsQueue, new Date().toISOString(), messageMetadata.id);
        if (result) {
            const msg = `The "${messageKey}' message has successfully been moved from the ${this.processingQueue} to the ${this.publishedQueue} queue.`;
            console.debug(msg);
            this.repo.sendNotification(this.notificationQueue, messageMetadata.id);
        }
        else {
            throw new Error(`The "${messageKey}' message could not been moved from the ${this.processingQueue} to the ${this.publishedQueue} queue.`);
        }
    }

    private async moveToDeadQueue(messageKey: string, messageMetadata: MessageMetadata) {
        console.debug(`Moving the "${messageKey}' message to the "${this.deadQueue}" dead queue...`);
        const result = await this.repo.moveToDeadQueue(messageKey, this.getDeadMessageKey(messageMetadata.id), this.processingQueue, this.metricsQueue, new Date().toISOString(), messageMetadata.id);
        if (result) {
            const msg = `The "${messageKey}' message has successfully been moved to the ${this.deadQueue} queue.`;
            console.debug(msg);
        }
        else {
            throw new Error(`The "${messageKey}' message could not been moved to the ${this.deadQueue} dead queue.`);
        }
    }
}
