import { describe, it, expect } from 'vitest';
import { isPrivateIp, isSafeUrl } from '../src/modules/safeHttp.js';

describe('isPrivateIp', () => {
  it('IPv4 のプライベート/特殊レンジを true と判定', () => {
    const privates = [
      '10.0.0.1',
      '10.255.255.255',
      '127.0.0.1',
      '127.255.255.255',
      '0.0.0.0',
      '169.254.169.254', // AWS/Azure metadata
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '192.168.255.255',
      '100.64.0.1', // CGNAT
      '100.127.255.255',
    ];
    for (const ip of privates) {
      expect(isPrivateIp(ip), `${ip} should be private`).toBe(true);
    }
  });

  it('IPv4 のグローバル IP を false と判定', () => {
    const publics = ['1.1.1.1', '8.8.8.8', '172.15.0.1', '172.32.0.1', '169.253.0.1'];
    for (const ip of publics) {
      expect(isPrivateIp(ip), `${ip} should NOT be private`).toBe(false);
    }
  });

  it('IPv6 の loopback / link-local / ULA を true と判定', () => {
    const privates = [
      '::1',
      '::',
      'fe80::1',
      'fe80::a00:27ff:fe4e:66a1',
      'fc00::1',
      'fd12:3456:789a::1',
    ];
    for (const ip of privates) {
      expect(isPrivateIp(ip), `${ip} should be private`).toBe(true);
    }
  });

  it('IPv6 のグローバル IP を false と判定', () => {
    expect(isPrivateIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false);
  });

  it('IPv4-mapped IPv6 はマップ先で判定', () => {
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('空文字や不正値は安全側 (true) に倒す', () => {
    expect(isPrivateIp('')).toBe(true);
  });
});

describe('isSafeUrl', () => {
  it('https:// と http:// のみ許可する', () => {
    expect(isSafeUrl('https://example.com/')).toBe(true);
    expect(isSafeUrl('http://example.com/path?q=1')).toBe(true);
  });

  it('http/https 以外のスキームは拒否', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeUrl('ftp://example.com/')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeUrl('gopher://example.com/')).toBe(false);
  });

  it('不正な URL は拒否', () => {
    expect(isSafeUrl('not a url')).toBe(false);
    expect(isSafeUrl('')).toBe(false);
  });

  it('localhost 系のホスト名を拒否', () => {
    expect(isSafeUrl('http://localhost/')).toBe(false);
    expect(isSafeUrl('http://localhost.localdomain/')).toBe(false);
    expect(isSafeUrl('http://ip6-localhost/')).toBe(false);
  });

  it('IPv4 リテラルのプライベートを拒否', () => {
    expect(isSafeUrl('http://127.0.0.1/')).toBe(false);
    expect(isSafeUrl('http://10.0.0.1/')).toBe(false);
    expect(isSafeUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isSafeUrl('http://192.168.1.1/')).toBe(false);
  });

  it('IPv6 リテラルのプライベートを拒否', () => {
    expect(isSafeUrl('http://[::1]/')).toBe(false);
    expect(isSafeUrl('http://[fe80::1]/')).toBe(false);
    expect(isSafeUrl('http://[fc00::1]/')).toBe(false);
  });

  it('グローバル IP リテラルは許可', () => {
    expect(isSafeUrl('http://1.1.1.1/')).toBe(true);
    expect(isSafeUrl('http://[2001:4860:4860::8888]/')).toBe(true);
  });
});
