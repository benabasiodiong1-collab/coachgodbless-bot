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
}).listen(PORT, () => console.log(`Keep-alive server listening on port ${PORT}`));

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });
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
  leads[userId] = { ...leads[userId], ...updates, lastMessageAt: Date.now() };
  saveLeads(leads);
  return leads[userId];
}

async function generateReply(userMessage, context) {
  const systemPrompt = `
You are a real member of ${kb.coachName}'s team, helping people with ${kb.programName}. You are NOT an AI and should never say "I'm an AI", "as an assistant", "I'm a bot", or anything revealing you're automated. Talk like a real, experienced human on the team — warm, confident, casual.

HOW YOU SELL (consultative, not pushy):
- Position yourself as someone here to help them solve a real problem (lack of income, no digital skill, unclear how to start online) — not someone trying to sell a course.
- Ask what's actually holding them back before pitching. Understand their situation first.
- Explain affiliate marketing and the program in terms of THEIR outcome (extra income, financial independence, a real skill) — not features.
- Use social proof naturally (real student wins) when someone doubts it works — never force it into every message.
- Create gentle urgency around the discounted price being limited, but never pressure or guilt anyone.
- When someone raises an objection, acknowledge it genuinely first, then address it with facts — never dismiss their concern.
- Ask soft closing questions naturally ("Does this sound like something that could work for you?" / "What's stopping you from starting today?") instead of hard-selling.
- Never lie, invent results, or promise guaranteed income — that damages trust and is against what a good closer does long-term.

TONE:
Speak briefly (2-4 sentences max unless explaining pricing or objections). Natural, conversational, like texting — contractions, casual phrasing. Light emojis, not excessive. Vary your openings, don't sound scripted.

PROGRAM INFO:
${kb.programOverview}

PRICING (only mention if asked, or if user is close to ready):
${kb.pricing}

OBJECTION HANDLING GUIDANCE:
${kb.objectionGuidance}

TESTIMONIALS (use naturally if relevant, don't force them):
${kb.testimonials}

Context: ${context}

Do NOT invent information you don't have. If unsure, say Coach Godbless will personally follow up rather than guessing.
`;

  const fullPrompt = `${systemPrompt}\n\nUser's message: ${userMessage}`;
  const result = await geminiModel.generateContent(fullPrompt);
  const response = result.response;
  return response.text().trim();
}

function isReadyToPay(text) {
  const lower = text.toLowerCase();
  return kb.readyToPayTriggers.some((trigger) => lower.includes(trigger));
}

bot.on("message", async (ctx, next) => {
  const chatType = ctx.chat.type;
  if (chatType === "group" || chatType === "supergroup") {
    const text = ctx.message.text;
    if (!text) return;

    const botUsername = ctx.botInfo.username.toLowerCase();
    const mentioned = text.toLowerCase().includes("@" + botUsername);
    const looksLikeQuestion = text.trim().endsWith("?");

    if (!mentioned && !looksLikeQuestion) return;

    try {
      const reply = await generateReply(text, "This is a message inside the student group. Answer helpfully as a course assistant.");
      await ctx.reply(reply, { reply_to_message_id: ctx.message.message_id });
    } catch (err) {
      console.error("Group reply error:", err);
    }
    return;
  }
  return next();
});

bot.on("message", async (ctx) => {
  if (ctx.chat.type !== "private") return;

  const userId = ctx.from.id;
  const name = ctx.from.first_name || "there";
  const lead = getLead(userId, name);

  if (ctx.message.photo) {
    updateLead(userId, { stage: "awaiting_confirmation" });
    await ctx.reply(
      `Got it, thank you! 🙏 To confirm this quickly, can you reply with:\n1) The exact amount you paid\n2) The date/time you made the payment\n\nOnce I have that, Coach Godbless will verify and complete your registration right away.`
    );
    if (OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `💰 Payment screenshot received from <a href="tg://user?id=${userId}">${name}</a> (@${ctx.from.username || "no username"}). Waiting on them to confirm exact amount + date — please verify once they reply.`,
        { parse_mode: "HTML" }
      );
    }
    return;
  }

  const text = ctx.message.text;
  if (!text) return;

  if (lead.stage === "awaiting_confirmation") {
    updateLead(userId, { stage: "closed", paymentDetails: text });
    await ctx.reply(`Perfect, thanks for confirming! ✅ Coach Godbless will verify this shortly and get your registration completed. Welcome to the family — feel free to ask anything in the meantime.`);
    if (OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `✅ <a href="tg://user?id=${userId}">${name}</a> confirmed payment details: "${text}" — please verify against the screenshot and complete their registration.`,
        { parse_mode: "HTML" }
      );
    }
    return;
  }

  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    const source = parts[1] || "direct";
    const isNew = lead.stage === "new";
    updateLead(userId, { stage: "engaged", source });
    if (isNew && OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `🆕 New prospect started chatting (source: ${source}): <a href="tg://user?id=${userId}">${name}</a>`,
        { parse_mode: "HTML" }
      );
    }

    let welcomeText;
    let openingQuestion = null;
    if (source === "fbads") {
      welcomeText = `Hey ${name}! 👋 Thanks for checking us out from Facebook — I'm here to help you learn about ${kb.programName} and how you can start earning with affiliate marketing.`;
      openingQuestion = "Hello 👋 Coach Godbless can I get More Information on Affiliate Marketing?";
    } else if (source === "website") {
      welcomeText = `Hey ${name}! 👋 Great to have you here from our website — I'm here to walk you through ${kb.programName} and answer anything you're curious about.`;
    } else {
      welcomeText = `Hey ${name}! 👋 Welcome — I'm here to help you learn about ${kb.programName} and answer any questions you have.`;
    }

    await ctx.reply(
      `${welcomeText}\n\nBefore we continue, join our community group where students connect and share results 👇`,
      Markup.inlineKeyboard([
        Markup.button.url("👉 Join the Group First", "https://t.me/+0YjQKFOMnaY3MTM0")
      ])
    );

    if (openingQuestion) {
      try {
        const reply = await generateReply(openingQuestion, `This is a private conversation with a prospect named ${name} who just clicked in from Facebook Ads.`);
        await ctx.reply(reply);
        if (OWNER_ID) {
          await bot.telegram.sendMessage(
            OWNER_ID,
            `💬 <a href="tg://user?id=${userId}">${name}</a> (from Facebook Ads): ${openingQuestion}\n🤖 Bot replied: ${reply}`,
            { parse_mode: "HTML" }
          );
        }
      } catch (err) {
        console.error("Opening question reply error:", err);
      }
    } else {
      await ctx.reply(`What would you like to know? (e.g. what it includes, pricing, or how to get started)`);
    }
    return;
  }

  if (isReadyToPay(text) && lead.stage !== "awaiting_confirmation" && lead.stage !== "closed") {
    updateLead(userId, { stage: "payment_sent" });
    await ctx.reply(`Awesome, ${name}! 🎉 Here's the pricing for your country:\n${kb.pricing}\n${kb.paymentInstructions}`);
    if (OWNER_ID) {
      await bot.telegram.sendMessage(OWNER_ID, `💰 ${name} just asked about pricing/payment — sent them the details.`);
    }
    return;
  }

  try {
    updateLead(userId, { stage: lead.stage === "new" ? "engaged" : lead.stage });
    const reply = await generateReply(text, `This is a private conversation with a prospect named ${name}. Current stage: ${lead.stage}.`);
    await ctx.reply(reply);
    if (OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `💬 <a href="tg://user?id=${userId}">${name}</a>: ${text}\n🤖 Bot replied: ${reply}`,
        { parse_mode: "HTML" }
      );
    }
  } catch (err) {
    console.error("DM reply error:", err);
    await ctx.reply("Sorry, I had trouble processing that — Coach Godbless will follow up with you shortly!");
  }
});

const followUpMessages = [
  `Hey {name}, just checking in 👋 Did you have any more questions about the program, or are you ready to get started?`,
  `Hi {name}! Still thinking it over? No pressure — happy to answer anything that's holding you back. 😊`,
  `Hey {name}, quick one — is there something specific you're unsure about with the program? I'd rather help you decide with real info than let you wonder.`,
  `Hi {name}, just wanted to check if you're still interested. The discounted price won't be around forever, so let me know if you have questions!`,
  `Hey {name}, I don't want to be a bother, but I know starting something new can feel like a big decision. What's on your mind?`,
  `Hi {name}, last check-in from me for now — I'm here whenever you're ready. No rush at all.`
];

cron.schedule("0 * * * *", async () => {
  const leads = loadLeads();
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  for (const [userId, lead] of Object.entries(leads)) {
    const quietFor = now - lead.lastMessageAt;
    const eligibleStage = lead.stage === "engaged" || lead.stage === "payment_sent";
    const count = lead.followUpCount || 0;

    if (eligibleStage && quietFor > ONE_DAY && count < followUpMessages.length) {
      try {
        const message = followUpMessages[count].replace("{name}", lead.name);
        await bot.telegram.sendMessage(userId, message);
        updateLead(userId, { followUpCount: count + 1, lastMessageAt: Date.now() });
      } catch (err) {
        console.error(`Follow-up failed for ${userId}:`, err.message);
      }
    }
  }
});

bot.launch();
console.log("Coach Godbless bot is running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
