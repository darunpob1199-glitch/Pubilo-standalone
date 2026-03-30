# Pubilo Auth + Billing Setup

## Chosen Domains

โดเมนที่ล็อกไว้สำหรับระบบตอนนี้คือ

- `https://app.pubilo.com` = customer dashboard
- `https://api.pubilo.com` = Hono API / LINE Login callback

ถ้าจะใช้ root `pubilo.com` ให้ redirect เข้า `app.pubilo.com`

## Cloudflare Worker Secrets

ตั้งค่า secrets เหล่านี้ใน `apps/api`

- `AUTH_SECRET`
- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_SECRET`
- `DATA_ENCRYPTION_KEY`
- `APP_ORIGIN`
- `API_ORIGIN`
- `INTERNAL_API_SECRET`
- `GEMINI_API_KEY` ถ้าจะใช้ API key กลางทั้งระบบ
- `FREEIMAGE_API_KEY`
- `LINE_CHANNEL_ACCESS_TOKEN` ถ้าจะใช้ LINE แจ้งเตือน
- `LINE_USER_ID`

ตัวอย่างคำสั่ง

```bash
cd apps/api
npx wrangler secret put AUTH_SECRET
npx wrangler secret put LINE_LOGIN_CHANNEL_ID
npx wrangler secret put LINE_LOGIN_CHANNEL_SECRET
npx wrangler secret put DATA_ENCRYPTION_KEY
npx wrangler secret put INTERNAL_API_SECRET
```

`DATA_ENCRYPTION_KEY` ควรเป็น base64url ของคีย์ 32 bytes

ตัวอย่าง generate:

```bash
node -e "const bytes=crypto.getRandomValues(new Uint8Array(32));console.log(Buffer.from(bytes).toString('base64url'))"
```

## LINE Login

ต้องไปสร้าง `LINE Login` channel ใน [LINE Developers Console](https://developers.line.biz/console/)

- Channel type: `LINE Login`
- Callback URL:
  - `https://api.pubilo.com/api/auth/callback/line`
  - `http://localhost:8787/api/auth/callback/line`

ระบบตอนนี้ใช้ LINE Login web flow + PKCE สำหรับ dashboard ปกติบน browser

ถ้าจะใช้ LIFF ภายหลัง ค่อยเพิ่ม `LIFF ID` แยกได้ แต่รอบนี้ยังไม่จำเป็น

`LINE_LOGIN_CHANNEL_ID/SECRET` เป็นคนละชุดกับ `LINE_CHANNEL_ACCESS_TOKEN` ของ Messaging API

ค่า `APP_ORIGIN` กับ `API_ORIGIN` ต้องตรงกับโดเมนจริง

## DNS / Routing Checklist

Cloudflare ฝั่งโดเมนให้ตั้งประมาณนี้

- `app.pubilo.com` ชี้ไป Pages project ของ `apps/web`
- `api.pubilo.com` ชี้ไป Worker `pubilo-api-prod`
- `pubilo.com` redirect ไป `https://app.pubilo.com`

LINE Login ต้องใช้ Callback URL ตรงกับของจริง ไม่งั้น callback จะโดน reject

## Billing Plans

ตอนนี้ระบบ seed plan ไว้แล้ว

- `monthly_500` = 500 บาท / 30 วัน
- `yearly_4499` = 4,499 บาท / 365 วัน

ตอนนี้ยังเป็น `manual pending payment order`

ตารางที่เตรียมไว้สำหรับ gateway:

- `organization_subscriptions`
- `payment_orders`

เวลาเชื่อม gateway จริง ให้เก็บอย่างน้อย:

- `gateway`
- `gateway_reference`
- `qr_reference`
- `paid_at`
- `payload_json`

## Current Login Flow

1. ลูกค้ากด `Continue with LINE`
2. API สร้าง session cookie
3. ถ้ายังไม่มี workspace จะเข้า onboarding
4. onboarding สร้าง:
   - workspace
   - owner membership
   - pending subscription
   - pending payment order
5. dashboard เดิมจะเริ่มยิง API ได้หลัง session + workspace พร้อม

## Important Notes

- ลูกค้าไม่ต้องมี Cloudflare account
- session ใช้ cookie ไม่ใช้ `localStorage`
- Facebook secrets ถูก encrypt ก่อนลง D1
- cron/queue ภายในใช้ `INTERNAL_API_SECRET`
