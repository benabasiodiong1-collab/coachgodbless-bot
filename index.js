require("dotenv").config();
const { Telegraf } = require("telegraf");
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
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
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
You are the assistant for ${kb.coachName}, who runs ${kb.programName}.
Speak warmly, confidently, and briefly (2-4 sentences max unless explaining pricing or objections).
Use plain, encouraging language. Never sound robotic or overly formal. Use light emojis, not excessive.

PROGRAM INFO:
${kb.programOverview}

PRICING (only mention if asked, or if user is close to ready):
${kb.pricing}

OBJECTION HANDLING GUIDANCE:
${kb.objectionGuidance}

TESTIMONIALS (use naturally if relevant, don't force them):
${kb.testimonials}

Context: ${context}

Do NOT invent information you don't have. If unsure, tell them Coach Godbless will follow up personally.
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
    await ctx.reply(kb.afterPaymentMessage);
    if (OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `💰 Payment proof received from ${name} (@${ctx.from.username || "no username"}). Please confirm and complete their registration.`
      );
    }
    return;
  }

  const text = ctx.message.text;
  if (!text) return;

  if (text === "/start") {
    updateLead(userId, { stage: "engaged" });
    await ctx.reply(
      `Hey ${name}! 👋 Welcome — I'm here to help you learn about ${kb.programName} and answer any questions you have.\n\nWhat would you like to know? (e.g. what it includes, pricing, or how to get started)`
    );
    return;
  }

  if (isReadyToPay(text) && lead.stage !== "awaiting_confirmation" && lead.stage !== "closed") {
    updateLead(userId, { stage: "payment_sent" });
    await ctx.reply(`Awesome, ${name}! 🎉 Here's the pricing for your country:\n${kb.pricing}\n${kb.paymentInstructions}`);
    return;
  }

  try {
    updateLead(userId, { stage: lead.stage === "new" ? "engaged" : lead.stage });
    const reply = await generateReply(text, `This is a private conversation with a prospect named ${name}. Current stage: ${lead.stage}.`);
    await ctx.reply(reply);
  } catch (err) {
    console.error("DM reply error:", err);
    await ctx.reply("Sorry, I had trouble processing that — Coach Godbless will follow up with you shortly!");
  }
});

cron.schedule("0 * * * *", async () => {
  const leads = loadLeads();
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  for (const [userId, lead] of Object.entries(leads)) {
    const quietFor = now - lead.lastMessageAt;
    const eligibleStage = lead.stage === "engaged" || lead.stage === "payment_sent";

    if (eligibleStage && quietFor > ONE_DAY && !lead.followedUp) {
      try {
        await bot.telegram.sendMessage(
          userId,
          `Hey ${lead.name}, just checking in 👋 Did you have any more questions about the program, or are you ready to get started?`
        );
        updateLead(userId, { followedUp: true });
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
