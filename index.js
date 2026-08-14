require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const cron = require("node-cron");
const http = require("http");
const kb = require("./knowledgeBase");

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Coach Godbless bot is running.");
}).listen(PORT, () =>
  console.log(`Keep-alive server listening on port ${PORT}`)
);

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({
  model: "gemini-flash-lite-latest"
});

const OWNER_ID = process.env.OWNER_TELEGRAM_ID;

const DB_FILE = "./leads.json";

function loadLeads() {
  if (!fs.existsSync(DB_FILE)) return {};

  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveLeads(leads) {
  fs.writeFileSync(DB_FILE, JSON.stringify(leads, null, 2));
}

function getLead(userId, name) {
  const leads = loadLeads();

  if (!leads[userId]) {
    leads[userId] = {
      name,
      stage: "new",
      lastMessageAt: Date.now(),
      history: []
    };

    saveLeads(leads);
  }

  return leads[userId];
}

function updateLead(userId, updates) {
  const leads = loadLeads();

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
  const lead = leads[userId];

  if (!lead) return;

  const history = lead.history || [];

  history.push({
    role,
    text
  });

  leads[userId].history = history.slice(-10);

  saveLeads(leads);
}

async function generateReply(userMessage, context, history = []) {
  const systemPrompt = `
You are the official assistant for ${kb.coachName} and ${kb.programName}. Present yourself clearly as the official assistant — never claim to literally BE Coach Godbless, and never say "I'm an AI" or "as an assistant" in a way that sounds robotic. Just talk like a real, warm, knowledgeable human on the team.

CORE OBJECTIVE:
Your job is NOT to force a sale. It's to understand the prospect, identify their real problem, educate them, build trust, and guide genuinely interested people toward the mentorship as the right next step — while being honest with people who aren't a fit yet.

FLEXIBLE FRAMEWORK:
PROBLEM → GOAL → UNDERSTANDING → EDUCATION → TRUST → SOLUTION → OBJECTION HANDLING → CLOSE → FOLLOW-UP

RULES:
- Look at the conversation history below.
- NEVER repeat a question, phrase, opening, or explanation you've already used earlier.
- Ask only ONE question at a time when genuinely useful.
- Don't sell immediately. Understand their situation first when appropriate.
- Educate before pitching.
- Never guarantee income or promise they'll get rich.
- Never invent testimonials, numbers, discounts, deadlines, or scarcity.
- When someone raises an objection, understand it before responding.
- When closing, rotate your approach naturally.
- If asked the price, answer directly and honestly using the real pricing.
- If someone wants to register or pay, explain that there are two options: Selar registration or direct bank transfer.
- Personalize using the conversation history.
- Avoid exaggerated hype.
- Sound natural and human.

PAYMENT INFORMATION:
When someone specifically asks for the Selar link, registration link, payment link, or how to register through Selar, give them this clickable link:

https://selar.com/1j8799

When someone specifically asks for account details, bank details, Opay details, or wants to pay by transfer, give them:

MAKE PAYMENT HERE

⤵️⤵️⤵️⤵️⤵️⤵️

📮 Account Number: 7015269313
🏦 Bank: Opay
👤 Account Name: Godbless Paulinus Ben

NOTE: After payment, kindly send a screenshot of your payment proof so I can confirm your payment.

Once done, let me know so I can proceed with your registration.

TONE:
Short, natural, conversational — like texting a helpful person, not reading a script. 2-4 sentences typically, more only when explaining pricing/details. Light emojis, not excessive.

PROGRAM INFO:
${kb.programOverview}

PRICING:
${kb.pricing}

OBJECTION HANDLING:
${kb.objectionGuidance}

REAL TESTIMONIALS:
${kb.testimonials}

Context:
${context}

CONVERSATION SO FAR:
${
  history.map(
    h => `${h.role === "user" ? "Prospect" : "You"}: ${h.text}`
  ).join("\n") || "(this is the first message)"
}

Do NOT invent information you don't have.
`;

  const fullPrompt = `${systemPrompt}\n\nUser's message: ${userMessage}`;

  const result = await geminiModel.generateContent(fullPrompt);
  const response = result.response;

  return response.text().trim();
}

function isReadyToPay(text) {
  const lower = text.toLowerCase();

  return kb.readyToPayTriggers.some(trigger =>
    lower.includes(trigger)
  );
}

/* ============================================================
   GROUP CHAT HANDLER
============================================================ */

bot.on("message", async (ctx, next) => {
  const chatType = ctx.chat.type;

  if (chatType === "group" || chatType === "supergroup") {
    const text = ctx.message.text;

    if (!text) return;

    const botUsername = ctx.botInfo.username.toLowerCase();

    const mentioned = text
      .toLowerCase()
      .includes("@" + botUsername);

    const looksLikeQuestion = text.trim().endsWith("?");

    if (!mentioned && !looksLikeQuestion) return;

    try {
      const reply = await generateReply(
        text,
        "This is a message inside the student group. Answer helpfully as a course assistant."
      );

      await ctx.reply(reply, {
        reply_to_message_id: ctx.message.message_id
      });
    } catch (err) {
      console.error("Group reply error:", err);
    }

    return;
  }

  return next();
});

/* ============================================================
   PRIVATE CHAT HANDLER
============================================================ */

bot.on("message", async ctx => {
  if (ctx.chat.type !== "private") return;

  const userId = ctx.from.id;
  const name = ctx.from.first_name || "there";

  const lead = getLead(userId, name);

  /* ============================================================
     PAYMENT SCREENSHOT
  ============================================================ */

  if (ctx.message.photo) {
    updateLead(userId, {
      stage: "awaiting_confirmation"
    });

    await ctx.reply(
      `Got it, thank you! 🙏

Your payment screenshot has been received.

To confirm this quickly, please reply with:

1️⃣ The exact amount you paid
2️⃣ The date/time you made the payment

Once I have that, Coach Godbless will verify your payment and complete your registration. ✅`
    );

    if (OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `💰 Payment screenshot received from <a href="tg://user?id=${userId}">${name}</a> (@${ctx.from.username || "no username"}).

Waiting on them to confirm exact amount + date.

Please verify once they reply.`,
        {
          parse_mode: "HTML"
        }
      );
    }

    return;
  }

  const text = ctx.message.text;

  if (!text) return;

  /* ============================================================
     PAYMENT CONFIRMATION
  ============================================================ */

  if (lead.stage === "awaiting_confirmation") {
    updateLead(userId, {
      stage: "closed",
      paymentDetails: text
    });

    await ctx.reply(
      `Perfect, thanks for confirming! ✅

Coach Godbless will verify your payment shortly and complete your registration.

Welcome to the family! 🎉

Feel free to ask anything in the meantime.`
    );

    if (OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `✅ <a href="tg://user?id=${userId}">${name}</a> confirmed payment details:

"${text}"

Please verify against the screenshot and complete their registration.`,
        {
          parse_mode: "HTML"
        }
      );
    }

    return;
  }

  /* ============================================================
     START COMMAND
  ============================================================ */

  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    const source = parts[1] || "direct";

    const isNew = lead.stage === "new";

    updateLead(userId, {
      stage: "engaged",
      source
    });

    if (isNew && OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `🆕 New prospect started chatting (source: ${source}): <a href="tg://user?id=${userId}">${name}</a>`,
        {
          parse_mode: "HTML"
        }
      );
    }

    let welcomeText;
    let openingQuestion = null;

    if (source === "fbads") {
      welcomeText = `Hey ${name}! 👋

Thanks for checking us out from Facebook — I'm here to help you learn about ${kb.programName} and how you can start learning affiliate marketing.`;

      openingQuestion =
        "Hello 👋 Coach Godbless can I get More Information on Affiliate Marketing?";
    } else if (source === "website") {
      welcomeText = `Hey ${name}! 👋

Great to have you here from our website — I'm here to walk you through ${kb.programName} and answer anything you're curious about.`;

      openingQuestion =
        "Hello, I'd like to know more about this program and how it can help me.";
    } else {
      welcomeText = `Hey ${name}! 👋

Welcome — I'm here to help you learn about ${kb.programName} and answer any questions you have.`;
    }

    await ctx.reply(
      `${welcomeText}

Before we continue, join our community group where students connect and share results 👇`,
      Markup.inlineKeyboard([
        Markup.button.url(
          "👉 Join the Group First",
          "https://t.me/+0YjQKFOMnaY3MTM0"
        )
      ])
    );

    if (openingQuestion) {
      try {
        const reply = await generateReply(
          openingQuestion,
          `This is a private conversation with a prospect named ${name} who just clicked in from ${source === "fbads" ? "a Facebook Ad" : "the website"}.

Do NOT ask a discovery question here.

Go straight into explaining what affiliate marketing is and how ${kb.programName} helps them start.

Keep it warm and exciting.

End with a soft next-step question like whether they'd like to know pricing or how to begin.`
        );

        await ctx.reply(reply);

        appendHistory(userId, "user", openingQuestion);
        appendHistory(userId, "bot", reply);

        if (OWNER_ID) {
          await bot.telegram.sendMessage(
            OWNER_ID,
            `💬 <a href="tg://user?id=${userId}">${name}</a> (from ${source}): ${openingQuestion}

🤖 Bot replied: ${reply}`,
            {
              parse_mode: "HTML"
            }
          );
        }
      } catch (err) {
        console.error(
          "Opening question reply error:",
          err
        );
      }
    } else {
      await ctx.reply(
        `What would you like to know?

For example:
• What the program includes
• Pricing
• How affiliate marketing works
• How to get started`
      );
    }

    return;
  }

  /* ============================================================
     PAYMENT / REGISTRATION REQUEST
  ============================================================ */

  if (
    isReadyToPay(text) &&
    lead.stage !== "awaiting_confirmation" &&
    lead.stage !== "closed"
  ) {
    updateLead(userId, {
      stage: "payment_sent"
    });

    /* ---------- PRICING ---------- */

    await ctx.reply(
      `Awesome, ${name}! 🎉

Here's the current pricing for your country:

${kb.pricing}`
    );

    /* ---------- SELAR LINK ---------- */

    await ctx.reply(
      `✅ REGISTER VIA SELAR

You can register instantly using the link below:

👉 https://selar.com/1j8799

Click the link to complete your registration.

Or use the button below 👇`,
      Markup.inlineKeyboard([
        Markup.button.url(
          "✅ Register & Pay via Selar",
          "https://selar.com/1j8799"
        )
      ])
    );

    /* ---------- SELAR INSTRUCTIONS ---------- */

    await ctx.reply(
      `OPTION 1 — Register yourself instantly via Selar ✅

👉 Click the Selar link above
👉 Click "Register Now"
👉 Fill in your details correctly
👉 Scroll down to the payment method
👉 Pay via transfer or card
👉 Selar will send you a confirmation email

After payment, kindly send your payment screenshot here so Coach Godbless can confirm it.`
    );

    /* ---------- DIRECT PAYMENT ---------- */

    await ctx.reply(
      `OPTION 2 — DIRECT BANK TRANSFER 👇

*MAKE PAYMENT HERE*

⤵️⤵️⤵️⤵️⤵️⤵️

📮 Account Number: *7015269313*
🏦 Bank: *Opay*
👤 Account Name: *Godbless Paulinus Ben*

*NOTE:* After payment, kindly send a screenshot for payment proof so I can confirm your payment.

*Once done, let me know so I can proceed with your registration.*`,
      {
        parse_mode: "Markdown"
      }
    );

    if (OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `💰 ${name} just requested pricing/payment.

Sent them:
✅ Selar registration link
✅ Direct Opay payment details`
      );
    }

    return;
  }

  /* ============================================================
     NORMAL GEMINI CONVERSATION
  ============================================================ */

  try {
    updateLead(userId, {
      stage: lead.stage === "new"
        ? "engaged"
        : lead.stage
    });

    const reply = await generateReply(
      text,
      `This is a private conversation with a prospect named ${name}. Current stage: ${lead.stage}.`,
      lead.history || []
    );

    await ctx.reply(reply);

    appendHistory(userId, "user", text);
    appendHistory(userId, "bot", reply);

    if (OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `💬 <a href="tg://user?id=${userId}">${name}</a>: ${text}

🤖 Bot replied: ${reply}`,
        {
          parse_mode: "HTML"
        }
      );
    }
  } catch (err) {
    console.error("DM reply error:", err);

    await ctx.reply(
      "Sorry, I had trouble processing that — Coach Godbless will follow up with you shortly!"
    );
  }
});

/* ============================================================
   AUTOMATIC FOLLOW-UP MESSAGES
============================================================ */

const followUpMessages = [
  `Hey {name} 👋 Just checking in — were you able to go through everything we talked about?`,

  `Hi {name}, still thinking things over? Happy to answer anything that's still unclear.`,

  `{name}, based on what you shared earlier, are you still looking to move forward with that goal?`,

  `Just checking on you, {name} — if you're still interested, I'm here for any questions.`,

  `Hey {name}, no pressure at all. If something specific is holding you back, let me know and I'll help however I can.`,

  `I don't want to keep disturbing you, {name}. Whenever you're ready to continue, just message me and I'll help with the next step.`
];

cron.schedule("0 * * * *", async () => {
  const leads = loadLeads();

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  for (const [userId, lead] of Object.entries(leads)) {
    const quietFor = now - lead.lastMessageAt;

    const eligibleStage =
      lead.stage === "engaged" ||
      lead.stage === "payment_sent";

    const count = lead.followUpCount || 0;

    if (
      eligibleStage &&
      quietFor > ONE_DAY &&
      count < followUpMessages.length
    ) {
      try {
        const message = followUpMessages[count].replace(
          "{name}",
          lead.name
        );

        await bot.telegram.sendMessage(
          userId,
          message
        );

        updateLead(userId, {
          followUpCount: count + 1,
          lastMessageAt: Date.now()
        });
      } catch (err) {
        console.error(
          `Follow-up failed for ${userId}:`,
          err.message
        );
      }
    }
  }
});

/* ============================================================
   START BOT
============================================================ */

bot.launch();

console.log("Coach Godbless bot is running...");

process.once("SIGINT", () =>
  bot.stop("SIGINT")
);

process.once("SIGTERM", () =>
  bot.stop("SIGTERM")
);
