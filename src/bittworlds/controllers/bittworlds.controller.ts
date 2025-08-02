import { Controller } from '@nestjs/common';
import { BittworldsService } from '../services/bittworlds.service';

@Controller('bittworlds')
export class BittworldsController {
    constructor(private readonly bittworldsService: BittworldsService) {}

    // Controller methods sẽ được thêm sau khi cần tạo API
} 