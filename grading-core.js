/*!
 * aggregate-grading-toolkit — 骨料筛分与级配校验核心
 * Copyright (c) 2026 杨镇铭 (Yang Zhenming)  <https://www.concrewis.com>
 * SPDX-License-Identifier: MIT
 *
 * 只做「数据口径的校验与换算」，不含任何配合比求解/寻优算法。
 * 规范数值摘自 JGJ 52-2006，使用前请与现行规范原文核对（见 README「口径声明」）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GradingCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.1';

  /** 混凝土用砂标准筛孔（mm，降序）。0.075 为细粉/石粉常用补充筛。 */
  var SAND_SIEVES = [4.75, 2.36, 1.18, 0.6, 0.3, 0.15, 0.075];

  /** 碎石/卵石常用公称粒径对应的标准筛孔（mm，降序） */
  var STONE_SIEVES_5_20 = [26.5, 19.0, 16.0, 9.5, 4.75, 2.36];

  /**
   * JGJ 52-2006 表 4.2.2 砂颗粒级配区（累计筛余百分数，%）
   * lo = 下限，hi = 上限。规范原表按「上限~下限」书写。
   * ⚠ 使用前请与现行规范原文核对。
   */
  var SAND_GRADING_ZONES = {
    'I': [
      { sieve: 4.75, lo: 0, hi: 10 },
      { sieve: 2.36, lo: 5, hi: 35 },
      { sieve: 1.18, lo: 35, hi: 65 },
      { sieve: 0.6, lo: 71, hi: 85 },
      { sieve: 0.3, lo: 80, hi: 95 },
      { sieve: 0.15, lo: 90, hi: 100 }
    ],
    'II': [
      { sieve: 4.75, lo: 0, hi: 10 },
      { sieve: 2.36, lo: 0, hi: 25 },
      { sieve: 1.18, lo: 10, hi: 50 },
      { sieve: 0.6, lo: 41, hi: 70 },
      { sieve: 0.3, lo: 70, hi: 92 },
      { sieve: 0.15, lo: 90, hi: 100 }
    ],
    'III': [
      { sieve: 4.75, lo: 0, hi: 10 },
      { sieve: 2.36, lo: 0, hi: 15 },
      { sieve: 1.18, lo: 0, hi: 25 },
      { sieve: 0.6, lo: 16, hi: 40 },
      { sieve: 0.3, lo: 55, hi: 85 },
      { sieve: 0.15, lo: 90, hi: 100 }
    ]
  };

  /** 细度模数分级（JGJ 52-2006 / GB/T 14684） */
  var FINENESS_CLASS = [
    { max: 1.5, name: '特细砂' },
    { max: 2.2, name: '细砂' },
    { max: 3.0, name: '中砂' },
    { max: 3.7, name: '粗砂' }
  ];

  function round(v, n) {
    var p = Math.pow(10, n == null ? 2 : n);
    return Math.round(v * p) / p;
  }

  /**
   * 把「筛孔 + 分计筛余」整理成规范顺序（筛孔降序），并做基础体检。
   * @param {Array<{sieve:number, retained:number}>} rows
   * @returns {{ok:boolean, sieves:number[], retained:number[], errors:string[], warnings:string[]}}
   */
  function normalize(rows) {
    var errors = [];
    var warnings = [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, sieves: [], retained: [], errors: ['没有读到任何筛分数据'], warnings: warnings };
    }

    var items = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var s = Number(r.sieve);
      var v = Number(r.retained);
      // 允许 sieve = 0 表示「筛底」，其余必须为正
      if (!isFinite(s) || s < 0) {
        errors.push('第 ' + (i + 1) + ' 行筛孔不是有效数字：' + r.sieve);
        continue;
      }
      if (!isFinite(v) || v < 0) {
        errors.push('第 ' + (i + 1) + ' 行分计筛余不是有效数字：' + r.retained);
        continue;
      }
      items.push({ sieve: s, retained: v });
    }

    // 筛孔降序 —— 这是本工具存在的第一理由：累计必须从最大筛孔往下加
    items.sort(function (a, b) { return b.sieve - a.sieve; });

    var seen = {};
    for (var k = 0; k < items.length; k++) {
      if (seen[items[k].sieve]) errors.push('筛孔 ' + items[k].sieve + ' mm 重复出现');
      seen[items[k].sieve] = true;
    }

    var sieves = [], retained = [];
    for (var j = 0; j < items.length; j++) { sieves.push(items[j].sieve); retained.push(items[j].retained); }

    var sum = 0;
    for (var m = 0; m < retained.length; m++) sum += retained[m];
    if (sum < 98 || sum > 102) {
      warnings.push('分计筛余合计 = ' + round(sum, 2) + '%，超出 98%~102%（筛分损耗偏大或漏录筛底）');
    }
    if (rows.length !== items.length) {
      warnings.push('有 ' + (rows.length - items.length) + ' 行数据无效，已跳过');
    }

    return { ok: errors.length === 0, sieves: sieves, retained: retained, errors: errors, warnings: warnings, massBalancePct: round(sum, 2) };
  }

  /**
   * 累计筛余：从最大筛孔开始逐级累加。
   * CR[i] = R[0] + ... + R[i]
   */
  function cumulativeRetained(retained) {
    var out = [], acc = 0;
    for (var i = 0; i < retained.length; i++) { acc += retained[i]; out.push(round(acc, 2)); }
    return out;
  }

  /** 通过率：P[i] = 100 - CR[i] */
  function passingRate(retained) {
    var cr = cumulativeRetained(retained), out = [];
    for (var i = 0; i < cr.length; i++) out.push(round(100 - cr[i], 2));
    return out;
  }

  /**
   * 砂细度模数 μf = ((β2+β3+β4+β5+β6) - 5·β1) / (100 - β1)
   * β1..β6 依次为 4.75 / 2.36 / 1.18 / 0.60 / 0.30 / 0.15 mm 的累计筛余百分数。
   * β1 超过 5% 时按公式扣除（不是简单除以 100）—— 这是第二个高频错处。
   */
  function finenessModulus(sieves, cumulative) {
    var need = [4.75, 2.36, 1.18, 0.6, 0.3, 0.15];
    var map = {};
    for (var i = 0; i < sieves.length; i++) map[sieves[i]] = cumulative[i];
    for (var j = 0; j < need.length; j++) {
      if (map[need[j]] == null) return { ok: false, reason: '缺少 ' + need[j] + ' mm 筛的累计筛余，无法计算细度模数' };
    }
    var b1 = map[4.75], rest = map[2.36] + map[1.18] + map[0.6] + map[0.3] + map[0.15];
    var denom = 100 - b1;
    if (denom <= 0) return { ok: false, reason: '4.75 mm 累计筛余 ≥100%，数据异常' };
    var mf = (rest - 5 * b1) / denom;
    var cls = '超粗砂';
    for (var k = 0; k < FINENESS_CLASS.length; k++) {
      if (mf < FINENESS_CLASS[k].max) { cls = FINENESS_CLASS[k].name; break; }
    }
    return { ok: true, value: round(mf, 2), classification: cls };
  }

  /** 判定砂所属级配区。返回命中的区列表（可能同时满足多个区）。 */
  function sandZoneOf(sieves, cumulative) {
    var map = {};
    for (var i = 0; i < sieves.length; i++) map[sieves[i]] = cumulative[i];
    var hits = [], detail = {};
    var names = ['I', 'II', 'III'];
    for (var n = 0; n < names.length; n++) {
      var zone = SAND_GRADING_ZONES[names[n]], allIn = true, miss = [];
      for (var j = 0; j < zone.length; j++) {
        var band = zone[j], v = map[band.sieve];
        if (v == null) { allIn = false; miss.push(band.sieve + 'mm 缺失'); continue; }
        if (v < band.lo - 1e-9 || v > band.hi + 1e-9) { allIn = false; miss.push(band.sieve + 'mm=' + v + '% 不在 ' + band.lo + '~' + band.hi + '%'); }
      }
      detail[names[n]] = { pass: allIn, violations: miss };
      if (allIn) hits.push(names[n]);
    }
    return { zones: hits, detail: detail, pass: hits.length > 0 };
  }

  /**
   * <0.075mm 细粉（石粉）含量。
   * 口径：筛分含 0.075mm 筛 → 含量 = 100 - Σ(全部分计筛余)；
   * 否则取「最小非零筛孔的通过率」，并如实标注它其实是 <该筛孔 的全部通过量。
   */
  function finesContent(sieves, retained) {
    var idx = sieves.indexOf(0.075);
    if (idx >= 0) {
      var sum = 0;
      for (var i = 0; i < retained.length; i++) sum += retained[i];
      return { basis: '<0.075mm（0.075 筛通过率）', value: round(100 - sum, 2), isFines: true };
    }
    var minS = Infinity, mi = -1;
    for (var j = 0; j < sieves.length; j++) {
      if (sieves[j] > 0 && sieves[j] < minS) { minS = sieves[j]; mi = j; }
    }
    if (mi < 0) return { basis: '无法判定', value: null, isFines: false };
    var pr = passingRate(retained);
    // isFines:false —— 这是「小于该筛孔的全部通过量」，不是石粉含量，两者不能混称
    return { basis: '<' + minS + 'mm 通过率（未筛 0.075，只是该筛孔的通过量）', value: pr[mi], isFines: false };
  }

  /** Fuller 理想级配曲线：通过率 = 100·(d/D)^n，默认 n=0.5、D=最大公称粒径 */
  function fullerCurve(sieves, dMax, n) {
    var exp = n == null ? 0.5 : n;
    var D = dMax == null ? Math.max.apply(null, sieves) : dMax;
    var out = [];
    for (var i = 0; i < sieves.length; i++) {
      var p = 100 * Math.pow(sieves[i] / D, exp);
      out.push(round(Math.min(100, p), 2));
    }
    return out;
  }

  /** 与 Fuller 曲线的偏差（百分点，正值=比理想曲线更细） */
  function fullerDeviation(sieves, passing, n) {
    var full = fullerCurve(sieves, null, n), dev = [], sq = 0;
    for (var i = 0; i < sieves.length; i++) {
      var d = round(passing[i] - full[i], 2);
      dev.push(d); sq += d * d;
    }
    return { deviation: dev, rms: round(Math.sqrt(sq / sieves.length), 2) };
  }

  /**
   * 粗/细骨料判定。
   *
   * 依据：砂是粒径小于 4.75mm 的颗粒，正常砂在 4.75mm 筛上的通过率在 90% 以上；
   * 碎石/卵石（5~20、5~25 这类）在 4.75mm 筛上的通过率很低（通常不到 10%）。
   * 取 85% 作分界，两侧都有充分余量，不会误判。
   *
   * 这个判定的意义：**砂级配区与细度模数只对细骨料成立**。
   * 把碎石喂进去判「级配区不合格」，是工具的错，不是数据的错。
   */
  function detectKind(sieves, passing) {
    var idx = sieves.indexOf(4.75);
    if (idx < 0) return 'sand';
    return passing[idx] >= 85 ? 'sand' : 'stone';
  }

  /**
   * 粗骨料的最大粒径 = 全部通过（累计筛余为 0）的那一档筛孔。
   * 这是纯几何量。**不做「公称最大粒径」分档判定** —— 那要按 GB/T 14685 的分档表，本工具不判。
   */
  function nominalTopSize(sieves, cumulative) {
    for (var i = sieves.length - 1; i >= 0; i--) {
      if (cumulative[i] <= 1e-9) return { sieve: sieves[i], basis: '该筛孔累计筛余为 0（全部通过）' };
    }
    return null;
  }

  /**
   * 一份筛分数据的完整体检。
   * @param {Array<{sieve:number, retained:number}>} rows 分计筛余（%）
   * @param {{kind?:'auto'|'sand'|'stone', fullerN?:number, fullers?:boolean}} [opts]
   */
  function analyze(rows, opts) {
    var o = opts || {};
    var nm = normalize(rows);
    if (!nm.ok) return { ok: false, errors: nm.errors, warnings: nm.warnings };

    var cr = cumulativeRetained(nm.retained);
    var pr = passingRate(nm.retained);

    var kind = (o.kind === 'sand' || o.kind === 'stone') ? o.kind : detectKind(nm.sieves, pr);

    var report = {
      ok: true,
      kind: kind,
      kindAuto: (o.kind !== 'sand' && o.kind !== 'stone'),
      sieves: nm.sieves,
      retained: nm.retained,
      cumulative: cr,
      passing: pr,
      massBalancePct: nm.massBalancePct,
      warnings: nm.warnings.slice(),
      errors: []
    };

    report.fines = finesContent(nm.sieves, nm.retained);

    if (kind === 'sand') {
      var fm = finenessModulus(nm.sieves, cr);
      report.finenessModulus = fm;
      if (!fm.ok) report.errors.push(fm.reason);
      var zn = sandZoneOf(nm.sieves, cr);
      zn.applicable = true;
      report.zone = zn;
      if (!zn.pass) report.errors.push('累计筛余不落在任何级配区（I/II/III）内');
    } else {
      // 粗骨料：细度模数与砂级配区都不适用，明确标注「不适用」，不硬判不合格
      report.finenessModulus = { ok: false, notApplicable: true, reason: '细度模数只对细骨料定义，粗骨料不计算' };
      report.zone = { applicable: false, zones: [], pass: true, note: 'JGJ 52 的砂级配区规定只适用于细骨料，粗骨料不做该项判定' };
      report.nominalTopSize = nominalTopSize(nm.sieves, cr);
    }

    if (o.fullers !== false) {
      report.fuller = fullerDeviation(nm.sieves, pr, o.fullerN);
    }

    // 单调性体检：通过率必须随筛孔增大而单调不增
    for (var i = 1; i < nm.sieves.length; i++) {
      if (pr[i] > pr[i - 1] + 1e-9) {
        report.errors.push('通过率在 ' + nm.sieves[i] + 'mm 处反常上升（' + pr[i - 1] + '% → ' + pr[i] + '%），数据可能录反');
        break;
      }
    }

    return report;
  }

  /** 宽松 CSV 解析：支持中文/英文表头，支持分计筛余或累计筛余（用 type 指定） */
  function parseCsv(text, type) {
    var lines = String(text).replace(/\r/g, '').split('\n');
    var rows = [], headerSeen = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#') continue;
      var cells = line.split(/[,;\t]/);
      if (cells.length < 2) continue;
      var a = cells[0].trim(), b = cells[1].trim();
      var av = parseFloat(a), bv = parseFloat(b);
      if (!isFinite(av) || !isFinite(bv)) { headerSeen = true; continue; } // 表头
      rows.push({ sieve: av, retained: bv });
    }
    if (type === 'cumulative') {
      // 累计筛余 → 还原分计
      rows.sort(function (x, y) { return y.sieve - x.sieve; });
      var out = [];
      for (var k = 0; k < rows.length; k++) {
        var prev = k === 0 ? 0 : rows[k - 1].retained;
        out.push({ sieve: rows[k].sieve, retained: round(rows[k].retained - prev, 2) });
      }
      return out;
    }
    return rows;
  }

  function toCsv(report) {
    if (!report || !report.ok) return '';
    var head = '筛孔mm,分计筛余%,累计筛余%,通过率%';
    var lines = [head];
    for (var i = 0; i < report.sieves.length; i++) {
      lines.push([report.sieves[i], report.retained[i], report.cumulative[i], report.passing[i]].join(','));
    }
    return lines.join('\n');
  }

  return {
    VERSION: VERSION,
    SAND_SIEVES: SAND_SIEVES,
    STONE_SIEVES_5_20: STONE_SIEVES_5_20,
    SAND_GRADING_ZONES: SAND_GRADING_ZONES,
    normalize: normalize,
    cumulativeRetained: cumulativeRetained,
    passingRate: passingRate,
    finenessModulus: finenessModulus,
    sandZoneOf: sandZoneOf,
    finesContent: finesContent,
    fullerCurve: fullerCurve,
    fullerDeviation: fullerDeviation,
    analyze: analyze,
    parseCsv: parseCsv,
    toCsv: toCsv,
    round: round
  };
});
