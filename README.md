# Coach Godbless Telegram Bot — Setup Guide

This bot handles:
- Answering student questions in your group
- Chatting with prospects in DM, handling objections
- Sending your payment details when someone's ready to buy
- Following up automatically if a prospect goes quiet for 24 hours
- Notifying you when someone sends a payment screenshot

---

## STEP 1 — Get your own Telegram User ID

So the bot knows who to notify about payments:
1. In Telegram, search for **@userinfobot**
2. Tap **Start**
3. It will reply with your ID (a number like `123456789`)
4. Save this number — you'll need it in Step 4

## STEP 2 — Get your OpenAI API key

1. Go to https://platform.openai.com and sign up/log in
2. Click **API Keys** in the left menu
3. Click **Create new secret key**
4. Copy it and save it somewhere safe (you can't view it again later)
5. Add a small amount of credit ($5 is plenty to start) under **Billing**

## STEP 3 — Get your Bot Token

You already have this from BotFather when you created @Coachgodblessbot.
It looks like: `8683899232:AAHoL4mJHWSErphnF_zecbclpQVjFnM9_K4`

⚠️ Keep this private — anyone with it can control your bot.

## STEP 4 — Deploy the bot (free, no subscription)

We'll use **Render.com** (free tier, no card required to start):

1. Go to https://render.com and sign up (you can use your Google account)
2. Click **New +** → **Web Service**
3. You'll need this code in a GitHub repository — if you don't have GitHub:
   - Go to https://github.com and create a free account
   - Create a **New Repository** (name it `coachgodbless-bot`)
   - Upload all the files from this project into it (there's an "upload files" button on the repo page — just drag them in)
4. Back in Render, connect your GitHub account and select the `coachgodbless-bot` repo
5. Render will ask for settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
6. Under **Environment Variables**, add these three (from Steps 1-3):
   - `TELEGRAM_BOT_TOKEN` = your bot token
   - `OPENAI_API_KEY` = your OpenAI key
   - `OWNER_TELEGRAM_ID` = your Telegram user ID
7. Click **Create Web Service**

Render will install everything and start your bot. Give it a few minutes.

## STEP 5 — Test it

1. Message your bot directly (@Coachgodblessbot) — send `/start`
2. Try asking it a question about the program
3. Try saying "I'm ready" or "how do I pay" — it should send your account details
4. Send a test image — it should reply confirming receipt and notify you

## STEP 6 — Add the bot to your student group

1. Open your group in Telegram
2. Tap group name → **Add Members**
3. Search for @Coachgodblessbot and add it
4. Make it an **admin** (optional, but helps it read all messages properly)
5. It will now respond when tagged (@Coachgodblessbot) or when someone asks a question ending in "?"

---

## Editing pricing, payment info, or objection responses later

Open the file `knowledgeBase.js` — everything is in plain English there. Change the text between the quotes, save, and Render will need the updated file re-uploaded to GitHub (it auto-redeploys when the repo changes).

## Important notes

- The free Render tier may "sleep" after inactivity and take ~30 seconds to wake up on the first message. This is fine for normal use but know it's not instant if unused for a while.
- Keep your `.env` values (tokens/keys) private — never share them or upload a file containing them to a public place.
- Testimonials are currently a placeholder in `knowledgeBase.js` — add your real ones for stronger objection handling.
