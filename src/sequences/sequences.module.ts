import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Sequence, SequenceSchema } from './sequence.schema';
import { SequencesService } from './sequences.service';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: Sequence.name, schema: SequenceSchema }])],
  providers: [SequencesService],
  exports: [SequencesService],
})
export class SequencesModule {}

