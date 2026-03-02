const crypto = require("crypto");
const https = require("https");

const webhook = process.env.FEISHU_WEBHOOK;
const secret = process.env.FEISHU_SECRET;

// ====== 你的持仓（自己改） ======
const holdings = {
  bitcoin: 1.0,
  ethereum: 10,
  solana: 20,
};

// ====== 工具函数 ======
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

function sign(timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto
    .createHmac("sha256", stringToSign)
    .update("")
    .digest("base64");
}

(async () => {
  // ====== 获取行情 ======
  const market = await fetch(
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana"
  );

  // ====== 获取恐慌贪婪指数 ======
  const fear = await fetch("https://api.alternative.me/fng/");

  const fearValue = fear.data[0].value;
  const fearText = fear.data[0].value_classification;

  let totalValue = 0;
  let alert = "";

  const lines = market.map((coin) => {
    const change = coin.price_change_percentage_24h;
    const arrow = change >= 0 ? "🔺" : "🔻";
    const percent = change.toFixed(2);

    if (Math.abs(change) >= 5) {
      alert += `⚠ ${coin.symbol.toUpperCase()} 波动超过 5%\n`;
    }

    if (holdings[coin.id]) {
      const value = holdings[coin.id] * coin.current_price;
      totalValue += value;
    }

    return `${coin.symbol.toUpperCase()}  $${coin.current_price}  ${arrow} ${percent}%`;
  });

  // ====== 构造卡片 ======
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = sign(timestamp);

  const body = JSON.stringify({
    timestamp,
    sign: signature,
    msg_type: "interactive",
    card: {
      header: {
        title: {
          tag: "plain_text",
          content: "📊 专业加密市场监控",
        },
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: lines.join("\n"),
          },
        },
        { tag: "hr" },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `💰 持仓总价值: $${totalValue.toFixed(2)}`,
          },
        },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `😨 恐慌贪婪指数: ${fearValue} (${fearText})`,
          },
        },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: alert || "✅ 波动正常",
          },
        },
      ],
    },
  });

  const url = new URL(webhook);

  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const req = https.request(options, (res) => {
    res.on("data", (d) => process.stdout.write(d));
  });

  req.on("error", console.error);
  req.write(body);
  req.end();
})();