const axios = require("axios");
const crypto = require("crypto");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

const webhook = process.env.FEISHU_WEBHOOK;
const secret = process.env.FEISHU_SECRET;

// 币名称到代码的映射
const coinSymbols = {
  "bitcoin": "BTC",
  "ethereum": "ETH",
  "solana": "SOL",
  "binancecoin": "BNB",
  "ripple": "XRP",
  "cardano": "ADA",
  "near": "NEAR",
  "arbitrum": "ARB",
  "aptos": "APT",
  "sui": "SUI",
  "render-token": "RNDR",
  "polkadot": "DOT",
  "chainlink": "LINK",
  "avalanche": "AVAX",
  "polygon": "MATIC",
  "cosmos": "ATOM"
};

// 核心币池和轮动币池
const coreCoins = ["bitcoin", "ethereum", "solana", "binancecoin", "ripple", "cardano"];
const rotationCoins = ["near", "arbitrum", "aptos", "sui", "render-token", "polkadot", "chainlink", "avalanche", "polygon", "cosmos"];
const allCoins = [...coreCoins, ...rotationCoins];

// 持仓示例
const holdings = {
  "bitcoin": 0.5,
  "ethereum": 2,
  "solana": 10,
  "binancecoin": 5,
  "ripple": 100,
  "cardano": 50
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

// 获取 BTC 资金费率
async function getBTCFundingRate() {
  try {
    console.log("Fetching BTC funding rate");
    // 使用 OKX API 获取 BTC/USDT 永续合约的资金费率
    const res = await axios.get("https://www.okx.com/api/v5/public/funding-rate", {
      params: {
        instId: "BTC-USDT-SWAP",
        limit: 1
      }
    });
    console.log("BTC funding rate response:", res.data);
    if (res.data && res.data.data && res.data.data.length > 0) {
      return res.data.data[0].fundingRate;
    }
    return null;
  } catch (error) {
    console.error("Error fetching BTC funding rate:", error.message);
    // 当遇到错误时，返回一个明确的错误信息
    if (error.response) {
      console.error("OKX API error response:", error.response.data);
    }
    return null;
  }
}

// 获取恐慌指数
async function getFearAndGreedIndex() {
  try {
    console.log("Fetching fear and greed index");
    const res = await axios.get("https://api.alternative.me/fng/");
    console.log("Fear and greed index response:", res.data);
    if (res.data && res.data.data && res.data.data.length > 0) {
      return {
        value: res.data.data[0].value,
        value_classification: res.data.data[0].value_classification
      };
    }
    return null;
  } catch (error) {
    console.error("Error fetching fear and greed index:", error.message);
    return null;
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
    
    // 获取 BTC 资金费率
    const btcFundingRate = await getBTCFundingRate();
    
    // 获取恐慌指数
    const fearAndGreed = await getFearAndGreedIndex();

    // 处理价格数据
    for (let instId of allCoins) {
      const data = tickers[instId];
      if (!data) continue; // 忽略请求失败的币
      const lastPrice = data.usd;
      const change = data.usd_24h_change;
      const arrow = change >= 0 ? "🔺" : "🔻";
      const symbol = coinSymbols[instId] || instId;
      const line = `${symbol} $${lastPrice.toFixed(2)} ${arrow} ${change.toFixed(2)}%`;

      if (coreCoins.includes(instId)) {
        coreLines.push(line);
        if (Math.abs(change) >= 5) alert += `⚠ ${symbol} 核心币波动超过5%\n`;
        if (holdings[instId]) totalValue += holdings[instId] * lastPrice;
      }

      if (rotationCoins.includes(instId)) rotationData.push({ instId, lastPrice, change, line });
    }

    // 排序Top3轮动币
    rotationData.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const topRotation = rotationData.slice(0, 3);

    // 暂时不生成图表，避免飞书API错误
    let rotationCharts = [];

    // 构建元素
    const elements = [
      { tag: "div", text: { tag: "lark_md", content: "🔵 **核心监控池** (24小时涨跌幅)\n" + coreLines.join("\n") } },
      { tag: "hr" },
      { tag: "div", text: { tag: "lark_md", content: "🟣 **轮动Top3池** (24小时涨跌幅)\n" + topRotation.map(c => c.line).join("\n") } },
      { tag: "hr" },
      { tag: "div", text: { tag: "lark_md", content: `💰 持仓总价值: $${totalValue.toFixed(2)}` } },
      { tag: "div", text: { tag: "lark_md", content: btcFundingRate ? `⚖️ BTC 资金费率: ${(parseFloat(btcFundingRate) * 100).toFixed(4)}%` : "⚖️ BTC 资金费率: 数据获取失败" } },
      { tag: "div", text: { tag: "lark_md", content: fearAndGreed ? `😨 恐慌指数: ${fearAndGreed.value} (${fearAndGreed.value_classification})` : "😨 恐慌指数: 数据获取失败" } },
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
      
      // 添加延迟，避免飞书API频率限制
      await new Promise(resolve => setTimeout(resolve, 1000));
      
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