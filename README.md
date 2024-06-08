# Arch Telegram Trading Rust Bot

Welcome to the **Arch Telegram Trading Rust Bot** project!
This is a simple yet powerful Telegram trading bot written in Rust (for speed transactions and security) using the [`teloxide`](https://github.com/teloxide/teloxide) library. The bot is designed to interact with users and perform various tasks based on the messages it receives.

## Features

- **Base64 Decoding**: Decode base64 encoded strings from user messages.
- **Referral and Query Handling**: Extract referral and query parameters from decoded data.
- **Dynamic URL Generation**: Generate and send dynamic URLs based on user status and message content.
- **Inline Keyboard**: Send messages with inline keyboard buttons.

## Prerequisites

- Rust (latest stable version recommended)
- Telegram Bot Token

## Demo Video - Please ensure you turn on the speaker in the video before playing.

https://github.com/user-attachments/assets/5e713de4-3ff6-4f96-aa14-3165ea88ccd3

https://github.com/user-attachments/assets/07be646b-dd10-4a13-9d7f-12883d0c6b98

https://github.com/user-attachments/assets/044bcbaf-6139-4381-b6be-0f9d0be56ce2

## Usage

Once the bot is running, you can interact with it on Telegram from your mobile. Send a message to the bot, swap cw20 tokens and monitor transactions all on archway straight from your phone.

Now you can trade directly on archway from your mobile using archtradingbot.

## Installation

1. Clone the repository:
    ```sh
    git clone https://github.com/degenbuilder7/arch-tg-bot
    ```

2. Set up your environment variables:
    ```sh
    export TELEGRAM_BOT_TOKEN=7215566153:
    ```

3. Build and run the bot:
    ```sh
    cargo build --release
    cargo run --release
    ```
    
## Code Overview

The archway tg bot code is a Cosmos-WebAssembly (Wasm) smart contract written in Rust. It handles various functions related to atomic swaps, including creating, releasing, and refunding swaps. The `start` function is used to handle incoming messages from Telegram, and it includes logic to parse and process user input. Here's a breakdown of the relevant parts:

### Telegram Bot Logic
The `start` function is called when a user sends a message to the bot. It parses the message text and extracts any parameters. If the message contains a referral ID and a query ID, it constructs a URL with these parameters and sends a response with an inline keyboard that includes a button to visit the web page.

```rust
async fn start(message: Message, bot: Bot) -> ResponseResult<()> {
    let mut params = Vec::new();
    if let Some(text) = message.text() {
        let args: Vec<&str> = text.splitn(2, ' ').collect();
        let data_str = if args.len() > 1 { args[1] } else { "" };
        let decoded_data = base64::engine::general_purpose::URL_SAFE.decode(data_str).ok().and_then(|bytes| String::from_utf8(bytes).ok());
        if let Some(decoded_data) = decoded_data {
            let ref_index = decoded_data.find("r=");
            let query_index = decoded_data.find("q=");
            if let Some(ref_index) = ref_index {
                let referral_id = &decoded_data[ref_index + 2..query_index.unwrap_or(decoded_data.len())];
                params.push(format!("ref={}", referral_id));
                if let Some(query_index) = query_index {
                    let query_id = &decoded_data[query_index + 2..];
                    params.push(format!("q={}", query_id));
                }
                let premium_user_status = message.from().map_or(false, |user| user.is_premium);
                if premium_user_status {
                    params.push(format!("pr={}", premium_user_status));
                }
                let url = if params.is_empty() {
                    URL.to_string()
                } else {
                    format!("{}?{}", URL, params.join("&"))
                };
                let url = reqwest::Url::parse(&url).expect("Invalid URL");
                let inline_kb = InlineKeyboardMarkup::new(vec![vec![InlineKeyboardButton::url("Visit Web Page", url.clone())]]);
                bot.send_message(message.chat.id, format!("Hello This is archway trading bot. You can cw20 tokens straight from the Bot itself")).parse_mode(ParseMode::Html).reply_markup(inline_kb).await?;
                Ok(())
            }
        }
    }
}
```

### Telegram Bot Initialization
The `main` function initializes the Telegram bot and sets up the `start` function to handle incoming messages.

```rust
#[tokio::main]
async fn main() {
    env_logger::builder().filter_level(LevelFilter::Info).init();
    let token = env::var("TELEGRAM_BOT_TOKEN").expect("TELEGRAM_BOT_TOKEN not set");
    let bot = Bot::new(token);
    teloxide::repl(bot.clone(), move |message| {
        let bot = bot.clone();
        async move {
            start(message, bot).await.log_on_error().await;
            respond(())
        }
    }).await;
}
```

### Atomic Swap Logic
The contract includes functions for creating, releasing, and refunding atomic swaps. These functions handle the storage and retrieval of swap details, as well as the execution of token transfers.

```rust
#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(deps: DepsMut, env: Env, info: MessageInfo, msg: ExecuteMsg) -> Result {
    match msg {
        ExecuteMsg::Create(msg) => {
            let sent_funds = info.funds.clone();
            execute_create(deps, env, info, msg, Balance::from(sent_funds))
        }
        ExecuteMsg::Release { id, preimage } => execute_release(deps, env, id, preimage),
        ExecuteMsg::Refund { id } => execute_refund(deps, env, id),
        ExecuteMsg::Receive(msg) => execute_receive(deps, env, info, msg),
    }
}

pub fn execute_create(deps: DepsMut, env: Env, info: MessageInfo, msg: CreateMsg, balance: Balance) -> Result {
    if !is_valid_name(&msg.id) {
        return Err(ContractError::InvalidId {});
    }
    if balance.is_empty() {
        return Err(ContractError::EmptyBalance {});
    }
    let hash = parse_hex_32(&msg.hash)?;
    let recipient = deps.api.addr_validate(&msg.recipient)?;
    let swap = AtomicSwap {
        hash: Binary(hash),
        recipient,
        source: info.sender,
        expires: msg.expires,
        balance,
    };
    SWAPS.update(deps.storage, &msg.id, |existing| match existing {
        None => Ok(swap),
        Some(_) => Err(ContractError::AlreadyExists {}),
    })?;
    let res = Response::new()
        .add_attribute("action", "create")
        .add_attribute("id", msg.id)
        .add_attribute("hash", msg.hash)
        .add_attribute("recipient", msg.recipient);
    Ok(res)
}

pub fn execute_release(deps: DepsMut, env: Env, id: String, preimage: String) -> Result {
    let swap = SWAPS.load(deps.storage, &id)?;
    if swap.is_expired(&env.block) {
        return Err(ContractError::Expired {});
    }
    let hash = Sha256::digest(&parse_hex_32(&preimage)?);
    if hash.as_slice() != swap.hash.as_slice() {
        return Err(ContractError::InvalidPreimage {});
    }
    SWAPS.remove(deps.storage, &id);
    let msgs = send_tokens(&swap.recipient, swap.balance)?;
    Ok(Response::new()
        .add_submessages(msgs)
        .add_attribute("action", "release")
        .add_attribute("id", id)
        .add_attribute("preimage", preimage)
        .add_attribute("to", swap.recipient.to_string()))
}

pub fn execute_refund(deps: DepsMut, env: Env, id: String) -> Result {
    let swap = SWAPS.load(deps.storage, &id)?;
    if !swap.is_expired(&env.block) {
        return Err(ContractError::NotExpired {});
    }
    SWAPS.remove(deps.storage, &id);
    let msgs = send_tokens(&swap.source, swap.balance)?;
    Ok(Response::new()
        .add_submessages(msgs)
        .add_attribute("action", "refund")
        .add_attribute("id", id)
        .add_attribute("to", swap.source.to_string()))
}
```

### Query Functions
The contract includes functions for querying swap details and listing all swaps.

```rust
#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult {
    match msg {
        QueryMsg::List { start_after, limit } => to_binary(&query_list(deps, start_after, limit)?),
        QueryMsg::Details { id } => to_binary(&query_details(deps, id)?),
    }
}

fn query_details(deps: Deps, id: String) -> StdResult {
    let swap = SWAPS.load(deps.storage, &id)?;
    let balance_human = match swap.balance {
        Balance::Native(coins) => BalanceHuman::Native(coins.into_vec()),
        Balance::Cw20(coin) => BalanceHuman::Cw20(Cw20Coin {
            address: coin.address.into(),
            amount: coin.amount,
        }),
    };
    let details = DetailsResponse {
        id,
        hash: hex::encode(swap.hash.as_slice()),
        recipient: swap.recipient.into(),
        source: swap.source.into(),
        expires: swap.expires,
        balance: balance_human,
    };
    Ok(details)
}
```

### Main Function

The main function initializes the bot and starts the message handling loop.

```rust
#[tokio::main]
async fn main() {
    env_logger::builder().filter_level(LevelFilter::Info).init();

    // Read the Telegram bot token from the environment variable
    let token = env::var("TELEGRAM_BOT_TOKEN").expect("TELEGRAM_BOT_TOKEN not set");

    // Initialize the bot with the token
    let bot = Bot::new(token);

    teloxide::repl(bot.clone(), move |message| {
        let bot = bot.clone();
        async move {
            start(message, bot).await.log_on_error().await;
            respond(())
        }
    }).await;
}
```

### Start Function

The `start` function processes incoming messages and sends responses with inline keyboard buttons.

```rust
async fn start(message: Message, bot: Bot) -> ResponseResult<()> {
    let mut params = Vec::new();
    if let Some(text) = message.text() {
        let args: Vec<&str> = text.splitn(2, ' ').collect();
        let data_str = if args.len() > 1 { args[1] } else { "" };

        let decoded_data = base64::engine::general_purpose::URL_SAFE
            .decode(data_str)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok());

        if let Some(decoded_data) = decoded_data {
            let ref_index = decoded_data.find("r=");
            let query_index = decoded_data.find("q=");
            if let Some(ref_index) = ref_index {
                let referral_id =
                    &decoded_data[ref_index + 2..query_index.unwrap_or(decoded_data.len())];
                params.push(format!("ref={}", referral_id));
            }
            if let Some(query_index) = query_index {
                let query_id = &decoded_data[query_index + 2..];
                params.push(format!("q={}", query_id));
            }
        }
    }

    let premium_user_status = message.from().map_or(false, |user| user.is_premium);
    if premium_user_status {
        params.push(format!("pr={}", premium_user_status));
    }

    let url = if params.is_empty() {
        URL.to_string()
    } else {
        format!("{}?{}", URL, params.join("&"))
    };

    // Convert the URL string to a reqwest::Url
    let url = reqwest::Url::parse(&url).expect("Invalid URL");

    let inline_kb = InlineKeyboardMarkup::new(
        vec![vec![InlineKeyboardButton::url(
            "Visit Web Page",
            url.clone(),
        )]]
    );

    bot
        .send_message(
            message.chat.id,
            format!("Hello! This is a trading bot. You can visit the web page by clicking the button below.\n\n{}\n<a href='{}'>URL</a>", url, url)
        )
        .parse_mode(ParseMode::Html)
        .reply_markup(inline_kb).await?;

    Ok(())
}
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any improvements or bug fixes.

## License

This project is licensed under the MIT License.