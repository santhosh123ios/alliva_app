import { availableBalance, parseWithdrawalAmount } from './wallet';

describe('wallet balance', () => {
  it('subtracts paid and reserved amounts from earnings', () => {
    expect(availableBalance('7.480', '1.000', '0.500')).toBe('5.980');
  });

  it('does not show a negative available balance', () => {
    expect(availableBalance('1.000', '2.000', '0.000')).toBe('0.000');
  });

  it('accepts a positive amount with up to 3 decimals', () => {
    expect(parseWithdrawalAmount('1.5')).toBe('1.500');
    expect(() => parseWithdrawalAmount('0')).toThrow('Enter an amount');
    expect(() => parseWithdrawalAmount('1.2345')).toThrow('Enter an amount');
  });
});
