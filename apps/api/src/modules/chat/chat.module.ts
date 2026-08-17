import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ModerationService } from "../moderation/moderation.service";

@Module({ controllers: [ChatController], providers: [ChatService, ModerationService] })
export class ChatModule {}
