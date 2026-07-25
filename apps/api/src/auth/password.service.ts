import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return hash(password, {
      algorithm: 2, // argon2id
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  verify(hashValue: string, password: string): Promise<boolean> {
    return verify(hashValue, password);
  }
}
