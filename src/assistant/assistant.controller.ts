import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssistantService } from './assistant.service';
import { AskAssistantDto } from './dto/assistant.dto';

@Controller('assistant')
@UseGuards(JwtAuthGuard)
export class AssistantController {
  constructor(private assistantService: AssistantService) {}

  @Post('ask')
  ask(@Req() req: any, @Body() body: AskAssistantDto) {
    return this.assistantService.ask(req.user.id, body.brandId, body.question);
  }
}
