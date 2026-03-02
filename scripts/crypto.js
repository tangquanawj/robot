const axios = require("axios");
const crypto = require("crypto");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

const webhook = process.env.FEISHU_WEBHOOK;
const secret = process.env.FEISHU_SECRET;

// 核心币池和轮动币池
const coreCoins = ["bitcoin", "ethereum", "solana"];
const rotationCoins = ["near", "arbitrum", "aptos", "sui", "render-token"];
const allCoins = [...coreCoins, ...rotationCoins];

// 持仓示例
const holdings = {
  "bitcoin": 0.5,
  "ethereum": 2,
  "solana": 10
};

// 飞书签名函数
function sign(timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac("sha256", stringToSign).update("").digest("base64");
}

// 批量获取 CoinGecko 最新价格
async function getTickers(coinIds) {
  try {
    console.log(`Fetching data for ${coinIds.join(', ')}`);
    const res = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
      params: {
        ids: coinIds.join(','),
        vs_currencies: "usd",
        include_24hr_change: true
      },
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      }
    });
    console.log("Response:", res.data);
    return res.data;
  } catch (error) {
    console.error("Error fetching tickers:", error.message);
    return {};
  }
}

// 获取 CoinGecko 7 日 K 线价格 Base64
async function getChartBase64(coinId, days = 7) {
  try {
    console.log(`Fetching chart data for ${coinId}`);
    const res = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart`, {
      params: {
        vs_currency: "usd",
        days: days - 1, // CoinGecko 的 days 参数是从今天往前数的天数
        interval: "daily"
      },
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      }
    });
    console.log(`Chart response for ${coinId}:`, res.data);
    const prices = res.data.prices?.map(item => item[1]) || [];
    if (!prices.length) return null;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width: 800, height: 400 });
    const configuration = {
      type: "line",
      data: { labels: prices.map((_, i) => `Day ${i + 1}`), datasets: [{ label: coinId, data: prices, borderColor: "rgb(75,192,192)", fill: false }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false } } }
    };
    const dataUrl = await chartJSNodeCanvas.renderToDataURL(configuration, "image/png");
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  } catch (error) {
    console.error(`Error fetching chart data for ${coinId}:`, error.message);
    return null;
  }
}

(async () => {
  try {
    let totalValue = 0, alert = "", coreLines = [], rotationData = [];

    // 批量获取价格
    const tickers = await getTickers(allCoins);

    // 处理价格数据
    for (let instId of allCoins) {
      const data = tickers[instId];
      if (!data) continue; // 忽略请求失败的币
      const lastPrice = data.usd;
      const change = data.usd_24h_change;
      const arrow = change >= 0 ? "🔺" : "🔻";
      const line = `${instId} $${lastPrice.toFixed(2)} ${arrow} ${change.toFixed(2)}%`;

      if (coreCoins.includes(instId)) {
        coreLines.push(line);
        if (Math.abs(change) >= 5) alert += `⚠ ${instId} 核心币波动超过5%\n`;
        if (holdings[instId]) totalValue += holdings[instId] * lastPrice;
      }

      if (rotationCoins.includes(instId)) rotationData.push({ instId, lastPrice, change, line });
    }

    // 排序Top3轮动币
    rotationData.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const topRotation = rotationData.slice(0, 3);

    // 生成图表Base64
    let rotationCharts = [];
    for (let coin of topRotation) {
      const chartBase64 = await getChartBase64(coin.instId);
      if (!chartBase64) continue; // 避免空图表
      
      // 检查Base64字符串长度
      console.log(`Chart Base64 length for ${coin.instId}: ${chartBase64.length}`);
      
      // 限制Base64字符串长度，避免超过飞书API限制
      const maxLength = 100000; // 100KB
      if (chartBase64.length > maxLength) {
        console.log(`Chart Base64 for ${coin.instId} is too long, skipping`);
        continue;
      }
      
      rotationCharts.push({
        tag: "img",
        img_key: coin.instId,
        alt: `${coin.instId} 7D Chart`,
        img_url: `data:image/png;base64,${chartBase64}`
      });
    }

    // 构建元素
    const elements = [
      { tag: "div", text: { tag: "lark_md", content: "🔵 **核心监控池**\n" + coreLines.join("\n") } },
      { tag: "hr" },
      { tag: "div", text: { tag: "lark_md", content: "🟣 **轮动Top3池**\n" + topRotation.map(c => c.line).join("\n") } },
      ...rotationCharts,
      { tag: "hr" },
      { tag: "div", text: { tag: "lark_md", content: `💰 持仓总价值: $${totalValue.toFixed(2)}` } },
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
    if (webhook) {
      // 检查body大小
      const bodyString = JSON.stringify(body);
      console.log(`Body length: ${bodyString.length}`);
      
      // 检查图片元素
      console.log(`Number of image elements: ${rotationCharts.length}`);
      
      try {
        const response = await axios.post(webhook, bodyString, { headers: { "Content-Type": "application/json; charset=utf-8" } });
        console.log("Feishu response:", response.data);
      } catch (error) {
        console.error("Error sending Feishu message:", error.message);
        if (error.response) {
          console.error("Feishu error response:", error.response.data);
        }
      }
    } else {
      console.log("Webhook not set, skipping Feishu message sending");
      console.log("Core coins:", coreLines);
      console.log("Top rotation coins:", topRotation.map(c => c.line));
      console.log("Total value:", totalValue.toFixed(2));
      console.log("Alert:", alert || "No alerts");
    }

  } catch (err) {
    if (err.response) console.error("Feishu error:", err.response.data);
    else console.error("Request error:", err.message);
  }
})();