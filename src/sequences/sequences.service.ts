import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Sequence, SequenceDocument } from './sequence.schema';

@Injectable()
export class SequencesService {
  constructor(@InjectModel(Sequence.name) private seqModel: Model<SequenceDocument>) {}

  /**
   * Atomic increment sequence (safe for concurrency).
   * Returns the next numeric value (1..n).
   */
  async next(key: string): Promise<number> {
    const k = String(key || '').trim();
    const doc = await this.seqModel.findOneAndUpdate(
      { key: k },
      { $inc: { value: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return Number((doc as any)?.value ?? 0) || 0;
  }
}

