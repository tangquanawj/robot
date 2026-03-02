const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

const webhook = process.env.FEISHU_WEBHOOK;
const secret = process.env.FEISHU_SECRET;

/* ======================
   双池配置
====================== */

const coreCoins = [
  "bitcoin",
  "ethereum",
  "solana",
  "bnb",
  "ripple",
  "dogecoin",
  "cardano",
  "avalanche-2",
  "chainlink",
  "polkadot"
];

const rotationCoins = [
  "near",
  "arbitrum",
  "optimism",
  "aptos",
  "sui",
  "render-token",
  "injective-protocol",
  "fetch-ai"
];

const allCoins = [...coreCoins, ...rotationCoins];

/* ======================
   持仓（自己改）
====================== */

const holdings = {
  bitcoin: 0.5,
  ethereum: 2,
  solana: 10
};

/* ======================
   签名
====================== */

function sign(timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto
    .createHmac("sha256", stringToSign)
    .update("")
    .digest("base64");
}

/* ======================
   生成 BTC 7天走势图
====================== */

async function generateChart(prices) {
  const width = 800;
  const height = 400;
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

  const configuration = {
    type: "line",
    data: {
      labels: prices.map((_, i) => `Day ${i + 1}`),
      datasets: [
        {
          label: "BTC 7D Price",
          data: prices,
          fill: false,
          borderWidth: 2
        }
      ]
    }
  };

  const image = await chartJSNodeCanvas.renderToBuffer(configuration);
  fs.writeFileSync("chart.png", image);
}

/* ======================
   主程序
====================== */

(async () => {
  try {
    // ===== 市场数据 =====
    const marketRes = await axios.get(
      "https://api.coingecko.com/api/v3/coins/markets",
      {
        params: {
          vs_currency: "usd",
          ids: allCoins.join(",")
        }
      }
    );

    const market = marketRes.data;

    // ===== Fear & Greed =====
    const fearRes = await axios.get("https://api.alternative.me/fng/");
    const fear = fearRes.data.data[0];

    // ===== BTC 7天图 =====
    const chartRes = await axios.get(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart",
      {
        params: { vs_currency: "usd", days: 7 }
      }
    );

    const prices = chartRes.data.prices.map(p => p[1]);
    await generateChart(prices);

    // ===== OKX 资金费率 =====
    const okxRes = await axios.get(
      "https://www.okx.com/api/v5/public/funding-rate",
      {
        params: { instId: "BTC-USDT-SWAP" }
      }
    );

    const fundingRate =
      parseFloat(okxRes.data.data[0].fundingRate) * 100;

    /* ======================
       分组处理
    ====================== */

    let totalValue = 0;
    let alert = "";

    let coreLines = [];
    let rotationLines = [];

    market.forEach(coin => {
      const change = coin.price_change_percentage_24h;
      const arrow = change >= 0 ? "🔺" : "🔻";
      const line =
        `${coin.symbol.toUpperCase()}  $${coin.current_price}  ${arrow} ${change.toFixed(2)}%`;

      if (coreCoins.includes(coin.id)) {
        coreLines.push(line);

        if (Math.abs(change) >= 5) {
          alert += `⚠ ${coin.symbol.toUpperCase()} 核心币波动超过5%\n`;
        }

        if (holdings[coin.id]) {
          totalValue += holdings[coin.id] * coin.current_price;
        }
      }

      if (rotationCoins.includes(coin.id)) {
        rotationLines.push(line);

        if (Math.abs(change) >= 8) {
          alert += `🔥 ${coin.symbol.toUpperCase()} 轮动币波动超过8%\n`;
        }
      }
    });

    /* ======================
       飞书发送
    ====================== */

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = sign(timestamp);

    const body = {
      timestamp,
      sign: signature,
      msg_type: "interactive",
      card: {
        header: {
          title: {
            tag: "plain_text",
            content: "📊 Crypto Monitor Pro"
          }
        },
        elements: [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: "🔵 **核心监控池**\n" + coreLines.join("\n")
            }
          },
          { tag: "hr" },
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: "🟣 **轮动热点池**\n" + rotationLines.join("\n")
            }
          },
          { tag: "hr" },
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: `💰 持仓总价值: $${totalValue.toFixed(2)}`
            }
          },
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: `😨 Fear & Greed: ${fear.value} (${fear.value_classification})`
            }
          },
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: `📈 BTC 资金费率: ${fundingRate.toFixed(4)}%`
            }
          },
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: alert || "✅ 波动正常"
            }
          }
        ]
      }
    };

    await axios.post(webhook, body);

    console.log("Push success");
  } catch (err) {
    console.error(err);
  }
})();