import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddMemberDto, UpdateMemberDto, UpdateOrganizationDto } from './dto/organization.dto';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.organizationsService.findAllForUser(req.user.id);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.organizationsService.findOne(req.user.id, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateOrganizationDto) {
    return this.organizationsService.update(req.user.id, id, dto);
  }

  @Get(':id/members')
  listMembers(@Req() req: any, @Param('id') id: string) {
    return this.organizationsService.listMembers(req.user.id, id);
  }

  @Post(':id/members')
  addMember(@Req() req: any, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.organizationsService.addMember(req.user.id, id, dto);
  }

  @Patch(':id/members/:memberId')
  updateMember(
    @Req() req: any,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberDto
  ) {
    return this.organizationsService.updateMember(req.user.id, id, memberId, dto);
  }

  @Delete(':id/members/:memberId')
  removeMember(@Req() req: any, @Param('id') id: string, @Param('memberId') memberId: string) {
    return this.organizationsService.removeMember(req.user.id, id, memberId);
  }
}
