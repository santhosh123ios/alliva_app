import jwt, { type SignOptions } from 'jsonwebtoken';

export class JwtService {
  constructor(
    private readonly secret: string,
    private readonly expiresIn: SignOptions['expiresIn'],
  ) {}

  signAsync(payload: object, options: { expiresIn?: SignOptions['expiresIn'] } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      jwt.sign(payload, this.secret, { expiresIn: options.expiresIn ?? this.expiresIn }, (error, token) => {
        if (error || !token) reject(error ?? new Error('Could not sign token'));
        else resolve(token);
      });
    });
  }

  verifyAsync<T extends object>(token: string): Promise<T> {
    return new Promise((resolve, reject) => {
      jwt.verify(token, this.secret, (error, payload) => {
        if (error || !payload || typeof payload === 'string') reject(error ?? new Error('Invalid token'));
        else resolve(payload as T);
      });
    });
  }
}
