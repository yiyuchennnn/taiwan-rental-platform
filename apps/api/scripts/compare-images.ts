import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import sharp from "sharp";
import { processImage } from "../src/modules/media/process-image.js";
import { provisionalImageOptions } from "../src/modules/media/image-profile.js";

// Local-only report. No dotenv, credentials, database, remote upload or quota decisions.
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output"), inputIndex = args.indexOf("--input-dir");
if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error("Required: --output <new-directory> [--input-dir <authorized-photos>]");
const output = resolve(args[outputIndex + 1]!);
const input = inputIndex < 0 ? undefined : args[inputIndex + 1];
if (inputIndex >= 0 && !input) throw new Error("Missing --input-dir value");
const options = provisionalImageOptions({ maxInputPixels: 40_000_000, timeoutSeconds: 15 });
const escape = (s: string) => s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
const sourceKind = input ? "user-supplied-local-images" : "synthetic-test-fixtures";

async function synthetic(name: string, dark: boolean, detailed: boolean) {
  const shapes = Array.from({ length: detailed ? 32 : 8 }, (_, i) => `<path d="M${80 + i * 80},200v1400" stroke="#888" stroke-width="${detailed ? 3 : 10}"/>`).join("");
  const svg = `<svg width="2800" height="2100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="${dark ? "#181d26" : "#f6e4cd"}"/><stop offset="1" stop-color="${dark ? "#48403a" : "#c5d6e4"}"/></linearGradient></defs><rect width="2800" height="2100" fill="url(#g)"/><path d="M0 1600L2800 1300V2100H0Z" fill="${dark ? "#32271e" : "#b29a7e"}"/><rect x="300" y="250" width="900" height="1000" fill="${dark ? "#304252" : "#adcbe0"}"/>${shapes}<rect x="1500" y="1050" width="900" height="650" rx="60" fill="${dark ? "#44414a" : "#809298"}"/><text x="200" y="1900" font-size="${detailed ? 30 : 75}" fill="${dark ? "#b7b7b7" : "#151515"}">${name} — synthetic fixture, not a real room photograph</text></svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let seed = detailed ? 491 : dark ? 817 : 123;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = ((seed >>> 24) - 128) * (dark ? 0.25 : detailed ? 0.12 : 0.025);
    data[i] = Math.max(0, Math.min(255, Math.round(data[i]! + noise)));
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).jpeg({ quality: 95 }).toBuffer();
}

const sources: { name: string; data: Buffer }[] = [];
if (input) {
  const root = resolve(input);
  const files = (await readdir(root, { withFileTypes: true })).filter(f => f.isFile() && /\.(jpe?g|png|webp)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (!files.length || files.length > 30) throw new Error("Provide between 1 and 30 supported local images");
  for (const file of files) {
    const path = join(root, file.name);
    if ((await stat(path)).size > options.maxInputBytes) throw new Error("An input exceeds the provisional 10,000,000-byte limit");
    sources.push({ name: file.name, data: await readFile(path) });
  }
} else {
  for (const [name, dark, detailed] of [["bright-gradients", false, false], ["fine-details", false, true], ["dark-noise", true, false]] as const) {
    sources.push({ name, data: await synthetic(name, dark, detailed) });
  }
}
await mkdir(output); // Refuse overwrites of earlier reports or source directories.
const measurements: { name: string; inputBytes: number; edge: number; width: number; height: number; displayBytes: number; thumbnailBytes: number; totalBytes: number }[] = [];
const cards: string[] = [];
const panels: { input: Buffer; left: number; top: number }[] = [];
for (const [index, source] of sources.entries()) {
  const columns: string[] = [];
  for (const edge of [1920, 2560]) {
    const result = await processImage(source.data, { ...options, displayMaxEdge: edge });
    const display = result.display, thumbnail = result.thumbnail;
    const total = display.bytes + thumbnail.bytes;
    measurements.push({ name: source.name, inputBytes: source.data.length, edge, width: display.width, height: display.height,
      displayBytes: display.bytes, thumbnailBytes: thumbnail.bytes, totalBytes: total });
    await writeFile(join(output, `${index + 1}-${edge}.webp`), display.data);
    await writeFile(join(output, `${index + 1}-${edge}-thumbnail.webp`), thumbnail.data);
    const preview = await sharp(display.data).resize({ width: 640, height: 480, fit: "contain", background: "#eeeeee", withoutEnlargement: true }).png().toBuffer();
    const label = Buffer.from(`<svg width="660" height="65" xmlns="http://www.w3.org/2000/svg"><rect width="660" height="65" fill="white"/><text x="12" y="27" font-family="sans-serif" font-size="21">Sample ${index + 1} | ${edge}px | WebP quality 82</text><text x="12" y="53" font-family="sans-serif" font-size="18">Display + thumbnail: ${total.toLocaleString("en-US")} bytes</text></svg>`);
    const left = edge === 1920 ? 20 : 710, top = 120 + index * 570;
    panels.push({ input: label, left, top }, { input: preview, left: left + 10, top: top + 65 });
    columns.push(`<div><h3>${edge}px / quality 82</h3><p>${display.width} × ${display.height}；展示 ${display.bytes.toLocaleString("en-US")} bytes；縮圖 ${thumbnail.bytes.toLocaleString("en-US")} bytes；合計 ${total.toLocaleString("en-US")} bytes</p><a href="data:image/webp;base64,${display.data.toString("base64")}" download="comparison-${index + 1}-${edge}.webp"><img alt="${escape(source.name)} ${edge}px" src="data:image/webp;base64,${display.data.toString("base64")}"></a></div>`);
  }
  cards.push(`<section><h2>${escape(source.name)}</h2><div class="columns">${columns.join("")}</div></section>`);
}
const report = { sourceKind, provisional: true, profile: options, comparedDisplayEdges: [1920, 2560], measurements,
  limitations: ["Synthetic fixtures cannot establish real photograph quality or average storage cost", "No plan GB limit is selected", "Only processed display and thumbnail bytes are counted; no original is retained by the upload pipeline"] };
await writeFile(join(output, "measurements.json"), JSON.stringify(report, null, 2));
const heading = Buffer.from(`<svg width="1400" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="1400" height="100" fill="white"/><text x="25" y="38" font-family="sans-serif" font-size="28">1920px / 2560px comparison — provisional profile</text><text x="25" y="75" font-family="sans-serif" font-size="22">${input ? "Local authorized image samples" : "Synthetic fixtures, NOT real property photographs"} | Same-size preview; inspect files at native size for detail</text></svg>`);
await sharp({ create: { width: 1400, height: 120 + sources.length * 570, channels: 3, background: "#f4f5f7" } })
  .composite([{ input: heading, left: 0, top: 0 }, ...panels]).png().toFile(join(output, "comparison.png"));
const mdRows = sources.map((source, index) => {
  const a = measurements[index * 2]!, b = measurements[index * 2 + 1]!;
  return `| ${index + 1}：${source.name.replace(/[|\r\n]/g, " ")} | ${a.totalBytes.toLocaleString("en-US")} | ${b.totalBytes.toLocaleString("en-US")} |`;
});
await writeFile(join(output, "comparison.md"), `# 圖片規格比較\n\n${input ? "來源：使用者提供的本機圖片，請控管報告分享。" : "來源：合成測試圖，並非真實房源照片，不能用來決定會員 GB 或真實照片畫質。"}\n\n暫定：1920px 展示圖／480px 縮圖／WebP 品質參數 82／不放大小圖。2560px 僅為比較組。\n\n| 樣本 | 1920 組 bytes | 2560 組 bytes |\n| --- | ---: | ---: |\n${mdRows.join("\n")}\n\n數值為展示圖加縮圖，不包含原圖或其他成本。可直接開啟同目錄 comparison.png 查看並排預覽；放大細節請下載獨立 WebP。HTML 是可下載的離線網頁，聊天介面可能只顯示原始碼，請優先閱讀這份 Markdown 或 PNG。\n\n正式上傳未啟用，沒有設定 GB 額度。\n`);
await writeFile(join(output, "comparison.html"), `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>圖片規格比較</title><style>body{font:16px system-ui;max-width:1400px;margin:24px auto;padding:0 20px;background:#f5f6f8;color:#17202b}.columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}img{width:100%;height:auto}section{background:white;padding:20px;margin:24px 0;border-radius:12px}p{line-height:1.7}@media(max-width:700px){.columns{grid-template-columns:1fr}}</style><h1>圖片規格比較：暫定 1920px 與比較組 2560px</h1><p><strong>${input ? "來源：使用者提供的本機圖片；報告可能包含私人內容，請自行控管分享。" : "來源：自行產生的合成測試圖，並非真實房源照片。只能驗證處理與量測，不能據此定會員 GB 或真實照片畫質。"}</strong></p><p>兩組皆為 WebP 品質參數 82、縮圖最長邊 480px、不放大小圖。點圖可下載圖片，再以原尺寸檢視。圖片位元組包含於本檔，離線即可比較；不連外、不上傳。正式上傳保持關閉。</p>${cards.join("")}</html>`);
console.log(JSON.stringify({ output, sourceKind, measurements }, null, 2));
