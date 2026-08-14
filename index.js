require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const cron = require("node-cron");
const http = require("http");
const kb = require("./knowledgeBase");

// ============================================================
// BASIC SETUP
// ============================================================

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Coach Godbless bot is running.");
}).listen(PORT, () => {
  console.log(`Keep-alive server listening on port ${PORT}`);
});

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const geminiModel = genAI.getGenerativeModel({
  model: "gemini-flash-lite-latest"
});

const OWNER_ID = process.env.OWNER_TELEGRAM_ID;

const DB_FILE = "./leads.json";

// ============================================================
// PAYMENT INFORMATION
// ============================================================

const SELAR_LINK = "https://selar.com/1j8799";

const PAYMENT_DETAILS = `
MAKE PAYMENT HERE

⤵️⤵️⤵️⤵️⤵️⤵️

📮 Account Number: 7015269313
🏦 Bank: Opay
👤 Account Name: Godbless Paulinus Ben

NOTE: After payment, kindly send a screenshot for payment proof so I can confirm your payment.

Once done, let me know so I can proceed with your registration.
`;

// ============================================================
// DATABASE
// ============================================================

function loadLeads() {
  if (!fs.existsSync(DB_FILE)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (error) {
    console.error("Database read error:", error);
    return {};
  }
}

function saveLeads(leads) {
  try {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(leads, null, 2)
    );
  } catch (error) {
    console.error("Database save error:", error);
  }
}

function getLead(userId, name) {
  const leads = loadLeads();

  if (!leads[userId]) {
    leads[userId] = {
      name,
      stage: "new",
      source: "direct",
      goal: null,
      experience: null,
      challenge: null,
      interest: null,
      objection: null,
      followUpCount: 0,
      lastMessageAt: Date.now(),
      history: []
    };

    saveLeads(leads);
  }

  return leads[userId];
}

function updateLead(userId, updates) {
  const leads = loadLeads();

  if (!leads[userId]) {
    leads[userId] = {
      name: "there",
      stage: "new",
      history: []
    };
  }

  leads[userId] = {
    ...leads[userId],
    ...updates,
    lastMessageAt: Date.now()
  };

  saveLeads(leads);

  return leads[userId];
}

function appendHistory(userId, role, text) {
  const leads = loadLeads();

  if (!leads[userId]) return;

  const history = leads[userId].history || [];

  history.push({
    role,
    text,
    timestamp: Date.now()
  });

  // Keep the most recent 12 messages
  leads[userId].history = history.slice(-12);

  saveLeads(leads);
}

// ============================================================
// TEXT HELPERS
// ============================================================

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .trim();
}

function containsAny(text, phrases) {
  const lower = normalize(text);

  return phrases.some(phrase =>
    lower.includes(phrase)
  );
}

// ============================================================
// INTENT DETECTION
// ============================================================

function isPaymentIntent(text) {
  return containsAny(text, [
    "i want to pay",
    "i want to make payment",
    "i want to make the payment",
    "ready to pay",
    "ready to register",
    "ready to start",
    "i'm ready",
    "im ready",
    "i am ready",
    "i'm in",
    "im in",
    "let's do this",
    "lets do this",
    "send account",
    "account number",
    "bank details",
    "bank account",
    "payment details",
    "how do i pay",
    "where do i pay",
    "payment link",
    "registration link",
    "send the link",
    "send link",
    "i want to register",
    "i want to enroll",
    "how can i register"
  ]);
}

function isPriceQuestion(text) {
  return containsAny(text, [
    "how much",
    "what is the price",
    "what's the price",
    "whats the price",
    "price",
    "cost",
    "fee",
    "how much is it",
    "registration fee"
  ]);
}

function isSelarRequest(text) {
  return containsAny(text, [
    "selar link",
    "selar",
    "registration link",
    "payment link",
    "send the link",
    "send link"
  ]);
}

function isAccountRequest(text) {
  return containsAny(text, [
    "account number",
    "bank details",
    "bank account",
    "opay",
    "account details",
    "transfer",
    "make payment"
  ]);
}

function isObjection(text) {
  return containsAny(text, [
    "too expensive",
    "expensive",
    "can't afford",
    "cannot afford",
    "i don't have money",
    "no money",
    "let me think",
    "let me think about it",
    "i need to think",
    "is this a scam",
    "scam",
    "is it legit",
    "not sure",
    "i'm scared",
    "i am scared",
    "don't have time",
    "do not have time",
    "no time",
    "i've tried",
    "i have tried",
    "tried before",
    "does it work"
  ]);
}

// ============================================================
// SEND OWNER NOTIFICATION
// ============================================================

async function notifyOwner(message) {
  if (!OWNER_ID) return;

  try {
    await bot.telegram.sendMessage(
      OWNER_ID,
      message,
      { parse_mode: "HTML" }
    );
  } catch (error) {
    console.error("Owner notification error:", error.message);
  }
}

// ============================================================
// GENERATE SMART GEMINI REPLY
// ============================================================

async function generateSmartReply(
  userMessage,
  lead,
  extraContext = ""
) {
  const historyText =
    (lead.history || [])
      .map(item =>
        `${item.role === "user" ? "Prospect" : "Assistant"}: ${item.text}`
      )
      .join("\n") || "(No previous conversation)";

  const prompt = `
You are the official sales and education assistant for:

Coach Godbless
${kb.programName}

You are part of Coach Godbless's team.

IMPORTANT IDENTITY RULE:
Never claim that you literally are Coach Godbless.
Do not say "I am an AI".
Speak naturally as a helpful member of Coach Godbless's team.

==================================================
YOUR MAIN JOB
==================================================

Your job is to help prospects understand affiliate marketing and the Affiliate Success Academy before they decide whether they want to join.

You are NOT a pushy salesperson.

Your job is:

1. Understand the prospect.
2. Discover their goal when useful.
3. Understand their experience level.
4. Educate them.
5. Explain how affiliate marketing works.
6. Explain how the program can help.
7. Build trust using ONLY the information provided.
8. Handle genuine objections.
9. Identify serious buying intent.
10. Guide serious prospects toward registration.

Never pressure someone into buying.

==================================================
CONVERSATION STRATEGY
==================================================

Use this naturally:

WELCOME
↓
UNDERSTAND
↓
EDUCATE
↓
BUILD TRUST
↓
SHOW SOLUTION
↓
HANDLE OBJECTION
↓
QUALIFY
↓
CLOSE

Do NOT force every stage.

If the prospect already gave you their goal, DO NOT ask for it again.

If they already told you they are a beginner, DO NOT ask whether they are a beginner again.

Use their previous answers.

==================================================
VERY IMPORTANT
==================================================

Ask only ONE question at a time.

Do not ask:

"What is your goal, have you tried affiliate marketing before, and how much do you want to earn?"

Instead ask one useful question.

Example:

"What made you interested in affiliate marketing in the first place?"

Then wait for their answer.

==================================================
EDUCATION
==================================================

When someone asks what affiliate marketing is:

Explain simply:

Affiliate marketing is a performance-based digital business model where someone promotes a product/service using a unique referral link and earns a commission when a qualifying sale happens.

Do not promise guaranteed income.

Explain that results depend on:

- learning
- strategy
- consistency
- traffic
- communication
- execution

==================================================
PROGRAM
==================================================

Program information:

${kb.programOverview}

Pricing:

${kb.pricing}

Testimonials:

${kb.testimonials}

Objection guidance:

${kb.objectionGuidance}

==================================================
PROSPECT INFORMATION
==================================================

Name:
${lead.name || "Prospect"}

Current stage:
${lead.stage || "new"}

Source:
${lead.source || "direct"}

Goal:
${lead.goal || "Unknown"}

Experience:
${lead.experience || "Unknown"}

Challenge:
${lead.challenge || "Unknown"}

Interest:
${lead.interest || "Unknown"}

Objection:
${lead.objection || "None"}

==================================================
CURRENT CONTEXT
==================================================

${extraContext}

==================================================
CONVERSATION HISTORY
==================================================

${historyText}

==================================================
REPLY STYLE
==================================================

Keep replies natural.

Usually 2-5 sentences.

Use simple language.

Light emojis are okay.

Do not sound like an advertisement.

Do not repeatedly say:

"Wow!"
"That's amazing!"
"Life-changing!"
"You don't want to miss this!"

Avoid fake hype.

Never invent:

- testimonials
- earnings
- student numbers
- discounts
- deadlines
- scarcity
- guarantees

==================================================
PRICE
==================================================

If the prospect asks the price, answer directly.

Do not hide the price.

Use only the pricing supplied in the knowledge base.

==================================================
PAYMENT
==================================================

If the prospect is clearly ready to register/pay, the system will handle the payment details separately.

Do not invent payment information.

==================================================
CLOSING
==================================================

When someone is clearly interested, use a natural close.

Examples:

"Would you like me to show you how to register?"

"Would you prefer the Selar registration option or direct transfer?"

"Do you feel ready to take the next step?"

Do not use the same closing sentence every time.

==================================================
FINAL RULE
==================================================

Answer the prospect's actual question first.

Do not force them into another topic.

User message:

${userMessage}
`;

  try {
    const result =
      await geminiModel.generateContent(prompt);

    return result.response.text().trim();
  } catch (error) {
    console.error("Gemini error:", error);

    return "I understand. Let me help you with that. What would you like to know first?";
  }
}

// ============================================================
// SMART LEAD STAGE UPDATE
// ============================================================

function determineStage(text, currentStage) {
  if (isPaymentIntent(text)) {
    return "payment_intent";
  }

  if (isObjection(text)) {
    return "objection";
  }

  if (isPriceQuestion(text)) {
    return "pricing";
  }

  if (currentStage === "new") {
    return "engaged";
  }

  return currentStage || "engaged";
}

// ============================================================
// PAYMENT FLOW
// ============================================================

async function sendPaymentOptions(ctx, name) {
  await ctx.reply(
    `Perfect, ${name}! 🎉

You're ready for the next step.

Here are the registration options:`
  );

  // SELAR
  await ctx.reply(
    `✅ OPTION 1 — REGISTER VIA SELAR

You can register instantly here:

👉 https://selar.com/1j8799

You can also use the button below 👇`,
    Markup.inlineKeyboard([
      Markup.button.url(
        "✅ Register & Pay via Selar",
        SELAR_LINK
      )
    ])
  );

  await ctx.reply(
    `After completing your Selar payment, kindly send your payment screenshot here so it can be confirmed.`
  );

  // DIRECT PAYMENT
  await ctx.reply(
    `OPTION 2 — DIRECT BANK TRANSFER 👇

*MAKE PAYMENT HERE*

⤵️⤵️⤵️⤵️⤵️⤵️

📮 Account Number: *7015269313*
🏦 Bank: *Opay*
👤 Account Name: *Godbless Paulinus Ben*

*NOTE:* After payment kindly send a screenshot for payment proof so I can confirm your payment.

*Once done, let me know so I can proceed with your registration.*`,
    {
      parse_mode: "Markdown"
    }
  );

  await notifyOwner(
    `💰 <b>PAYMENT INTENT</b>

👤 <a href="tg://user?id=${ctx.from.id}">${name}</a>

The prospect has reached the payment stage.

✅ Selar link sent
✅ Direct Opay details sent`
  );
}

// ============================================================
// GROUP HANDLER
// ============================================================

bot.on("message", async (ctx, next) => {
  const chatType = ctx.chat.type;

  if (
    chatType !== "group" &&
    chatType !== "supergroup"
  ) {
    return next();
  }

  const text = ctx.message.text;

  if (!text) return;

  const botUsername =
    ctx.botInfo.username.toLowerCase();

  const mentioned =
    text.toLowerCase()
      .includes("@" + botUsername);

  const looksLikeQuestion =
    text.trim().endsWith("?");

  if (!mentioned && !looksLikeQuestion) {
    return;
  }

  try {
    const temporaryLead = {
      name: ctx.from.first_name || "Student",
      stage: "group",
      source: "student_group",
      history: []
    };

    const reply = await generateSmartReply(
      text,
      temporaryLead,
      "This is a question inside Coach Godbless's student community. Give a useful educational answer. Do not aggressively sell."
    );

    await ctx.reply(reply, {
      reply_to_message_id:
        ctx.message.message_id
    });

  } catch (error) {
    console.error(
      "Group reply error:",
      error
    );
  }
});

// ============================================================
// PRIVATE CHAT
// ============================================================

bot.on("message", async ctx => {
  if (ctx.chat.type !== "private") {
    return;
  }

  const userId = ctx.from.id;
  const name =
    ctx.from.first_name || "there";

  let lead = getLead(userId, name);

  // ==========================================================
  // PAYMENT SCREENSHOT
  // ==========================================================

  if (ctx.message.photo) {

    updateLead(userId, {
      stage: "awaiting_confirmation"
    });

    await ctx.reply(
      `Got it, thank you! 🙏

I've received your payment screenshot.

Please reply with:

1️⃣ The exact amount you paid
2️⃣ The date/time you made the payment

Coach Godbless will verify it and complete your registration. ✅`
    );

    await notifyOwner(
      `💰 <b>PAYMENT SCREENSHOT RECEIVED</b>

👤 <a href="tg://user?id=${userId}">${name}</a>

A payment screenshot has been received.

Waiting for amount + date/time confirmation.`
    );

    return;
  }

  const text = ctx.message.text;

  if (!text) {
    return;
  }

  // ==========================================================
  // PAYMENT CONFIRMATION
  // ==========================================================

  if (
    lead.stage === "awaiting_confirmation"
  ) {

    updateLead(userId, {
      stage: "closed",
      paymentDetails: text
    });

    await ctx.reply(
      `Perfect, thank you! ✅

Your payment information has been received.

Coach Godbless will verify the payment and complete your registration.

Welcome to the family! 🎉`
    );

    await notifyOwner(
      `✅ <b>PAYMENT DETAILS CONFIRMED</b>

👤 <a href="tg://user?id=${userId}">${name}</a>

Details provided:

<code>${text}</code>

Please verify the payment screenshot and complete registration.`
    );

    return;
  }

  // ==========================================================
  // START COMMAND
  // ==========================================================

  if (text.startsWith("/start")) {

    const parts =
      text.split(" ");

    const source =
      parts[1] || "direct";

    const isNew =
      lead.stage === "new";

    updateLead(userId, {
      stage: "engaged",
      source
    });

    lead = getLead(userId, name);

    if (isNew) {
      await notifyOwner(
        `🆕 <b>NEW PROSPECT</b>

👤 <a href="tg://user?id=${userId}">${name}</a>

📍 Source: ${source}`
      );
    }

    let welcomeText;

    if (source === "fbads") {

      welcomeText =
        `Hey ${name}! 👋

Thanks for coming from Facebook.

You're in the right place if you want to understand affiliate marketing and learn how to build it as a digital skill.

I'll help you understand how it works and answer your questions before you decide whether it's right for you.`;

    } else if (source === "tiktok") {

      welcomeText =
        `Hey ${name}! 👋

Welcome from TikTok.

I'll help you understand affiliate marketing, how the business works, and what you'll need to get started.

Feel free to ask me anything.`;

    } else if (source === "website") {

      welcomeText =
        `Hey ${name}! 👋

Welcome.

I'll walk you through affiliate marketing, the Affiliate Success Academy, what you'll learn, and how to get started.`;

    } else {

      welcomeText =
        `Hey ${name}! 👋

Welcome to Coach Godbless's official program assistant.

I'll help you understand affiliate marketing, the program, pricing, and how to get started.`;
    }

    await ctx.reply(
      welcomeText
    );

    await ctx.reply(
      `Before we get into everything, you can also join our student community here 👇`,
      Markup.inlineKeyboard([
        Markup.button.url(
          "👉 Join Student Community",
          "https://t.me/+0YjQKFOMnaY3MTM0"
        )
      ])
    );

    // Ask ONE discovery question
    await ctx.reply(
      `To point you in the right direction, what made you interested in affiliate marketing?`
    );

    appendHistory(
      userId,
      "bot",
      welcomeText
    );

    appendHistory(
      userId,
      "bot",
      "To point you in the right direction, what made you interested in affiliate marketing?"
    );

    return;
  }

  // ==========================================================
  // DIRECT SELAR REQUEST
  // ==========================================================

  if (
    isSelarRequest(text) &&
    !isAccountRequest(text)
  ) {

    updateLead(userId, {
      stage: "payment_intent",
      interest: "Selar registration"
    });

    await ctx.reply(
      `Absolutely 👍🏽

Here's the official registration link:

👉 https://selar.com/1j8799`,
      Markup.inlineKeyboard([
        Markup.button.url(
          "✅ Register via Selar",
          SELAR_LINK
        )
      ])
    );

    await ctx.reply(
      `Once you've completed your payment, kindly send your payment screenshot here so it can be confirmed.`
    );

    await notifyOwner(
      `🔗 <b>SELAR LINK REQUEST</b>

👤 <a href="tg://user?id=${userId}">${name}</a>

The prospect requested the Selar registration link.`
    );

    appendHistory(
      userId,
      "user",
      text
    );

    return;
  }

  // ==========================================================
  // DIRECT ACCOUNT REQUEST
  // ==========================================================

  if (
    isAccountRequest(text)
  ) {

    updateLead(userId, {
      stage: "payment_intent",
      interest: "Direct transfer"
    });

    await ctx.reply(
      PAYMENT_DETAILS,
      {
        parse_mode: "Markdown"
      }
    );

    await notifyOwner(
      `🏦 <b>DIRECT PAYMENT REQUEST</b>

👤 <a href="tg://user?id=${userId}">${name}</a>

Direct payment details were requested and sent.`
    );

    appendHistory(
      userId,
      "user",
      text
    );

    return;
  }

  // ==========================================================
  // PAYMENT INTENT
  // ==========================================================

  if (
    isPaymentIntent(text) &&
    lead.stage !== "awaiting_confirmation" &&
    lead.stage !== "closed"
  ) {

    updateLead(userId, {
      stage: "payment_intent"
    });

    await ctx.reply(
      `That's good to hear, ${name}! 🙌

Let me give you the registration options so you can choose whichever is easier for you.`
    );

    await ctx.reply(
      `Current pricing for the available countries:

${kb.pricing}`
    );

    await sendPaymentOptions(
      ctx,
      name
    );

    appendHistory(
      userId,
      "user",
      text
    );

    return;
  }

  // ==========================================================
  // PRICE QUESTION
  // ==========================================================

  if (isPriceQuestion(text)) {

    updateLead(userId, {
      stage: "pricing"
    });

    await ctx.reply(
      `Sure 👍🏽 Here is the current pricing:

${kb.pricing}

The program is designed to teach affiliate marketing from the basics and provide mentorship/support as you learn.`
    );

    await ctx.reply(
      `If you'd like, I can also explain exactly what you'll learn inside the program before you decide.`
    );

    appendHistory(
      userId,
      "user",
      text
    );

    return;
  }

  // ==========================================================
  // OBJECTION
  // ==========================================================

  if (isObjection(text)) {

    updateLead(userId, {
      stage: "objection",
      objection: text
    });

    const reply =
      await generateSmartReply(
        text,
        lead,
        `The prospect has raised an objection.

Do not argue with them.

Acknowledge their concern first.

Give a clear, honest response using only the available program information.

Do not pressure them.

If their objection is unclear, ask ONE question to understand it.`
      );

    await ctx.reply(reply);

    appendHistory(
      userId,
      "user",
      text
    );

    appendHistory(
      userId,
      "bot",
      reply
    );

    return;
  }

  // ==========================================================
  // NORMAL SMART CONVERSATION
  // ==========================================================

  try {

    const previousHistory =
      lead.history || [];

    const newStage =
      determineStage(
        text,
        lead.stage
      );

    updateLead(userId, {
      stage: newStage
    });

    // Basic profile extraction
    const lower = normalize(text);

    if (
      containsAny(lower, [
        "beginner",
        "new to affiliate",
        "never done affiliate",
        "don't know anything",
        "dont know anything"
      ])
    ) {
      updateLead(userId, {
        experience: "beginner"
      });
    }

    if (
      containsAny(lower, [
        "already doing affiliate",
        "i do affiliate",
        "i've done affiliate",
        "i have done affiliate",
        "experienced"
      ])
    ) {
      updateLead(userId, {
        experience: "some experience"
      });
    }

    const freshLead =
      getLead(userId, name);

    const reply =
      await generateSmartReply(
        text,
        freshLead,
        `This is a private conversation.

The prospect is currently at stage: ${freshLead.stage}.

Continue the conversation naturally.

Remember:
- Answer their actual question first.
- Use information already provided.
- Do not repeat previous questions.
- Ask only ONE useful question if needed.
- Educate before selling.
- If they become clearly ready to buy, guide them toward registration.
- Do not invent payment details.`
      );

    await ctx.reply(reply);

    appendHistory(
      userId,
      "user",
      text
    );

    appendHistory(
      userId,
      "bot",
      reply
    );

    // Notify owner only for meaningful high-intent stages
    if (
      ["pricing", "objection", "payment_intent"]
        .includes(freshLead.stage)
    ) {
      await notifyOwner(
        `📊 <b>LEAD UPDATE</b>

👤 <a href="tg://user?id=${userId}">${name}</a>

📍 Stage: ${freshLead.stage}

💬 Prospect:
${text}

🤖 Bot:
${reply}`
      );
    }

  } catch (error) {

    console.error(
      "DM reply error:",
      error
    );

    await ctx.reply(
      `I understand. Let me help you with that. You can ask me anything about the program or affiliate marketing.`
    );
  }
});

// ============================================================
// SMART FOLLOW-UP SYSTEM
// ============================================================

const followUpMessages = [
  {
    stage: "engaged",
    message:
      `Hey {name} 👋 Just checking in. If you're still curious about affiliate marketing, you can ask me anything you're unsure about.`
  },

  {
    stage: "engaged",
    message:
      `Hi {name} 😊 I wanted to check whether you still want to understand how the affiliate business works. I'm here if you have any questions.`
  },

  {
    stage: "pricing",
    message:
      `Hey {name} 👋 Just checking in. If there's anything about the program or pricing you're still unsure about, feel free to ask.`
  },

  {
    stage: "objection",
    message:
      `Hi {name}. No pressure at all — if there's a particular concern holding you back, you can tell me and I'll help you understand it clearly.`
  },

  {
    stage: "payment_intent",
    message:
      `Hey {name} 👋 Just checking in. If you're still ready to continue with registration, let me know and I'll guide you through the next step.`
  },

  {
    stage: "payment_intent",
    message:
      `Hi {name} 😊 Whenever you're ready to complete your registration, just message me and I'll help you with the payment/registration process.`
  }
];

// Run every hour
cron.schedule(
  "0 * * * *",
  async () => {

    const leads =
      loadLeads();

    const now =
      Date.now();

    const ONE_DAY =
      24 * 60 * 60 * 1000;

    for (
      const [userId, lead]
      of Object.entries(leads)
    ) {

      const quietFor =
        now - (
          lead.lastMessageAt || now
        );

      if (
        quietFor <= ONE_DAY
      ) {
        continue;
      }

      if (
        lead.stage === "closed" ||
        lead.stage === "awaiting_confirmation"
      ) {
        continue;
      }

      const count =
        lead.followUpCount || 0;

      if (
        count >= followUpMessages.length
      ) {
        continue;
      }

      try {

        const available =
          followUpMessages.filter(
            item =>
              item.stage === lead.stage
          );

        const fallback =
          followUpMessages[count];

        const selected =
          available[0] || fallback;

        const message =
          selected.message.replace(
            "{name}",
            lead.name || "there"
          );

        await bot.telegram.sendMessage(
          userId,
          message
        );

        updateLead(userId, {
          followUpCount:
            count + 1,
          lastMessageAt:
            Date.now()
        });

      } catch (error) {

        console.error(
          `Follow-up failed for ${userId}:`,
          error.message
        );
      }
    }
  }
);

// ============================================================
// BOT START
// ============================================================

bot.catch((error, ctx) => {
  console.error(
    `Bot error for ${ctx.updateType}:`,
    error
  );
});

bot.launch();

console.log(
  "🚀 Coach Godbless Smart Sales Bot is running..."
);

// ============================================================
// SHUTDOWN
// ============================================================

process.once(
  "SIGINT",
  () => bot.stop("SIGINT")
);

process.once(
  "SIGTERM",
  () => bot.stop("SIGTERM")
);
