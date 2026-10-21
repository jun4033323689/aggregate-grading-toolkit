import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../grading-core.js');

// 一组真实机制砂筛分数据（分计筛余，最后一行为筛底）
const SAND_A = [
  { sieve: 4.75, retained: 0 },
  { sieve: 2.36, retained: 12 },
  { sieve: 1.18, retained: 20 },
  { sieve: 0.6, retained: 24 },
  { sieve: 0.3, retained: 22 },
  { sieve: 0.15, retained: 15 },
  { sieve: 0, retained: 7 }
];

test('累计筛余必须从最大筛孔往下累积', () => {
  const r = G.analyze(SAND_A);
  assert.deepEqual(r.sieves, [4.75, 2.36, 1.18, 0.6, 0.3, 0.15, 0]);
  assert.deepEqual(r.cumulative, [0, 12, 32, 56, 78, 93, 100]);
});

test('通过率 = 100 − 累计筛余', () => {
  const r = G.analyze(SAND_A);
  assert.deepEqual(r.passing, [100, 88, 68, 44, 22, 7, 0]);
});

test('细度模数：β1=0 时的直算', () => {
  const r = G.analyze(SAND_A);
  assert.equal(r.finenessModulus.ok, true);
  assert.equal(r.finenessModulus.value, 2.71); // (12+32+56+78+93)/100
  assert.equal(r.finenessModulus.classification, '中砂');
});

test('细度模数：β1>5% 必须按公式扣减，不能直接除 100', () => {
  const rows = [
    { sieve: 4.75, retained: 5 },
    { sieve: 2.36, retained: 15 },
    { sieve: 1.18, retained: 20 },
    { sieve: 0.6, retained: 20 },
    { sieve: 0.3, retained: 20 },
    { sieve: 0.15, retained: 15 },
    { sieve: 0, retained: 5 }
  ];
  const r = G.analyze(rows);
  // (20+40+60+80+95 − 5×5) / (100−5) = 270/95 = 2.84
  assert.equal(r.finenessModulus.value, 2.84);
  // 若错写成 Σ/100 会得到 2.95，本断言就是拦住这个错法的
  assert.notEqual(r.finenessModulus.value, 2.95);
});

test('级配区判定：该组数据只落在 II 区', () => {
  const r = G.analyze(SAND_A);
  assert.equal(r.zone.pass, true);
  assert.deepEqual(r.zone.zones, ['II']);
});

test('输入顺序打乱不影响结果（内部按筛孔降序重排）', () => {
  const shuffled = [SAND_A[3], SAND_A[0], SAND_A[6], SAND_A[1], SAND_A[5], SAND_A[2], SAND_A[4]];
  const a = G.analyze(SAND_A);
  const b = G.analyze(shuffled);
  assert.deepEqual(a.cumulative, b.cumulative);
  assert.deepEqual(a.passing, b.passing);
});

test('分计筛余合计落在 98~102 之外要告警', () => {
  const short = SAND_A.slice(0, 6); // 去掉筛底 → 合计 93
  const r = G.analyze(short);
  assert.ok(r.warnings.some((w) => w.indexOf('98') >= 0 || w.indexOf('合计') >= 0));
  assert.equal(r.massBalancePct, 93);
});

test('负数或非数字必须被拦下，不能静默跳过', () => {
  const bad = G.normalize([{ sieve: 4.75, retained: -3 }]);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length > 0);
});

test('筛孔缺失时不算细度模数，并给出原因', () => {
  const r = G.analyze([
    { sieve: 4.75, retained: 0 },
    { sieve: 2.36, retained: 20 },
    { sieve: 0, retained: 80 }
  ]);
  assert.equal(r.finenessModulus.ok, false);
  assert.ok(r.errors.some((e) => e.indexOf('细度模数') >= 0 || e.indexOf('缺少') >= 0));
});

test('<0.075mm 含量口径：有 0.075 筛时按 Σ 反算', () => {
  const rows = [
    { sieve: 4.75, retained: 0 },
    { sieve: 2.36, retained: 10 },
    { sieve: 1.18, retained: 18 },
    { sieve: 0.6, retained: 22 },
    { sieve: 0.3, retained: 20 },
    { sieve: 0.15, retained: 15 },
    { sieve: 0.075, retained: 9 },
    { sieve: 0, retained: 6 }
  ];
  const r = G.analyze(rows);
  assert.equal(r.fines.value, 0);
  assert.ok(r.fines.basis.indexOf('0.075') >= 0);
});

test('Fuller 曲线：最大粒径处通过率 100%、筛底为 0', () => {
  const sieves = [26.5, 19, 16, 9.5, 4.75, 2.36];
  const f = G.fullerCurve(sieves, 26.5, 0.5);
  assert.equal(f[0], 100);
  assert.ok(f[f.length - 1] < 35);
  const withPan = G.fullerCurve([4.75, 2.36, 0], 4.75, 0.5);
  assert.equal(withPan[2], 0);
});

test('CSV 解析：跳过表头、支持中文列名', () => {
  const csv = '筛孔(mm),分计筛余(%)\n4.75,0\n2.36,12\n1.18,20\n';
  const rows = G.parseCsv(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].sieve, 2.36);
});

test('CSV 解析：允许直接喂累计筛余并还原为分计', () => {
  const csv = '4.75,0\n2.36,12\n1.18,32\n';
  const rows = G.parseCsv(csv, 'cumulative');
  assert.deepEqual(rows.map((r) => r.retained), [0, 12, 20]);
});

test('toCsv 往返可被 parseCsv 读回', () => {
  const r = G.analyze(SAND_A);
  const csv = G.toCsv(r);
  const back = G.parseCsv(csv);
  assert.equal(back.length, SAND_A.length);
  assert.deepEqual(back.map((x) => x.retained), SAND_A.map((x) => x.retained));
});
