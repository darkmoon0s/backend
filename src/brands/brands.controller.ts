import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateBrandDto, CreateCompetitorDto, UpdateBrandDto, UpdateCompetitorDto } from './dto/brand.dto';

@Controller('brands')
@UseGuards(JwtAuthGuard)
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get()
  findAll(@Req() req: any, @Query('organizationId') orgId?: string) {
    return this.brandsService.findAll(req.user.id, orgId);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateBrandDto) {
    return this.brandsService.create(req.user.id, dto);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.brandsService.findOne(req.user.id, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateBrandDto) {
    return this.brandsService.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.brandsService.remove(req.user.id, id);
  }

  @Post(':brandId/competitors')
  addCompetitor(@Req() req: any, @Param('brandId') brandId: string, @Body() dto: CreateCompetitorDto) {
    return this.brandsService.addCompetitor(req.user.id, brandId, dto);
  }

  @Patch(':brandId/competitors/:competitorId')
  updateCompetitor(
    @Req() req: any,
    @Param('brandId') brandId: string,
    @Param('competitorId') competitorId: string,
    @Body() dto: UpdateCompetitorDto
  ) {
    return this.brandsService.updateCompetitor(req.user.id, brandId, competitorId, dto);
  }

  @Delete(':brandId/competitors/:competitorId')
  removeCompetitor(@Req() req: any, @Param('brandId') brandId: string, @Param('competitorId') competitorId: string) {
    return this.brandsService.removeCompetitor(req.user.id, brandId, competitorId);
  }
}
