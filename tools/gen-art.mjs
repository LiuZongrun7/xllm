#!/usr/bin/env node
/**
 * gen-art.mjs — 用火山方舟 Seedream 出站点插图
 *
 *   node tools/gen-art.mjs --dry-run                 # 只打印每条要发什么（免费）
 *   node tools/gen-art.mjs --list-models             # 账户里有哪些模型（免费）
 *   node tools/gen-art.mjs --only empty-cart         # 只出一条
 *   node tools/gen-art.mjs --out /tmp/art --n 2      # 换个目录试、每条出 2 张挑
 *   node tools/gen-art.mjs                           # 全部出，落到 spec 里的 file
 *
 * 事实来源是 **docs/art-spec.json**：`file` 写在哪，图就落在哪；提示词写在那里面，
 * 不写在脚本里 —— 改文案不该改代码。
 *
 * ── 三条从别处踩出来的规律（照抄，别重踩）──
 *
 *   1. **一次只出一张。** 接口的 `n` 在这条路上不生效，要几张就调几次。
 *   2. **返回的 URL 是限时的**（下载就失效）。拿到必须立刻落盘，不能"先打印待会儿再下"。
 *   3. **一次一张 = 一条失败不连累别人**，所以这里逐张 try/catch，最后统一报账。
 *
 * ── 省钱 ──
 *   先 --dry-run 看提示词；定风格用 1 张试，别一上来 --n 6；
 *   批量之前先 `--only <id> --n 1` 看一张，对味了再放开。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ---------------------------------------------------------------- 环境 */
const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * key 不在这个仓库里。
 * 优先读进程环境（方便 CI / 临时 export），
 * 否则去 ~/dev/aiagent/.env 借 —— 火山方舟的 key 一直放在那儿。
 */
function loadKey() {
  if (process.env.ARK_API_KEY) return { key: process.env.ARK_API_KEY, from: 'process.env' };
  const candidates = [
    path.join(os.homedir(), 'dev', 'aiagent', '.env'),
    path.join(ROOT, 'server', '.env'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const line = fs.readFileSync(file, 'utf8')
      .split('\n')
      .find((l) => /^\s*ARK_API_KEY\s*=/.test(l));
    if (line) {
      return { key: line.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g, ''), from: file };
    }
  }
  return { key: '', from: '(没找到)' };
}

/* ⚠️ 北京区，别换区。一个区域一个域名，key 和模型都绑在区域上 ——
 *    换域名不是"连不上"，是认不出这个 key，报错看着像 key 失效。 */
const BASE = (process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');

/* ---------------------------------------------------------------- 参数 */
const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const opt = (n, dv) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dv;
};

const SPEC_FILE = opt('spec', 'docs/art-spec.json');
const ONLY = opt('only', null);
const REF = opt('ref', null);          // 按参考图分组跑：--ref cover-sakura 只出日料那批
const PREFIX = opt('prefix', null);    // 按 id 前缀过滤：--prefix dish- 只出菜品，不吃掉封面
const SKIP = has('skip-existing');     // 已经出过的直接跳过，重跑不会重复花钱
const N = Number(opt('n', 1));
const OUT = opt('out', null);
const MODEL = opt('model', 'doubao-seedream-5-0-pro-260628');
const DRY = has('dry-run');
const LIST = has('list-models');

/* ---------------------------------------------------------------- 工具 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 按魔数认格式：接口返回的 URL 没有后缀，给的不一定是 png */
function sniffExt(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF'
    && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return 'bin';
}

const readSpec = () => JSON.parse(fs.readFileSync(path.join(ROOT, SPEC_FILE), 'utf8'));

/* ------------------------------------------------------------ --list-models */
if (LIST) {
  const { key, from } = loadKey();
  if (!key) { console.error('✗ 没读到 ARK_API_KEY'); process.exit(2); }
  const res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key}` } });
  const text = await res.text();
  if (!res.ok) {
    console.error(`✗ HTTP ${res.status}：${text.slice(0, 300)}`);
    process.exit(1);
  }
  const data = (JSON.parse(text).data || []).filter((m) => (m.status || '') !== 'Shutdown');
  const img = data.filter((m) => /seedream|-image/i.test(m.id));
  console.log(`key 来自 ${from}`);
  console.log(`在役模型 ${data.length} 个，其中出图相关 ${img.length} 个：\n`);
  for (const m of img.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${m.id.padEnd(40)} ${m.status || '在役'}`);
  }
  process.exit(0);
}

/* ---------------------------------------------------------------- 解析 spec */
if (!Number.isInteger(N) || N < 1) { console.error(`✗ --n 只能是正整数（给的是 ${opt('n')}）`); process.exit(2); }
if (!fs.existsSync(path.join(ROOT, SPEC_FILE))) { console.error(`✗ 找不到 ${SPEC_FILE}`); process.exit(2); }

const spec = readSpec();
const all = spec.shots || [];
const shots = all.filter((s) =>
  (!ONLY || s.id === ONLY)
  && (!REF || (s.refs || []).includes(REF))
  && (!PREFIX || s.id.startsWith(PREFIX)));
if (!shots.length) {
  console.error(`✗ ${ONLY ? `--only ${ONLY}` : REF ? `--ref ${REF}` : 'spec 里没有 shots'} 没匹配到`);
  for (const s of all) console.error(`    ${s.id.padEnd(20)} ${s.role || ''}`);
  process.exit(2);
}

/** 落盘目标。spec 的 file 是权威；--out 只用来把这一批丢进临时目录试。 */
function stemFor(shot) {
  if (OUT) return path.join(path.resolve(ROOT, OUT), shot.id);
  return path.join(ROOT, shot.file.replace(/\.[^.]+$/, ''));
}

const fullPrompt = (shot) => [shot.prompt, spec.style_suffix].filter(Boolean).join('\n\n');
const paletteNote = (shot) => (spec._palette || {})[shot.palette] || '';

/* ------------------------------------------------------------ 参考图 */
/**
 * 参考图是这个方案的关键：40 张照片要像同一家店，光靠提示词办不到 ——
 * 把一张已经定调的图一起发过去，餐具、桌面、灯光、色温才锁得住。
 *
 * 名字的三种写法：
 *   1. spec._refs 里登记过的（可以是数组，一次带几张）
 *   2. 另一条 shot 的 id —— 直接用它已经落盘的 file
 *   3. 带扩展名的相对路径
 *
 * ⚠️ 少一张参考图不会报错，只会"出的图不像" —— 那是最费钱的失败方式。
 *    所以这里找不到就整条跳过，不硬发。
 */
const dataUri = (p) => {
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,${fs.readFileSync(p).toString('base64')}`;
};

function resolveRef(name) {
  const refs = spec._refs || {};
  const listed = Array.isArray(refs[name]) ? refs[name] : refs[name] ? [refs[name]] : null;
  const fromShot = (spec.shots || []).find((s) => s.id === name)?.file;
  const paths = listed || (fromShot ? [fromShot] : [name]);
  const found = [];
  const missing = [];
  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
    (fs.existsSync(abs) ? found : missing).push(abs);
  }
  return { files: found, missing };
}

/* ---------------------------------------------------------------- 干跑 */
if (DRY) {
  console.log('—— 干跑，不发送、不花钱 ——');
  console.log(`  spec ：${SPEC_FILE}`);
  console.log(`  模型 ：${MODEL}`);
  console.log(`  每条出图：${N} 张（这条接口一次一张，要几张就调几次）`);
  for (const s of shots) {
    console.log(`\n【${s.id}】${s.role || ''}`);
    console.log(`  尺寸 ：${s.size}`);
    console.log(`  落盘 ：${path.relative(ROOT, stemFor(s))}.<按魔数认的扩展名>`);
    if (paletteNote(s)) console.log(`  色板 ：${paletteNote(s)}`);
    if (s.refs?.length) {
      const r = s.refs.map(resolveRef).reduce((a, b) => ({
        files: [...a.files, ...b.files], missing: [...a.missing, ...b.missing],
      }), { files: [], missing: [] });
      console.log(`  参考图 ${r.files.length} 张${r.files.length ? '：' + r.files.map((f) => path.relative(ROOT, f)).join('、') : ''}`);
      if (r.missing.length) console.log(`  ⚠ 找不到：${r.missing.map((f) => path.relative(ROOT, f)).join('、')}`);
    }
    console.log(`  提示词 ${fullPrompt(s).length} 字符，开头是：${s.prompt.slice(0, 40)}…`);
  }
  console.log(`\nPOST ${BASE}/images/generations`);
  process.exit(0);
}

/* ---------------------------------------------------------------- 发请求 */
const { key, from } = loadKey();
if (!key) { console.error('✗ 没读到 ARK_API_KEY（试过 process.env 和 ~/dev/aiagent/.env）'); process.exit(2); }

/* ⚠️ 必须带超时：没有任何超时的 fetch 会一直挂在那儿，
 *    表现是"这条不动了，别的也看不到"，最难判断。真实撞到过一次（挂了 10 分钟）。
 *    出图本身 60–120 秒，给到 180 秒足够，超时就当这条失败。 */
const TIMEOUT_MS = Number(process.env.ART_TIMEOUT_MS || 180000);

/**
 * 失败重试：实测过"连着成功 3 张之后，后面每一张都是 fetch failed"，
 * 隔一会儿再打就恢复 —— 属于限流/抖动，不是参数错误。
 * 所以对网络类失败退避重试；4xx 这类参数错误立刻放弃（重试多少次都一样）。
 */
const RETRIES = Number(process.env.ART_RETRIES || 3);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function genWithRetry(shot, refFiles) {
  let lastErr = null;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await gen(shot, refFiles);
    } catch (e) {
      lastErr = e;
      const retriable = !/^HTTP 4\d\d/.test(e.message);
      if (!retriable || attempt === RETRIES) throw e;
      const wait = attempt * 8000;
      console.log(`  … 第 ${attempt} 次失败，${wait / 1000}s 后重试（${e.message}）`);
      await sleepMs(wait);
    }
  }
  throw lastErr;
}

async function gen(shot, refFiles = []) {
  const res = await fetch(`${BASE}/images/generations`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: fullPrompt(shot),
      size: shot.size,
      response_format: 'url',
      watermark: false,
      ...(refFiles.length ? { image: refFiles.map(dataUri) } : {}),
    }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 就把原文带出去 */ }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`${res.status} 鉴权失败。按顺序查：区域（当前 ${BASE}）、key 是不是方舟的、模型名在不在账户里（--list-models）。原始返回：${text.slice(0, 300)}`);
    }
    throw new Error(`HTTP ${res.status}：${json?.error?.message || text.slice(0, 300)}`);
  }
  return json;
}

console.log(`—— 出图（Seedream）· key 来自 ${from} · 模型 ${MODEL} ——`);

let failedShots = 0;
let failedImgs = 0;

let skipped = 0;
for (const shot of shots) {
  const stem = stemFor(shot);
  if (SKIP && fs.existsSync(`${stem}.jpg`) + fs.existsSync(`${stem}.jpeg`) + fs.existsSync(`${stem}.png`)) {
    console.log(`\n【${shot.id}】已有，跳过`);
    skipped++;
    continue;
  }
  const candDir = path.join(path.dirname(stem), '_candidates', shot.id);
  fs.mkdirSync(candDir, { recursive: true });

  console.log(`\n【${shot.id}】${shot.role || ''}  ${shot.size}`);
  const saved = [];

  // 参考图先解析：少一张就直接跳过这条，别发一个"不像"的请求
  let refFiles = [];
  if (shot.refs?.length) {
    const r = shot.refs.map(resolveRef).reduce((a, b) => ({
      files: [...a.files, ...b.files], missing: [...a.missing, ...b.missing],
    }), { files: [], missing: [] });
    if (r.missing.length) {
      console.error(`  ✗ 参考图找不到：${r.missing.map((f) => path.relative(ROOT, f)).join('、')} —— 跳过这一条`);
      failedShots++;
      continue;
    }
    refFiles = r.files;
    console.log(`  参考图 ${refFiles.length} 张：${refFiles.map((f) => path.basename(f)).join('、')}`);
  }

  for (let i = 0; i < N; i++) {
    let json;
    try {
      json = await genWithRetry(shot, refFiles);
    } catch (e) {
      // fetch 的 "fetch failed" 本身不带任何信息，真正的原因在 e.cause 里
      const cause = e.cause ? ` (${e.cause.code || e.cause.errno || ''} ${e.cause.message || ''}`.trim() + ')' : '';
      console.error(`  ✗ 第 ${i + 1} 张：${e.message}${cause}`);
      failedImgs++;
      continue;
    }

    const d = (json.data || [])[0];
    if (!d || !(d.url || d.b64_json)) {
      console.error(`  ✗ 第 ${i + 1} 张：返回里既没有 url 也没有 b64_json`);
      failedImgs++;
      continue;
    }

    // 拿到就立刻下：URL 限时
    let buf;
    if (d.url) {
      const r = await fetch(d.url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) { console.error(`  ✗ 第 ${i + 1} 张下载失败：HTTP ${r.status}`); failedImgs++; continue; }
      buf = Buffer.from(await r.arrayBuffer());
    } else {
      buf = Buffer.from(d.b64_json, 'base64');
    }

    const ext = sniffExt(buf);
    if (ext === 'bin') { console.error(`  ✗ 第 ${i + 1} 张认不出格式（可能是错误页）`); failedImgs++; continue; }

    const dest = path.join(candDir, `${String(i).padStart(2, '0')}.${ext}`);
    fs.writeFileSync(dest, buf);
    saved.push(dest);
    console.log(`  ✓ ${path.relative(ROOT, dest)}  ${(buf.length / 1024).toFixed(0)}KB  ${d.size || ''}`);
    await sleep(150);
  }

  if (!saved.length) { failedShots++; continue; }

  // 候选全留下，第 0 张覆盖成 spec 里的名字。挑图是人的判断，脚本不替人决定。
  const finalFile = `${stem}.${path.extname(saved[0]).slice(1)}`;
  fs.mkdirSync(path.dirname(finalFile), { recursive: true });
  fs.copyFileSync(saved[0], finalFile);
  console.log(`  → ${path.relative(ROOT, finalFile)}（第 0 张；其他候选在 ${path.relative(ROOT, candDir)}/）`);
}

/* ---------------------------------------------------------------- 报账 */
if (skipped) console.log(`\n（跳过 ${skipped} 条已出图的）`);
if (failedShots || failedImgs) {
  const parts = [];
  if (failedShots) parts.push(`${failedShots} 条没成`);
  if (failedImgs) parts.push(`${failedImgs} 张失败`);
  console.log(`\n✗ ${parts.join('，')}`);
  process.exit(1);
}
console.log('\n✓ 全部完成');
