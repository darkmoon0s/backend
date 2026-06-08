import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatePromptDto, RunPromptDto, UpdatePromptDto } from './dto/prompt.dto';

@Controller('prompts')
@UseGuards(JwtAuthGuard)
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  @Get()
  findAll(
    @Req() req: any,
    @Query('organizationId') orgId?: string,
    @Query('brandId') brandId?: string
  ) {
    return this.promptsService.findAll(req.user.id, orgId, brandId);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreatePromptDto) {
    return this.promptsService.create(req.user.id, dto);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdatePromptDto) {
    return this.promptsService.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.promptsService.remove(req.user.id, id);
  }

  @Post(':id/run')
  run(@Req() req: any, @Param('id') id: string, @Body() dto: RunPromptDto) {
    return this.promptsService.run(req.user.id, id, dto);
  }
}
