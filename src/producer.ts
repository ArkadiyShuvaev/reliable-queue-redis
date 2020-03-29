import { Redis } from "ioredis";
import BaseService from "./baseService";
import ActionResult from "./actionResult";
import { Message, Repository } from "./types";
import { nameof } from "./utils";


export default class Producer extends BaseService {
    repo: Repository;

    constructor(queueName: string, repo:Repository, redis: Redis) {
        super(queueName, redis);
        this.repo = repo;
    }

    /**
     * Sends the message to the queue and creates the consumenr notification event.
     * @param {string} messageRequest - The serialized object.
     */
    public send(messageRequest: string): Promise<ActionResult> {

        return new Promise<ActionResult>(async (res, rej) => {
            try {
                const messageId = await this.redis.incr(this.messageUniqId);
                const messageResourceName = this.getMessageResourceName(messageId);

                const now = new Date().getTime();
                const message: Message = {
                    id: messageId,
                    createdDt: now,
                    updatedDt: now,
                    payload: messageRequest,
                    receiveCount: 0
                };

                await this.redis
                    .multi()
                    .hset(messageResourceName, nameof<Message>("id"), message.id)
                    .hset(messageResourceName, nameof<Message>("payload"), message.payload)
                    .hset(messageResourceName, nameof<Message>("createdDt"), message.createdDt)
                    .hset(messageResourceName, nameof<Message>("updatedDt"), message.updatedDt)
                    .hset(messageResourceName, nameof<Message>("receiveCount"), message.receiveCount)
                    .lpush(this.publishedIds, messageId)
                    .exec();

                console.debug(`The producer sent a message ${messageId} to the ${this.publishedIds} queue.`);
                await this.repo.sendNotification(this.notifications, messageId.toString());

                res({
                    isSuccess: true,
                    message: `The '${messageId}' message id has successfully been added into the queue to process.`
                });

            } catch (e) {
                rej({
                    isSuccess: false,
                    message: e
                });
            }
        });
    }
}
