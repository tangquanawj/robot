const axios = require("axios");
const crypto = require("crypto");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

const webhook = process.env.FEISHU_WEBHOOK;
const secret = process.env.FEISHU_SECRET;

// 核心币池和轮动币池
const coreCoins = ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"];
const rotationCoins = ["NEAR-USDT-SWAP", "ARB-USDT-SWAP", "APT-USDT-SWAP", "SUI-USDT-SWAP", "RNDR-USDT-SWAP"];
const allCoins = [...coreCoins, ...rotationCoins];

// 持仓示例
const holdings = {
  "BTC-USDT-SWAP": 0.5,
  "ETH-USDT-SWAP": 2,
  "SOL-USDT-SWAP": 10
};

// 飞书签名函数
function sign(timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac("sha256", stringToSign).update("").digest("base64");
}

// 获取 OKX 最新价格，只保留活跃合约
async function getTicker(instId) {
  try {
    const res = await axios.get("https://www.okx.com/api/v5/market/ticker", { params: { instId } });
    const data = res.data.data?.[0];
    if (!data || data.instStatus !== "live") return null; // 仅保留活跃合约
    const lastPrice = parseFloat(data.last);
    const open24h = parseFloat(data.open24h);
    const change = ((lastPrice - open24h) / open24h) * 100;
    return { instId, lastPrice, change };
  } catch {
    return null; // 请求错误也返回 null
  }
}

// 获取 OKX 7 日 K 线价格 Base64
async function getChartBase64(instId, days = 7) {
  try {
    const res = await axios.get("https://www.okx.com/api/v5/market/history-candles", { params: { instId, bar: "1d", limit: days } });
    const prices = res.data.data?.map(item => parseFloat(item[4])) || [];
    if (!prices.length) return null;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width: 800, height: 400 });
    const configuration = {
      type: "line",
      data: { labels: prices.map((_, i) => `Day ${i + 1}`), datasets: [{ label: instId.split("-")[0], data: prices, borderColor: "rgb(75,192,192)", fill: false }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false } } }
    };
    const dataUrl = await chartJSNodeCanvas.renderToDataURL(configuration, "image/png");
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  } catch {
    return null;
  }
}

(async () => {
  try {
    let totalValue = 0, alert = "", coreLines = [], rotationData = [];

    // 获取价格
    for (let instId of allCoins) {
      const ticker = await getTicker(instId);
      // if (!ticker) continue; // 忽略非活跃或请求失败的合约
      const arrow = ticker.change >= 0 ? "🔺" : "🔻";
      const line = `${instId.split("-")[0]} $${ticker.lastPrice.toFixed(2)} ${arrow} ${ticker.change.toFixed(2)}%`;

      if (coreCoins.includes(instId)) {
        coreLines.push(line);
        if (Math.abs(ticker.change) >= 5) alert += `⚠ ${instId} 核心币波动超过5%\n`;
        if (holdings[instId]) totalValue += holdings[instId] * ticker.lastPrice;
      }

      if (rotationCoins.includes(instId)) rotationData.push({ ...ticker, line });
    }

    // 排序Top3轮动币
    rotationData.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const topRotation = rotationData.slice(0, 3);

    // 生成图表Base64
    let rotationCharts = [];
    for (let coin of topRotation) {
      const chartBase64 = await getChartBase64(coin.instId);
      if (!chartBase64) continue; // 避免空图表
      rotationCharts.push({
        tag: "img",
        img_key: coin.instId,
        alt: `${coin.instId.split("-")[0]} 7D Chart`,
        img_url: `data:image/png;base64,${chartBase64}`
      });
    }

    // BTC资金费率
    let fundingRate = 0;
    try {
      const frRes = await axios.get("https://www.okx.com/api/v5/public/funding-rate", { params: { instId: "BTC-USDT-SWAP" } });
      fundingRate = parseFloat(frRes.data.data?.[0]?.fundingRate || 0) * 100;
    } catch {}

    // 构建元素
    const elements = [
      { tag: "div", text: { tag: "lark_md", content: "🔵 **核心监控池**\n" + coreLines.join("\n") } },
      { tag: "hr" },
      { tag: "div", text: { tag: "lark_md", content: "🟣 **轮动Top3池**\n" + topRotation.map(c => c.line).join("\n") } },
      ...rotationCharts,
      { tag: "hr" },
      { tag: "div", text: { tag: "lark_md", content: `💰 持仓总价值: $${totalValue.toFixed(2)}` } },
      { tag: "div", text: { tag: "lark_md", content: `📈 BTC 资金费率: ${fundingRate.toFixed(4)}%` } },
      { tag: "div", text: { tag: "lark_md", content: alert || "✅ 波动正常" } }
    ];

    // 构建卡片body
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = sign(timestamp);
    const body = {
      timestamp,
      sign: signature,
      msg_type: "interactive",
      card: {
        config: { wide_screen_mode: true },
        header: { title: { tag: "plain_text", content: "📊 Crypto Monitor Pro" }, template: "blue" },
        elements
      }
    };

    // 发送飞书
    const response = await axios.post(webhook, JSON.stringify(body), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    console.log("Feishu response:", response.data);

  } catch (err) {
    if (err.response) console.error("Feishu error:", err.response.data);
    else console.error("Request error:", err.message);
  }
})();