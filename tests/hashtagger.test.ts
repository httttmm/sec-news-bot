import { describe, it, expect } from 'vitest';
import { pickHashtags } from '../src/modules/hashtagger.js';

describe('pickHashtags', () => {
  it('ランサムウェア記事には #ランサムウェア が付く', () => {
    const tags = pickHashtags('医療機関がランサムウェア被害');
    expect(tags).toContain('#ランサムウェア');
  });

  it('CVE ID と「脆弱性」両方マッチした場合、優先度順に並び 3 件に padded される', () => {
    const tags = pickHashtags(
      'CVE-2024-12345: Apache HTTP Server に深刻な脆弱性'
    );
    expect(tags).toEqual(['#CVE', '#脆弱性', '#情報セキュリティ']);
  });

  it('複数の高優先トピックがあっても最大 3 件まで', () => {
    const tags = pickHashtags(
      'ransomware zero-day exploits CVE-2024-1 in npm supply chain'
    );
    expect(tags.length).toBeLessThanOrEqual(3);
    // ランサムウェア / ゼロデイ / サプライチェーン攻撃 / CVE がマッチするが
    // 優先度順で上位 3 つ
    expect(tags).toEqual([
      '#ランサムウェア',
      '#ゼロデイ',
      '#サプライチェーン攻撃',
    ]);
  });

  it('英語と日本語混在のテキストでもマッチする', () => {
    const tags = pickHashtags(
      'malicious npm package が GitHub のサプライチェーンを侵害'
    );
    expect(tags).toContain('#サプライチェーン攻撃');
  });

  it('何もマッチしなければ #情報セキュリティ にフォールバック (1 件)', () => {
    const tags = pickHashtags('全く関係ない話題のニュース');
    expect(tags).toEqual(['#情報セキュリティ']);
  });

  it('1 件しかマッチしないと #情報セキュリティ で padding して 2 件になる', () => {
    const tags = pickHashtags('医療機関がランサムウェア被害');
    expect(tags).toEqual(['#ランサムウェア', '#情報セキュリティ']);
  });

  it('2 件マッチでも #情報セキュリティ で padding して 3 件になる', () => {
    // ランサムウェア + 情報漏洩 = 2 件 → +#情報セキュリティ で 3 件
    const tags = pickHashtags('ランサムウェア攻撃で顧客情報が漏洩');
    expect(tags).toEqual(['#ランサムウェア', '#情報漏洩', '#情報セキュリティ']);
  });

  it('3 件マッチした場合は padding しない', () => {
    const tags = pickHashtags(
      'CVE-2024-1: ransomware zero-day in npm supply chain'
    );
    expect(tags).toHaveLength(3);
    expect(tags).not.toContain('#情報セキュリティ');
  });

  it('maxCount = 1 で 1 件だけ返る (padding も適用されない)', () => {
    const tags = pickHashtags(
      'CVE-2024-1: ransomware exploiting zero-day',
      1
    );
    expect(tags).toHaveLength(1);
    expect(tags[0]).toBe('#ランサムウェア');
  });

  it('maxCount = 0 では空配列', () => {
    expect(pickHashtags('ransomware', 0)).toEqual([]);
  });

  it('「侵入検知」は #不正アクセス にマッチさせない (誤検知の例)', () => {
    // 「侵入(?!検知)」のルックアヘッドで 侵入検知 はマッチしない
    const tags = pickHashtags('侵入検知システムの新製品紹介');
    expect(tags).not.toContain('#不正アクセス');
  });

  it('情報漏洩のバリエーション (漏洩 / 漏えい / 流出) すべてマッチ', () => {
    expect(pickHashtags('顧客情報の漏洩')).toContain('#情報漏洩');
    expect(pickHashtags('顧客情報の漏えい')).toContain('#情報漏洩');
    expect(pickHashtags('個人情報が流出')).toContain('#情報漏洩');
  });

  it('フィッシング攻撃の検出', () => {
    expect(pickHashtags('phishing campaign targets banks')).toContain(
      '#フィッシング'
    );
    expect(pickHashtags('フィッシング詐欺の手口')).toContain('#フィッシング');
  });

  it('botnet 記事には #ボットネット が付く', () => {
    expect(
      pickHashtags('Glassworm botnet disrupted after C2 takedown')
    ).toContain('#ボットネット');
    expect(pickHashtags('大規模ボットネットが摘発される')).toContain(
      '#ボットネット'
    );
  });

  it('DDoS 記事には #DDoS が付く', () => {
    expect(pickHashtags('Massive DDoS attack hits CDN provider')).toContain(
      '#DDoS'
    );
    expect(
      pickHashtags('denial of service attack on banking sector')
    ).toContain('#DDoS');
  });

  it('同じタグは重複しない', () => {
    // "ransomware" と "ランサムウェア" 両方含むケース → 1 件のみ
    const tags = pickHashtags('ransomware attack: ランサムウェア が拡散');
    const count = tags.filter((t) => t === '#ランサムウェア').length;
    expect(count).toBe(1);
  });
});
