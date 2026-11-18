import { describe, expect, it } from 'vitest';
import { isSafePaymentUrl, sanitizeReturnPath, signInPath } from './url';

describe('sanitizeReturnPath', () => {
  it('keeps internal paths', () => {
    expect(sanitizeReturnPath('/orders')).toBe('/orders');
    expect(sanitizeReturnPath('/orders?page=2')).toBe('/orders?page=2');
    expect(sanitizeReturnPath('/payment/success')).toBe('/payment/success');
  });

  it('rejects open-redirect shapes and control characters', () => {
    expect(sanitizeReturnPath(null)).toBe('/');
    expect(sanitizeReturnPath(undefined)).toBe('/');
    expect(sanitizeReturnPath('')).toBe('/');
    expect(sanitizeReturnPath('https://evil.example')).toBe('/');
    expect(sanitizeReturnPath('//evil.example')).toBe('/');
    expect(sanitizeReturnPath('/\\evil.example')).toBe('/');
    expect(sanitizeReturnPath('/orders\nLocation: https://evil.example')).toBe('/');
  });
});

describe('signInPath', () => {
  it('omits the return parameter for the home page', () => {
    expect(signInPath('/')).toBe('/signin');
  });

  it('encodes the safe return path', () => {
    expect(signInPath('/orders')).toBe('/signin?return=%2Forders');
    expect(signInPath('//evil.example')).toBe('/signin');
  });
});

describe('isSafePaymentUrl', () => {
  it('accepts HTTPS checkout URLs', () => {
    expect(isSafePaymentUrl('https://checkout.stripe.com/c/pay/cs_test_123')).toBe(true);
  });

  it('accepts plain HTTP only for loopback hosts', () => {
    expect(isSafePaymentUrl('http://localhost:12111/c/pay/cs_test_123')).toBe(true);
    expect(isSafePaymentUrl('http://127.0.0.1:12111/c/pay')).toBe(true);
    expect(isSafePaymentUrl('http://evil.example/pay')).toBe(false);
  });

  it('rejects unsafe schemes and malformed values', () => {
    expect(isSafePaymentUrl('javascript:alert(1)')).toBe(false);
    expect(isSafePaymentUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafePaymentUrl('ftp://checkout.stripe.com/pay')).toBe(false);
    expect(isSafePaymentUrl('not a url')).toBe(false);
    expect(isSafePaymentUrl(null)).toBe(false);
    expect(isSafePaymentUrl(undefined)).toBe(false);
  });
});
