#!/usr/bin/env node
/**
 * aggregate-grading-toolkit — 命令行校验器
 * 用法：
 *   node cli.mjs samples/sand-mechanism-II.csv
 *   node cli.mjs samples/                 # 目录下所有 csv
 *   node cli.mjs a.csv --kind stone --json
 *   node cli.mjs a.csv --cumulative       # 输入列是累计筛余
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('./grading-core.js');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const targets = argv.filter((a) => !a.startsWith('--'));
const kind = flags.has('--kind') ? argv[argv.indexOf('--kind') + 1] : 'sand';
const asJson = flags.has('--json');
const asCumulative = flags.has('--cumulative');

if (!targets.length) {
  console.log('用法: node cli.mjs <文件或目录> [--kind sand|stone] [--cumulative] [--json]');
  process.exit(1);
}

function listCsv(p) {
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return [p];
  return fs.readdirSync(p)
    .filter((f) => /\.(csv|txt)$/i.test(f))
    .map((f) => path.join(p, f))
    .sort();
}

function fmt(rep) {
  const lines = [];
  lines.push('  筛孔mm   分计%    累计%    通过%');
  for (let i = 0; i < rep.sieves.length; i++) {
    lines.push(
      '  ' + String(rep.sieves[i]).padEnd(8) +
      String(rep.retained[i]).padEnd(8) +
      String(rep.cumulative[i]).padEnd(8) +
      String(rep.passing[i])
    );
  }
  const bits = [];
  bits.push('分计合计 ' + rep.massBalancePct + '%' + (rep.massBalancePct >= 98 && rep.massBalancePct <= 102 ? ' ✓' : ' ⚠'));
  if (rep.finenessModulus) {
    bits.push(rep.finenessModulus.ok
      ? '细度模数 μf=' + rep.finenessModulus.value + '（' + rep.finenessModulus.classification + '）'
      : '细度模数 无法计算');
  }
  if (rep.zone) bits.push(rep.zone.pass ? '级配区 ' + rep.zone.zones.join('/') + ' ✓' : '级配区 不合格 ✗');
  if (rep.fines && rep.fines.value != null) bits.push('细粉 ' + rep.fines.value + '%');
  if (rep.fuller) bits.push('Fuller 偏差 RMS ' + rep.fuller.rms + ' pp');
  lines.push('  — ' + bits.join(' · '));
  if (rep.errors.length) lines.push('  ✗ ' + rep.errors.join('；'));
  if (rep.warnings.length) lines.push('  ⚠ ' + rep.warnings.join('；'));
  return lines.join('\n');
}

const results = [];
for (const t of targets) {
  for (const file of listCsv(t)) {
    const text = fs.readFileSync(file, 'utf8');
    const rows = G.parseCsv(text, asCumulative ? 'cumulative' : 'retained');
    const rep = G.analyze(rows, { kind });
    results.push({ file, rep });
    if (!asJson) {
      console.log('\n■ ' + path.basename(file));
      console.log(rep.ok ? fmt(rep) : '  数据不完整：' + rep.errors.join('；'));
    }
  }
}

if (asJson) {
  console.log(JSON.stringify(results.map((r) => ({ file: path.basename(r.file), ...r.rep })), null, 2));
}

const failed = results.filter((r) => !r.rep.ok || r.rep.errors.length);
if (!asJson) {
  console.log('\n共 ' + results.length + ' 个文件，' + (results.length - failed.length) + ' 个通过，' + failed.length + ' 个有问题。');
}
process.exit(failed.length ? 1 : 0);
