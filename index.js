require("dotenv").config();
const { Telegraf, Scenes, session } = require("telegraf");
const { createCallBackBtn } = require("./utils");
const { importWalletScene, importWalletStep } = require("./scenes");
const fetch = require('node-fetch'); // Ensure you have node-fetch installed

const bot = new Telegraf(process.env.TG_WALLET_BOT_TOKEN);

const stage = new Scenes.Stage([importWalletStep]);
bot.use(session());
bot.use(stage.middleware());

let coinData = null;

// Function to fetch data from the API
const fetchData = async () => {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=archway');
        if (!response.ok) {
            throw new Error('Network response was not ok ' + response.statusText);
        }
        const result = await response.json();
        coinData = result;
    } catch (error) {
        console.error('There has been a problem with your fetch operation:', error);
    }
};

// Fetch data every 5 seconds
fetchData();
setInterval(fetchData, 5000);

bot.command("start", (ctx) => {
  const message = `Welcome to the TG Wallet Bot!`;

  const importWalletButton = createCallBackBtn(
    "Import Wallet",
    "import-wallet"
  );

  const showWalletButton = createCallBackBtn("Show Wallet", "show-wallet");

  const showCoinDataButton = createCallBackBtn("Show Coin Data", "show-coin-data");

  ctx.reply(message, {
    reply_markup: {
      inline_keyboard: [
        [importWalletButton], 
        [showWalletButton], 
        [showCoinDataButton]
      ],
    },
  });
});

bot.action("import-wallet", (ctx) => {
  ctx.scene.enter(importWalletScene);
});

bot.action("show-wallet", (ctx) => {
  if (ctx.session.wallet) {
    ctx.reply(`Your wallet address is ${ctx.session.wallet.address}`);
  } else {
    ctx.reply("You have not imported any wallet yet.");
  }
});

bot.action("show-coin-data", (ctx) => {
  if (coinData) {
    const coin = coinData[0];
    const message = `
      ${coin.name}
      Current Price: $${coin.current_price}
      Market Cap: $${coin.market_cap}
      24h Change: ${coin.price_change_percentage_24h}%
    `;
    ctx.replyWithPhoto(coin.image, { caption: message });
  } else {
    ctx.reply("Data is loading, please try again in a few seconds.");
  }
});

bot.launch();
